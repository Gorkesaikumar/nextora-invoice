import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { toSqlite, isMultiStatement } from './sqlite/dialect.js';

// Date-only columns stay timezone-independent strings, exactly like the website.
pg.types.setTypeParser(1082, value => value);

// bigint money columns must become exact integers, never strings and never floats.
pg.types.setTypeParser(20, value => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    const error = new Error('A stored amount exceeds the exact integer range.');
    error.status = 500;
    error.code = 'ARITHMETIC_OVERFLOW';
    throw error;
  }
  return parsed;
});

let database;

/**
 * DATABASE_URL selects the PostgreSQL backend (web/dev/tests); otherwise a
 * local SQLite file is used (desktop): DATABASE_PATH, defaulting to
 * ./data/nextora.sqlite for command-line scripts. The Electron main process
 * always sets DATABASE_PATH under app.getPath('userData').
 */
export function getDatabase() {
  if (!database) database = process.env.DATABASE_URL ? openPostgres() : openSqlite();
  return database;
}

function openPostgres() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 8000,
    statement_timeout: 15000,
  });
  return {
    driver: 'postgres',
    query: (sql, values) => pool.query(sql, values),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    vacuum: () => Promise.resolve(),
    checkpoint: () => Promise.resolve(),
    integrityCheck: () => Promise.resolve({ ok: true, integrity: 'ok', foreign_keys: [] }),
    close: () => pool.end(),
  };
}

/* ------------------------------------------------------------------ SQLite */

const arithmeticOverflow = () => {
  const error = new Error('A stored amount exceeds the exact integer range.');
  error.status = 500;
  error.code = 'ARITHMETIC_OVERFLOW';
  return error;
};

/**
 * Re-raise SQLite constraint failures with the PostgreSQL SQLSTATE codes the
 * API layer already understands (23505 -> 409 DUPLICATE, 23503 -> 409 IN_USE).
 * RAISE(ABORT) from the integrity triggers becomes P0001 (raise_exception),
 * which is what a PL/pgSQL RAISE would have produced.
 */
function sqliteError(error) {
  if (error?.code !== 'ERR_SQLITE_ERROR') return error;
  const message = String(error.message || '');
  const errcode = Number(error.errcode || 0);
  let sqlstate = null;
  if (errcode === 2067 || errcode === 1555 || /UNIQUE constraint failed/.test(message)) sqlstate = '23505';
  else if (errcode === 787 || /FOREIGN KEY constraint failed/.test(message)) sqlstate = '23503';
  else if (errcode === 1299 || /NOT NULL constraint failed/.test(message)) sqlstate = '23502';
  else if (errcode === 275 || /CHECK constraint failed/.test(message)) sqlstate = '23514';
  else if (errcode === 1811) sqlstate = 'P0001';
  else if (errcode === 19) sqlstate = '23000';
  if (!sqlstate) return error;
  const mapped = new Error(message);
  mapped.code = sqlstate;
  mapped.status = 500;
  mapped.cause = error;
  return mapped;
}

const isoStamp = date => date.toISOString().replace('T', ' ').replace('Z', '');
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const JSON_COLUMNS = new Set([
  'totals', 'additional_charges', 'options', 'editor_roles', 'filter', 'columns', 'metadata', 'recipients', 'customer_ids',
]);

/** Bind values the way node-postgres would have delivered them. */
function bindValue(value) {
  if (value === null || value === undefined) return null;
  const type = typeof value;
  if (type === 'boolean') return value ? 1 : 0;
  if (type === 'number') return value;
  if (type === 'string') {
    if (ISO_DATETIME_RE.test(value)) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return isoStamp(parsed);
    }
    return value;
  }
  if (type === 'bigint') {
    if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
    return String(value); // INTEGER affinity stores it losslessly.
  }
  if (value instanceof Date) return isoStamp(value);
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return value;
  return JSON.stringify(value); // arrays and objects arrive as JSON text.
}

