/**
 * The desktop build runs the PostgreSQL-written API SQL against SQLite. These
 * tests pin the translation of every construct the codebase actually uses and
 * prove the hand-written SQLite migrations pass through unchanged (so the
 * dialect can never silently rewrite a table name or a default value).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { toSqlite, isMultiStatement } from '../server/sqlite/dialect.js';

test('bind parameters and schema folding', () => {
  assert.equal(toSqlite('SELECT * FROM inv.users WHERE email=$1'),
    'SELECT * FROM inv_users WHERE email=@p1');
  assert.equal(toSqlite('SELECT a FROM inv.rate_limits WHERE key=$1 AND x=$12'),
    'SELECT a FROM inv_rate_limits WHERE key=@p1 AND x=@p12');
});

test('FOR UPDATE is dropped (the writer lock serialises readers)', () => {
  const out = toSqlite('SELECT * FROM inv.quotations WHERE id=$1 FOR UPDATE');
  assert.equal(out, 'SELECT * FROM inv_quotations WHERE id=@p1  ');
  assert.ok(!/FOR\s+UPDATE/i.test(out));
});

test('intervals become datetime modifiers', () => {
  assert.equal(toSqlite("VALUES($1,$2,$3,now()+interval '8 hours')"),
    "VALUES(@p1,@p2,@p3,datetime('now', '+8 hours'))");
  assert.equal(toSqlite("VALUES($1,1,now()+($2 * interval '1 second'))"),
    "VALUES(@p1,1,datetime('now', printf('+%d seconds', CAST(@p2 AS INTEGER))))");
});

test('the rate-limit upsert stays valid SQLite with EXCLUDED intact', () => {
  const out = toSqlite(`INSERT INTO inv.rate_limits(key,count,expires_at)
    VALUES($1,1,now()+($2 * interval '1 second'))
    ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN inv.rate_limits.expires_at <= now() THEN 1 ELSE inv.rate_limits.count+1 END,
      expires_at=CASE WHEN inv.rate_limits.expires_at <= now() THEN EXCLUDED.expires_at ELSE inv.rate_limits.expires_at END
    RETURNING count`);
  assert.ok(out.includes('inv_rate_limits.expires_at <= (datetime(\'now\'))'));
  assert.ok(out.includes('EXCLUDED.expires_at'));
  assert.ok(out.includes('RETURNING count'));
  assert.ok(!/\$1|now\(\)|inv\./.test(out));
});

test('ILIKE becomes LIKE (SQLite LIKE is ASCII case-insensitive; no plain LIKE exists)', () => {
  assert.equal(toSqlite("q.quotation_number ILIKE $5 ESCAPE '!'"),
    "q.quotation_number LIKE @p5 ESCAPE '!'");
});

test('json operators and casts', () => {
  assert.equal(toSqlite("sum((i.totals->>'grand_total_minor')::bigint)"),
    'sum(CAST((json_extract(i.totals, \'$."grand_total_minor"\')) AS INTEGER))');
  assert.equal(toSqlite('SELECT COALESCE($1::date, $2::uuid)'),
    'SELECT COALESCE(CAST(@p1 AS TEXT), CAST(@p2 AS TEXT))');
  assert.equal(toSqlite('id::int + 1'), 'CAST(id AS INTEGER) + 1');
});

test('= ANY(json) becomes IN json_each, including array parameters', () => {
  assert.equal(toSqlite('WHERE email = ANY($1::text[])'),
    'WHERE email IN (SELECT value FROM json_each(CAST(@p1 AS TEXT)))');
  assert.equal(toSqlite('p.invoice_id = ANY(array_agg(i.id))'),
    'p.invoice_id IN (SELECT value FROM json_each(json_group_array(i.id)))');
  assert.equal(toSqlite('(cardinality($12::uuid[]) = 0 OR c.id = ANY($12::uuid[]))'),
    '(json_array_length(CAST(@p12 AS TEXT)) = 0 OR c.id IN (SELECT value FROM json_each(CAST(@p12 AS TEXT))))');
});

test('date functions rewrite to strftime/printf', () => {
  assert.equal(toSqlite("SELECT to_char(date_trunc('month', p.paid_on), 'YYYY-MM') AS m"),
    "SELECT strftime('%Y-%m', strftime('%Y-%m-01', p.paid_on)) AS m");
  assert.equal(toSqlite("paid_on >= date_trunc('month', CURRENT_DATE)::date"),
    "paid_on >= CAST(strftime('%Y-%m-01', (date('now'))) AS TEXT)");
  assert.equal(toSqlite("extract(month FROM CURRENT_DATE)"),
    "CAST(strftime('%m', (date('now'))) AS INTEGER)");
  assert.equal(toSqlite('make_date(extract(year FROM CURRENT_DATE)::int - 1, 4, 1)'),
    "printf('%04d-%02d-%02d', CAST(CAST(strftime('%Y', (date('now'))) AS INTEGER) AS INTEGER) - 1, 4, 1)");
  assert.equal(toSqlite("now()-interval '1 hour'"),
    "datetime('now', '-1 hour')");
  assert.equal(toSqlite('i.due_date <= CURRENT_DATE + 30'),
    "i.due_date <= date('now', '+30 days')");
  assert.equal(toSqlite('CURRENT_DATE - i.due_date <= 30'),
    "CAST(julianday(date('now')) - julianday(i.due_date) AS INTEGER) <= 30");
  assert.equal(toSqlite("current_date + (CASE $10 WHEN '7' THEN 7 ELSE 30 END)"),
    "date('now', printf('+%d days', CAST((CASE @p10 WHEN '7' THEN 7 ELSE 30 END) AS INTEGER)))");
});

test('aggregates and misc functions', () => {
  assert.equal(toSqlite("COALESCE(json_agg(r.email ORDER BY r.email), '[]'::json)"),
    "COALESCE(json_group_array(r.email ORDER BY r.email), CAST('[]' AS TEXT))");
  assert.equal(toSqlite('greatest(a,b) least(c,d) btrim(e) now() CURRENT_DATE'),
    "max(a,b) min(c,d) trim(e) (datetime('now')) (date('now'))");
  assert.equal(toSqlite("count(*) FILTER (WHERE status='ARCHIVED')::int AS archived"),
    "CAST(count(*) FILTER (WHERE status='ARCHIVED') AS INTEGER) AS archived");
  assert.equal(toSqlite('CASE WHEN x IS NULL THEN 0 ELSE 1 END::int AS flag'),
    'CAST(CASE WHEN x IS NULL THEN 0 ELSE 1 END AS INTEGER) AS flag');
  assert.equal(toSqlite('CREATE SCHEMA IF NOT EXISTS inv'), 'SELECT 1');
});

test('regex operator becomes REGEXP', () => {
  assert.equal(toSqlite("key ~ '^[a-z_]+$'"), "key REGEXP '^[a-z_]+$'");
});

test('literals and comments are never rewritten', () => {
  assert.equal(toSqlite("SELECT '$1' AS a, 'inv.users' AS b"),
    "SELECT '$1' AS a, 'inv.users' AS b");
  assert.equal(toSqlite('-- now() stays in the comment\nSELECT now()'),
    '-- now() stays in the comment\nSELECT (datetime(\'now\'))');
  assert.equal(toSqlite("SELECT 'a--b', 'x::y', \"inv.quoted\""),
    "SELECT 'a--b', 'x::y', \"inv.quoted\"");
});

test('unknown PostgreSQL constructs fail loudly instead of guessing', () => {
  assert.throws(() => toSqlite('SELECT 1::regclass'), /Unsupported cast type/);
  assert.throws(() => toSqlite("SELECT date_trunc('week', x)"), /Unsupported date_trunc unit/);
  assert.throws(() => toSqlite("SELECT to_char(x, 'Q')"), /Unsupported to_char token/);
  assert.throws(() => toSqlite('SELECT x <> ANY($1)'), /must be written as = ANY/);
  assert.throws(() => toSqlite("SELECT extract(quarter FROM x)"), /Unsupported extract unit/);
  assert.throws(() => toSqlite("SELECT now() + interval 'fortnight'"), /Unsupported interval literal/);
});

test('multi-statement detection for migrations', () => {
  assert.equal(isMultiStatement('CREATE TABLE a(x); CREATE TABLE b(y);'), true);
  assert.equal(isMultiStatement('CREATE TABLE a(x);\nCREATE TRIGGER t BEFORE UPDATE ON a\nBEGIN SELECT RAISE(ABORT, \'x\'); END;'), true);
  assert.equal(isMultiStatement('SELECT 1;'), false);
  assert.equal(isMultiStatement("SELECT ';' AS s"), false);
  assert.equal(isMultiStatement('SELECT $1'), false);
});

test('hand-written SQLite migrations pass through the dialect unchanged', () => {
  const directory = new URL('../server/migrations-sqlite/', import.meta.url);
  const files = readdirSync(directory).filter(file => file.endsWith('.sql')).sort();
  assert.ok(files.length >= 3, `expected SQLite migrations, found ${files.length}`);
  for (const file of files) {
    const sql = readFileSync(new URL(file, directory), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(toSqlite(sql), sql, `${file} must be written in plain SQLite SQL`);
    assert.equal(isMultiStatement(sql), true, `${file} is a multi-statement script`);
  }
});
