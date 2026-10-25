/**
 * PostgreSQL -> SQLite dialect translation for the desktop build.
 *
 * The invoicing API was written once against PostgreSQL. The desktop app runs
 * the very same SQL against a local SQLite file: db.js feeds every statement
 * through toSqlite(), which rewrites the small set of PostgreSQL-only
 * constructs. String literals, quoted identifiers and comments are lifted out
 * first (as placeholder tokens), so only real SQL is ever rewritten, and the
 * hand-written SQLite migrations are already in SQLite form, so the rewrite is
 * an identity function on them (enforced by tests/sqlite-dialect.test.js).
 *
 * Covered:  $n -> @pn binds; inv.schema -> inv_schema; ILIKE -> LIKE (SQLite
 * LIKE is ASCII case-insensitive and this codebase uses no plain LIKE);
 * ::type casts -> CAST(); -> / ->> -> json_extract(); = ANY(json) ->
 * IN (SELECT value FROM json_each(json)); now()/CURRENT_DATE/CURRENT_TIMESTAMP;
 * now() + interval; date_trunc/to_char/extract/make_date -> strftime/printf;
 * json_agg|array_agg -> json_group_array; greatest|least -> max|min; btrim ->
 * trim; cardinality -> json_array_length; FOR UPDATE dropped (the writer lock
 * already serialises readers). Anything unknown throws instead of guessing.
 */

const OPEN = '\u0001';
const CLOSE = '\u0002';
const token = number => `${OPEN}${number}${CLOSE}`;
const tokenRe = new RegExp(`${OPEN}(\\d+)${CLOSE}`);
const tokenGlobalRe = new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g');

/** Lift string literals, quoted identifiers and comments out as tokens. */
export function extract(sql) {
  const literals = [];
  let code = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if ((ch === '-' && sql[i + 1] === '-') || (ch === '/' && sql[i + 1] === '*')) {
      const end = ch === '-' ? sql.indexOf('\n', i) : sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + (ch === '-' ? 1 : 2);
      code += token(literals.length);
      literals.push(sql.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) { j += 2; continue; }
          j += 1;
          break;
        }
        j += 1;
      }
      const stop = Math.min(j, sql.length);
      code += token(literals.length);
      literals.push(sql.slice(i, stop));
      i = stop;
      continue;
    }
    code += ch;
    i += 1;
  }
  return { code, literals };
}

/** Put every lifted literal back verbatim in a single pass. */
export function restore(code, literals) {
  return code.replace(tokenGlobalRe, (whole, index) => literals[Number(index)]);
}

/** Strip one layer of SQL quotes. */
const unquote = text => {
  const quote = text[0];
  if ((quote === "'" || quote === '"') && text.endsWith(quote)) {
    return text.slice(1, -1).replaceAll(quote + quote, quote);
  }
  return text;
};

/** Index of the ')' matching the '(' at `open`, or -1. */
function matchParen(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** Top-level argument spans of the call whose '(' is at `open`. */
function argsOf(code, open) {
  const close = matchParen(code, open);
  if (close === -1) return null;
  const spans = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i += 1) {
    const ch = code[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) { spans.push([start, i]); start = i + 1; }
  }
  spans.push([start, close]);
  return { spans, close };
}

/**
 * Start index of the SQL operand that ends at `end` (skipping trailing
 * space): a placeholder token, an identifier/qualified name such as a.paid_on
 * or @p1, or a parenthesised expression including its function name.
 */
function operandStart(code, end) {
  let i = end;
  while (i > 0 && /\s/.test(code[i - 1])) i -= 1;
  if (i === 0) return -1;
  if (code[i - 1] === CLOSE) {
    const match = code.slice(0, i).match(new RegExp(`${OPEN}(\\d+)${CLOSE}$`));
    return match ? i - match[0].length : -1;
  }
  if (code[i - 1] === ')') {
    let depth = 0;
    let j = i - 1;
    for (; j >= 0; j -= 1) {
      if (code[j] === ')') depth += 1;
      else if (code[j] === '(') { depth -= 1; if (depth === 0) break; }
    }
    if (j < 0) return -1;
    let k = j;
    while (k > 0 && /\s/.test(code[k - 1])) k -= 1;
    let wordStart = k;
    while (wordStart > 0 && /[A-Za-z0-9_$.]/.test(code[wordStart - 1])) wordStart -= 1;
    if (/^FILTER$/i.test(code.slice(wordStart, k))) {
      const beforeFilter = operandStart(code, wordStart);
      if (beforeFilter !== -1) return beforeFilter;
    }
    while (j > 0 && /[A-Za-z0-9_$.]/.test(code[j - 1])) j -= 1;
    return j;
  }
  let j = i;
  while (j > 0 && /[A-Za-z0-9_$@.]/.test(code[j - 1])) j -= 1;
  while (j < i && code[j] === '.') j += 1;
  if (/^END$/i.test(code.slice(j, i))) {
    const prefix = code.slice(0, j);
    const tokens = [...prefix.matchAll(/\b(CASE|END)\b/gi)];
    let depth = 1;
    for (let idx = tokens.length - 1; idx >= 0; idx -= 1) {
      if (tokens[idx][1].toUpperCase() === 'END') depth += 1;
      else {
        depth -= 1;
        if (depth === 0) return tokens[idx].index;
      }
    }
    return -1;
  }
  return j === i ? -1 : j;
}