const parseTimestamp = text => {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text) ? `${text.replace(' ', 'T')}Z` : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? text : date;
};

/**
 * Convert one SQLite cell to what node-postgres returned for the same column:
 * BOOLEAN -> true/false, JSONB/text[] -> parsed values, TIMESTAMPTZ -> Date
 * (the pg default parser; DATE stays a plain string via the 1082 override),
 * integers -> exact safe numbers with the same overflow error as pg.
 */
function mapValue(value, type, columnName = '') {
  if (value === null || value === undefined) return null;
  const declared = String(type || '').toLowerCase();
  const isBool = declared.includes('bool');
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'bigint') {
    if (isBool) return value !== 0n;
    if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
    throw arithmeticOverflow();
  }
  if (isBool) return Boolean(value);
  if (declared === 'jsonb' || declared === 'json' || declared.endsWith('[]') || JSON_COLUMNS.has(columnName)) {
    return typeof value === 'string' ? JSON.parse(value) : value;
  }
  if (declared === 'timestamptz' || declared === 'timestamp') {
    return typeof value === 'string' ? parseTimestamp(value) : value;
  }
  return value;
}

function registerFunctions(db) {
  // `col REGEXP 'pattern'` in CHECK constraints and queries.
  db.function('regexp', { deterministic: true }, (pattern, value) => {
    if (pattern === null || value === null || value === undefined) return null;
    return new RegExp(String(pattern)).test(String(value)) ? 1 : 0;
  });
  // PostgreSQL's `array_a <@ array_b` subset check for editor_roles.
  db.function('subset_of', { deterministic: true }, (value, allowed) => {
    if (value === null || allowed === null) return null;
    const set = new Set(JSON.parse(String(allowed)));
    return JSON.parse(String(value)).every(role => set.has(role)) ? 1 : 0;
  });
  // scripts/migrate.js takes a cross-process advisory lock; writes are already
  // serialised by the single-connection queue below, so this is a no-op.
  db.function('pg_advisory_xact_lock', (_key) => null);
}

function openConnection(file) {
  const conn = new DatabaseSync(file, { enableForeignKeyConstraints: true });
  conn.exec('PRAGMA journal_mode=WAL');
  conn.exec('PRAGMA synchronous=NORMAL');
  conn.exec('PRAGMA busy_timeout=5000');
  registerFunctions(conn);
  return conn;
}