/* PostgreSQL to_char format tokens, longest first; unknown letters throw. */
const DATE_FORMAT_TOKENS = [
  ['YYYY', '%Y'], ['YY', '%y'], ['MONTH', '%B'], ['Mon', '%b'], ['MM', '%m'], ['DD', '%d'],
  ['HH24', '%H'], ['HH12', '%I'], ['HH', '%I'], ['MI', '%M'], ['SS', '%S'], ['AM', '%p'], ['fm', ''],
];

const DATE_TRUNC_FORMATS = {
  year: '%Y-01-01', month: '%Y-%m-01', day: '%Y-%m-%d',
  hour: '%Y-%m-%d %H:00:00', minute: '%Y-%m-%d %H:%M:00', second: '%Y-%m-%d %H:%M:%S',
};

const EXTRACT_FORMATS = {
  year: '%Y', month: '%m', day: '%d', hour: '%H', minute: '%M', second: '%S', dow: '%w', doy: '%j',
};

const CAST_TYPES = {
  date: 'TEXT', uuid: 'TEXT', text: 'TEXT', json: 'TEXT', jsonb: 'TEXT',
  'text[]': 'TEXT', 'uuid[]': 'TEXT', 'int[]': 'TEXT',
  int: 'INTEGER', integer: 'INTEGER', bigint: 'INTEGER', smallint: 'INTEGER',
  boolean: 'INTEGER', bool: 'INTEGER',
};

const fail = (message, code) => {
  throw new Error(`${message}\n  in: ${code.slice(0, 160).replaceAll('\n', ' ')}`);
};

function translateDateFormat(format, code) {
  let out = '';
  let i = 0;
  while (i < format.length) {
    const rest = format.slice(i);
    const found = DATE_FORMAT_TOKENS.find(([name]) => rest.startsWith(name));
    if (found) { out += found[1]; i += found[0].length; continue; }
    if (/[A-Za-z]/.test(format[i])) fail(`Unsupported to_char token near '${rest.slice(0, 8)}'`, code);
    out += format[i];
    i += 1;
  }
  return out;
}

/** Rewrite one PostgreSQL statement to SQLite. Throws on anything unknown. */
export function toSqlite(sql) {
  const { code: source, literals } = extract(sql);
  let code = source;
  const raw = number => literals[number];
  const value = number => unquote(literals[number]);

  // 0. PostgreSQL schema creation is a no-op on SQLite.
  code = code.replace(/\bCREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+inv\b/gi, 'SELECT 1');

  // 1. bind parameters: $12 -> @p12 (SQLite named parameters).
  code = code.replace(/\$(\d+)/g, '@p$1');

  // 2. now() +/- interval, both shapes used by session, share and rate-limit writes.
  code = code.replace(/now\(\)\s*([+-])\s*interval\s*\u0001(\d+)\u0002/gi, (whole, sign, index) => {
    const spec = /^(?:')?\s*([+-]?\d+)\s+([a-z]+)\s*(?:')?$/i.exec(raw(Number(index)));
    if (!spec) fail(`Unsupported interval literal: ${raw(Number(index))}`, code);
    const num = spec[1].replace(/^[+-]/, '');
    const prefix = spec[1].startsWith('-') ? (sign === '-' ? '+' : '-') : sign;
    return `datetime('now', '${prefix}${num} ${spec[2].toLowerCase()}')`;
  });
  for (;;) {
    const head = /now\(\)\s*\+\s*\(/i.exec(code);
    if (!head) break;
    const open = head.index + head[0].length - 1;
    const close = matchParen(code, open);
    if (close === -1) fail('Unbalanced now() + ( ...', code);
    const inner = code.slice(open + 1, close);
    const scaled = /^([\s\S]+?)\s*\*\s*interval\s+\u0001(\d+)\u0002\s*$/.exec(inner);
    if (!scaled) break;
    const spec = /^(?:')?\s*(\d+)\s+([a-z]+)\s*(?:')?$/i.exec(value(Number(scaled[2])));
    if (!spec) fail(`Unsupported interval literal: ${raw(Number(scaled[2]))}`, code);
    const unit = spec[2].toLowerCase();
    const plural = unit.endsWith('s') ? unit : `${unit}s`;
    const times = spec[1] === '1' ? '' : ` * ${spec[1]}`;
    const built = `datetime('now', printf('+%d ${plural}', CAST(${scaled[1].trim()} AS INTEGER)${times}))`;
    code = code.slice(0, head.index) + built + code.slice(close + 1);
  }

  // 2b. CURRENT_DATE arithmetic: CURRENT_DATE +/- N, CURRENT_DATE +/- (expr), CURRENT_DATE - column.
  for (;;) {
    const head = /\bCURRENT_DATE\s*([+-])\s*\(/i.exec(code);
    if (!head) break;
    const open = head.index + head[0].length - 1;
    const close = matchParen(code, open);
    if (close === -1) fail('Unbalanced CURRENT_DATE +/- ( ...', code);
    const inner = code.slice(open + 1, close).trim();
    const built = `date('now', printf('${head[1]}%d days', CAST((${inner}) AS INTEGER)))`;
    code = code.slice(0, head.index) + built + code.slice(close + 1);
  }
  code = code.replace(/\bCURRENT_DATE\s*([+-])\s*(\d+)\b/gi,
    (_, sign, days) => `date('now', '${sign}${days} days')`);
  code = code.replace(/\bCURRENT_DATE\s*-\s*([A-Za-z_][A-Za-z0-9_.]*)\b/gi,
    "CAST(julianday(date('now')) - julianday($1) AS INTEGER)");

  // 3. to_char(x, 'YYYY-MM') -> strftime('%Y-%m', x).
  for (;;) {
    const head = /\bto_char\s*\(/i.exec(code);
    if (!head) break;
    const open = head.index + head[0].length - 1;
    const parsed = argsOf(code, open);
    if (!parsed || parsed.spans.length < 2) fail('to_char needs two arguments', code);
    const formatToken = tokenRe.exec(code.slice(parsed.spans[1][0], parsed.spans[1][1]).trim());
    if (!formatToken || formatToken[0] !== code.slice(parsed.spans[1][0], parsed.spans[1][1]).trim()) {
      fail('to_char format must be a single literal', code);
    }
    const format = translateDateFormat(value(Number(formatToken[1])), code);
    const first = code.slice(parsed.spans[0][0], parsed.spans[0][1]).trim();
    code = code.slice(0, head.index) + `strftime('${format}', ${first})` + code.slice(parsed.close + 1);
  }

  // 4. date_trunc('month', x) -> strftime('%Y-%m-01', x).
  for (;;) {
    const head = /\bdate_trunc\s*\(/i.exec(code);
    if (!head) break;
    const open = head.index + head[0].length - 1;
    const parsed = argsOf(code, open);
    if (!parsed || parsed.spans.length !== 2) fail('date_trunc needs two arguments', code);
    const unitToken = code.slice(parsed.spans[0][0], parsed.spans[0][1]).trim();
    const match = tokenRe.exec(unitToken);
    if (!match || match[0] !== unitToken) fail('date_trunc unit must be a literal', code);
    const format = DATE_TRUNC_FORMATS[value(Number(match[1])).toLowerCase()];
    if (!format) fail(`Unsupported date_trunc unit: ${value(Number(match[1]))}`, code);
    const second = code.slice(parsed.spans[1][0], parsed.spans[1][1]).trim();
    code = code.slice(0, head.index) + `strftime('${format}', ${second})` + code.slice(parsed.close + 1);
  }

  // 5. extract(month FROM x) -> CAST(strftime('%m', x) AS INTEGER).
  for (;;) {
    const head = /\bextract\s*\(/i.exec(code);
    if (!head) break;
    const open = head.index + head[0].length - 1;
    const parsed = argsOf(code, open);
    if (!parsed || parsed.spans.length !== 1) fail('Only extract(unit FROM x) is supported', code);
    const body = code.slice(parsed.spans[0][0], parsed.spans[0][1]);
    const parts = /^\s*([a-z]+)\s+FROM\s+([\s\S]+)$/i.exec(body);
    if (!parts) fail(`Unsupported extract form: ${body.trim()}`, code);
    const format = EXTRACT_FORMATS[parts[1].toLowerCase()];
    if (!format) fail(`Unsupported extract unit: ${parts[1]}`, code);
    const built = `CAST(strftime('${format}', ${parts[2].trim()}) AS INTEGER)`;
    code = code.slice(0, head.index) + built + code.slice(parsed.close + 1);
  }

  // 6. make_date(y, m, d) -> printf('%04d-%02d-%02d', y, m, d).
  for (;;) {
    const head = /\bmake_date\s*\(/i.exec(code);
    if (!head) break;
    const open = head.index + head[0].length - 1;
    const parsed = argsOf(code, open);
    if (!parsed || parsed.spans.length !== 3) fail('make_date needs three arguments', code);
    const parts = parsed.spans.map(([start, end]) => code.slice(start, end).trim()).join(', ');
    code = code.slice(0, head.index) + `printf('%04d-%02d-%02d', ${parts})` + code.slice(parsed.close + 1);
  }

  // 7. json operators: a->>'k' and a->'k' both become json_extract(a, '$."k"').
  for (;;) {
    const head = /->>?/.exec(code);
    if (!head) break;
    const start = operandStart(code, head.index);
    if (start === -1) fail('Cannot parse json operator operand', code);
    let after = head.index + head[0].length;
    while (after < code.length && /\s/.test(code[after])) after += 1;
    const keyToken = tokenRe.exec(code.slice(after));
    if (!keyToken || keyToken.index !== 0) fail('json operator key must be a single literal', code);
    const key = value(Number(keyToken[1]));
    const operand = code.slice(start, head.index).trimEnd();
    const path = `'$."${key.replaceAll('"', '""')}"'`;
    const built = `json_extract(${operand}, ${path})`;
    code = code.slice(0, start) + built + code.slice(after + keyToken[0].length);
  }

  // 8. casts: x::type -> CAST(x AS TYPE); unknown types throw loudly.
  for (;;) {
    const at = code.indexOf('::');
    if (at === -1) break;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*\[\s*\])?)/.exec(code.slice(at + 2));
    if (!match) fail('Unsupported cast', code);
    const type = match[1].replace(/\s+/g, '').toLowerCase();
    const sqlType = CAST_TYPES[type];
    if (!sqlType) fail(`Unsupported cast type: ${match[1]}`, code);
    const start = operandStart(code, at);
    if (start === -1) fail('Cannot parse cast operand', code);
    const operand = code.slice(start, at).trimEnd();
    const built = `CAST(${operand} AS ${sqlType})`;
    code = code.slice(0, start) + built + code.slice(at + 2 + match[0].length);
  }

  // 9. x = ANY(json) -> x IN (SELECT value FROM json_each(json)).
  for (;;) {
    const head = /=\s*ANY\s*\(/i.exec(code);
    if (!head) break;
    const open = head.index + head[0].length - 1;
    const close = matchParen(code, open);
    if (close === -1) fail('Unbalanced ANY(', code);
    const operand = code.slice(open + 1, close).trim();
    const built = `IN (SELECT value FROM json_each(${operand}))`;
    code = code.slice(0, head.index) + built + code.slice(close + 1);
  }
  if (/\bANY\s*\(/i.test(code)) fail('ANY() here must be written as = ANY(...)', code);

  // 9b. x ~ 'pattern' -> x REGEXP 'pattern' (db.js registers regexp()).
  for (;;) {
    const head = /~(?=\s*\u0001)/.exec(code);
    if (!head) break;
    const start = operandStart(code, head.index);
    if (start === -1) fail('Cannot parse regex operator operand', code);
    const operand = code.slice(start, head.index).trimEnd();
    code = code.slice(0, start) + operand + ' REGEXP' + code.slice(head.index + 1);
  }

  // 10. keyword and function swaps (identifiers are safe: word boundaries).
  code = code.replace(/\bFOR\s+UPDATE\b/gi, ' ');
  // Parenthesised so `DEFAULT now()` also becomes valid SQLite DDL.
  code = code.replace(/\bnow\s*\(\s*\)/gi, "(datetime('now'))");
  code = code.replace(/\bCURRENT_DATE\b/gi, "(date('now'))");
  code = code.replace(/\bCURRENT_TIMESTAMP\b/gi, "(datetime('now'))");
  code = code.replace(/\bCURRENT_TIME\b/gi, "(time('now'))");
  code = code.replace(/\bILIKE\b/gi, 'LIKE');
  code = code.replace(/\bjsonb?_agg\s*\(/gi, 'json_group_array(');
  code = code.replace(/\barray_agg\s*\(/gi, 'json_group_array(');
  code = code.replace(/\bgreatest\s*\(/gi, 'max(');
  code = code.replace(/\bleast\s*\(/gi, 'min(');
  code = code.replace(/\bbtrim\s*\(/gi, 'trim(');
  code = code.replace(/\bcardinality\s*\(/gi, 'json_array_length(');

  // 11. fold the inv schema into table prefixes (SQLite has no schemas).
  code = code.replace(/(?<![\w.$])inv\./g, 'inv_');

  return restore(code, literals);
}

/** True when the statement needs db.exec() instead of a prepared statement. */
export function isMultiStatement(sql) {
  const { code } = extract(sql);
  let depth = 0;
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') depth -= 1;
    else if (code[i] === ';' && depth === 0 && /\S/.test(code.slice(i + 1))) return true;
  }
  return false;
}