function openSqlite() {
  const file = process.env.DATABASE_PATH || resolve(process.cwd(), 'data', 'nextora.sqlite');
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  let db = openConnection(file);

  const statements = new Map(); // translated SQL -> compiled statement
  const translations = new Map(); // original SQL -> translated SQL
  const columnInfo = new WeakMap();
  const context = new AsyncLocalStorage();
  let chain = Promise.resolve(); // serialises writers; SQLite has one connection
  let closed = false;

  const compile = text => {
    let entry = statements.get(text);
    if (!entry) {
      const stmt = db.prepare(text);
      stmt.setReadBigInts(true);
      entry = { stmt, columns: stmt.columns() };
      if (statements.size >= 300) statements.delete(statements.keys().next().value);
      statements.set(text, entry);
    }
    return entry;
  };

  const translate = sql => {
    let text = translations.get(sql);
    if (text === undefined) {
      text = toSqlite(sql);
      if (translations.size >= 300) translations.delete(translations.keys().next().value);
      translations.set(sql, text);
    }
    return text;
  };

  function execute(sql, values) {
    const text = translate(sql);
    try {
      if (isMultiStatement(text)) {
        if (values && values.length) throw new TypeError('Multi-statement SQL cannot take parameters.');
        db.exec(text);
        return { rows: [], rowCount: 0 };
      }
      const { stmt, columns } = compile(text);
      let named = null;
      if (values && values.length) {
        named = {};
        const used = new Set();
        for (const token of text.match(/@p\d+/g) || []) used.add(Number(token.slice(2)));
        for (const index of used) {
          if (index > values.length) throw new Error(`A query parameter $${index} is missing.`);
          named[`p${index}`] = bindValue(values[index - 1]);
        }
      }
      if (columns.length === 0) {
        const info = named ? stmt.run(named) : stmt.run();
        return { rows: [], rowCount: Number(info.changes) };
      }
      const raw = named ? stmt.all(named) : stmt.all();
      const rows = raw.map(row => {
        const mapped = {};
        for (const column of columns) mapped[column.name] = mapValue(row[column.name], column.type, column.name);
        return mapped;
      });
      return { rows, rowCount: rows.length };
    } catch (error) {
      throw sqliteError(error);
    }
  }

  function currentTransaction() {
    return {
      async query(sql, values) {
        return execute(sql, values);
      },
      async transaction(fn) {
        const store = context.getStore();
        const depth = (store?.depth ?? 0) + 1;
        const name = `savepoint_${depth}`;
        execute(`SAVEPOINT ${name}`);
        try {
          const result = await fn(currentTransaction());
          execute(`RELEASE ${name}`);
          return result;
        } catch (error) {
          try { execute(`ROLLBACK TO ${name}`); execute(`RELEASE ${name}`); } catch { /* outer will roll back */ }
          throw error;
        }
      },
    };
  }

  const enqueue = task => {
    const result = chain.then(task, task);
    chain = result.then(() => undefined, () => undefined);
    return result;
  };

  const backend = {
    driver: 'sqlite',
    file,
    query(sql, values) {
      if (closed) return Promise.reject(new Error('The database is closed.'));
      try {
        if (context.getStore()) return Promise.resolve(execute(sql, values));
        return enqueue(() => execute(sql, values));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    transaction(fn) {
      if (closed) return Promise.reject(new Error('The database is closed.'));
      if (context.getStore()) {
        try { return Promise.resolve(fn(currentTransaction())); } catch (error) { return Promise.reject(error); }
      }
      return enqueue(() => context.run({ depth: 0 }, async () => {
        execute('BEGIN IMMEDIATE');
        try {
          const result = await fn(currentTransaction());
          execute('COMMIT');
          return result;
        } catch (error) {
          try { execute('ROLLBACK'); } catch { /* connection already unwound */ }
          throw error;
        }
      }));
    },
    async backupTo(destination) {
      await enqueue(async () => { await backup(db, destination); });
    },
    async replaceWith(stagedFile) {
      await enqueue(async () => {
        statements.clear();
        try { db.close(); } catch { /* ignore */ }
        for (const suffix of ['-wal', '-shm']) {
          if (existsSync(`${file}${suffix}`)) rmSync(`${file}${suffix}`, { force: true });
        }
        if (existsSync(file)) rmSync(file, { force: true });
        renameSync(stagedFile, file);
        db = openConnection(file);
      });
    },
    async vacuum() {
      if (file === ':memory:') return;
      await enqueue(async () => {
        statements.clear();
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        db.exec('VACUUM');
      });
    },
    async checkpoint() {
      if (file === ':memory:') return;
      await enqueue(async () => {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      });
    },
    async integrityCheck() {
      return enqueue(async () => {
        const integrityRows = db.prepare('PRAGMA integrity_check').all();
        const integrityOk = integrityRows.length === 1 && String(integrityRows[0].integrity_check).toLowerCase() === 'ok';
        const fkRows = db.prepare('PRAGMA foreign_key_check').all();
        return {
          ok: integrityOk && fkRows.length === 0,
          integrity: integrityOk ? 'ok' : String(integrityRows[0]?.integrity_check || 'corrupt'),
          foreign_keys: fkRows.map(row => ({
            table: row.table,
            rowid: Number(row.rowid),
            parent: row.parent,
            fkid: Number(row.fkid),
          })),
        };
      });
    },
    async close() {
      closed = true;
      await chain;
      try { db.close(); } catch { /* already closed */ }
      if (database === backend) database = undefined;
    },
  };
  return backend;
}
