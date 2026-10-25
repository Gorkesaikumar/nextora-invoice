import ExcelJS from 'exceljs';
import { assert, HttpError } from './domain.js';
import { audit } from './audit.js';
import { insertCustomer, normalizeFieldValue } from './tracker.js';

/**
 * Excel and CSV integration for the customer tracker.
 *
 * Two rules drive what is written here:
 *
 * 1. A downloaded file is a document someone will open in Excel, so text that
 *    looks like a formula is neutralised before it leaves the server.
 * 2. An import never overwrites stored data silently, and every row that is
 *    refused is reported back with its row number and reason.
 */

const MAX_IMPORT_ROWS = 5000;

/** Excel treats these leading characters as the start of a formula. */
const RISKY = /^[=+\-@\t\r]/;

/**
 * Only strings are escaped: numeric cells keep their numeric type, and a value
 * that is genuinely a number (including a negative one) is never quoted.
 */
export function sanitizeCell(value) {
  if (typeof value !== 'string') return value;
  const text = value.replace(/\u0000/g, '');
  return RISKY.test(text) ? `'${text}` : text;
}

const isNumeric = value => typeof value === 'number' && Number.isFinite(value);

/** The value a column contributes to an export or a shared view. */
export function cellValue(row, column) {
  if (column.custom) return row.custom?.[column.key] ?? '';
  switch (column.key) {
    case 'serial': return row.serial;
    case 'employee_name': return row.employee_name || '';
    case 'product_name': return row.product_name || '';
    case 'plan_label': return row.plan_label || (row.is_lifetime ? 'Lifetime' : '');
    case 'purchase_date': return row.purchase_date || '';
    case 'expiry_date': return row.is_lifetime ? 'Lifetime' : (row.expiry_date || '');
    case 'address': case 'remarks': return row[column.key] || '';
    default: return row[column.key] ?? '';
  }
}

function typedCell(value, column) {
  if (value === '' || value === null || value === undefined) return { value: '' };
  if (isNumeric(value)) return { value };
  const text = String(value);
  if (['DATE'].includes(column.type) && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    // Written as a real date so Excel sorts and filters it as a date.
    return { value: new Date(`${text}T00:00:00Z`), numFmt: 'yyyy-mm-dd' };
  }
  if (column.type === 'CURRENCY' && /^-?\d+(\.\d+)?$/.test(text)) return { value: Number(text) };
  if (column.type === 'NUMBER' && /^-?\d+(\.\d+)?$/.test(text)) return { value: Number(text) };
  return { value: sanitizeCell(text) };
}

/** Metadata sheet: field name, type, whether it is required and its options. */
function describeColumns(columns) {
  return columns.map(column => ({
    key: column.key, label: column.label, type: column.type,
    required: column.required ? 'yes' : 'no',
    scope: column.custom ? 'custom field' : 'default column',
    options: (column.options || []).join(', '),
    description: column.description || '',
  }));
}

export async function exportWorkbook({ columns, rows, title = 'POS Customers', filters = {} }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Nextora Creations Invoicing';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Customers');
  sheet.columns = columns.map(column => ({ header: column.label, key: column.key,
    width: Math.min(60, Math.max(14, Math.round((column.width || 160) / 7))) }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  for (const row of rows) {
    const record = {};
    for (const column of columns) {
      const cell = typedCell(cellValue(row, column), column);
      record[column.key] = cell.value;
      if (cell.numFmt) record[`__fmt_${column.key}`] = cell.numFmt;
    }
    const added = sheet.addRow(record);
    for (const column of columns) {
      const format = record[`__fmt_${column.key}`];
      if (format) added.getCell(column.key).numFmt = format;
    }
  }
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, columns.length) } };

  const meta = workbook.addWorksheet('Columns');
  meta.addRow(['Column', 'Label', 'Type', 'Required', 'Scope', 'Options', 'Description']);
  meta.getRow(1).font = { bold: true };
  for (const column of describeColumns(columns)) {
    meta.addRow([column.key, column.label, column.type, column.required, column.scope, column.options, column.description]);
  }
  meta.addRow([]);
  meta.addRow(['Exported', new Date().toISOString()]);
  meta.addRow(['Rows', rows.length]);
  for (const [key, value] of Object.entries(filters)) {
    if (value) meta.addRow([`Filter: ${key}`, String(value)]);
  }
  meta.columns = [{ width: 32 }, { width: 28 }, { width: 14 }, { width: 10 }, { width: 16 }, { width: 34 }, { width: 40 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Excel opens a CSV without a byte-order mark as mojibake, so one is written. */
export async function exportCsv({ columns, rows }) {
  const escape = value => {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map(column => escape(column.label)).join(',')];
  for (const row of rows) {
    lines.push(columns.map(column => escape(sanitizeCell(cellValue(row, column)))).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** An import template: the live columns, one labelled example row, no invented data. */
export async function exportTemplate({ columns }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Customers');
  sheet.columns = columns.map(column => ({ header: column.label, key: column.key,
    width: Math.min(60, Math.max(14, Math.round((column.width || 160) / 7))) }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(2).values = columns.map(column => {
    if (column.key === 'name') return 'Example - replace this row';
    if (column.type === 'DATE') return 'YYYY-MM-DD';
    if (column.type === 'DROPDOWN') return (column.options || [])[0] || '';
    if (column.type === 'CHECKBOX') return 'yes';
    if (column.required) return `(${column.label} is required)`;
    return '';
  });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
  const notes = workbook.addWorksheet('How to import');
  notes.addRow(['Column', 'Type', 'Required', 'Options', 'Notes']);
  notes.getRow(1).font = { bold: true };
  for (const column of describeColumns(columns)) {
    notes.addRow([column.label, column.type, column.required, column.options, column.description]);
  }
  notes.addRow([]);
  notes.addRow(['Import rules', '']);
  notes.addRow(['Dates', 'Use YYYY-MM-DD, or let Excel format them as dates.']);
  notes.addRow(['Duplicate rows', 'Rows matching an existing customer are reported instead of being overwritten.']);
  notes.addRow(['Products and plans', 'Use names that already exist, or leave blank to set them later.']);
  notes.columns = [{ width: 28 }, { width: 14 }, { width: 10 }, { width: 30 }, { width: 60 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/* ------------------------------------------------------------------ reading */

/** Minimal RFC 4180 reader; the delimiter is sniffed from the first line. */
export function parseCsv(text) {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstLine = clean.split('\n')[0] || '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < clean.length; index += 1) {
    const character = clean[index];
    if (quoted) {
      if (character === '"' && clean[index + 1] === '"') { field += '"'; index += 1; } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === delimiter) { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(line => line.some(cell => String(cell).trim() !== ''));
}

const formatCell = value => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text).join('');
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return String(value.result);
    return '';
  }
  return String(value).trim();
};

export async function readSpreadsheet(buffer, filename = '') {
  const name = filename.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const rows = parseCsv(buffer.toString('utf8'));
    const [headers = [], ...body] = rows;
    return { headers: headers.map(header => header.trim()), rows: body };
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new HttpError(400, 'That file could not be read. Upload an .xlsx or .csv file.', 'UNSUPPORTED_FILE');
  }
  const sheet = workbook.worksheets[0];
  assert(sheet, 400, 'The workbook has no sheets.', 'EMPTY_FILE');
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, row => {
    rows.push(row.values.slice(1).map(formatCell));
  });
  const [headers = [], ...body] = rows;
  return { headers: headers.map(header => String(header).trim()), rows: body };
}

/* ------------------------------------------------------------------ writing */

const normalizeHeader = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Headers are matched to columns by label first, which is what a spreadsheet
 * exported from this application round-trips to.
 */
export function autoMap(headers, columns) {
  const mapping = {};
  const byLabel = new Map(columns.map(column => [normalizeHeader(column.label), column.key]));
  const byKey = new Map(columns.map(column => [normalizeHeader(column.key), column.key]));
  headers.forEach(header => {
    const key = byLabel.get(normalizeHeader(header)) || byKey.get(normalizeHeader(header));
    if (key) mapping[header] = key;
  });
  return mapping;
}

const DATE_KEYS = ['purchase_date', 'expiry_date'];

function parseDate(value) {
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  // Excel and CSV exports hand back formats like 12/10/2026 or 12-Oct-2026.
  const parts = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/) || text.match(/^(\d{1,2})[ -]([A-Za-z]{3,})[ -](\d{2,4})$/);
  if (!parts) return null;
  let day; let month; let year;
  if (/^\d+$/.test(parts[2])) { day = Number(parts[1]); month = Number(parts[2]); year = Number(parts[3]); }
  else {
    day = Number(parts[1]);
    month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
      .indexOf(parts[2].slice(0, 3).toLowerCase()) + 1;
    year = Number(parts[3]);
  }
  if (year < 100) year += 2000;
  if (!day || !month || !year) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Validates every row before anything is written, so the operator sees all the
 * problems at once and an import either fully applies or fully fails.
 */
export async function planImport(db, { headers = [], rows, mapping, defaults = {} }) {
  const products = (await db.query('SELECT id,name FROM inv.products WHERE status=\'ACTIVE\'')).rows;
  const plans = (await db.query('SELECT id,label,is_lifetime,duration_months FROM inv.pos_subscription_plans WHERE status=\'ACTIVE\'')).rows;
  const employees = (await db.query('SELECT id,name FROM inv.pos_employees WHERE status=\'ACTIVE\'')).rows;
  const fields = (await db.query(`SELECT * FROM inv.custom_field_definitions WHERE entity='POS_CUSTOMER' AND status='ACTIVE'`)).rows;
  const find = (list, value, key = 'name') => list.find(item => normalizeHeader(item[key]) === normalizeHeader(value));
  const errors = [];
  const staged = [];
  assert(rows.length <= MAX_IMPORT_ROWS, 413,
    `Import at most ${MAX_IMPORT_ROWS} rows at a time; split the file and import it in parts.`, 'PAYLOAD_TOO_LARGE');

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // header is row 1
    const errorsBefore = errors.length;
    const candidate = { subscription: null, custom: {} };
    // Each cell is read at the position of its own header in the uploaded file,
    // so a mapping built in any order still reads the right column.
    const headerIndexes = new Map(headers.flatMap((header, position) => {
      const key = mapping[header];
      return key ? [[key, position]] : [];
    }));
    const raw = key => (headerIndexes.has(key) ? String(row[headerIndexes.get(key)] ?? '').trim() : '');
    candidate.name = raw('name');
    candidate.business_name = raw('business_name');
    candidate.address = raw('address');
    candidate.remarks = raw('remarks');
    candidate.phone = raw('phone');
    candidate.email = raw('email');
    if (!candidate.name) { errors.push({ row: rowNumber, error: 'Customer Name is required.' }); return; }

    const employee = raw('employee_name');
    if (employee) {
      const match = find(employees, employee);
      if (!match) errors.push({ row: rowNumber, error: `Unknown employee "${employee}". Add the employee first.` });
      else candidate.employee_id = match.id;
    }
    const purchase = raw('purchase_date');
    const expiry = raw('expiry_date');
    const purchaseDate = purchase ? parseDate(purchase) : null;
    const expiryDate = expiry && !/^lifetime$/i.test(expiry) ? parseDate(expiry) : null;
    if (purchase && !purchaseDate) errors.push({ row: rowNumber, error: `Date of Purchase "${purchase}" is not a date.` });
    if (expiry && !expiryDate && !/^lifetime$/i.test(expiry)) {
      errors.push({ row: rowNumber, error: `Date of Expiry "${expiry}" is not a date or "Lifetime".` });
    }
    const productName = raw('product_name');
    const planLabel = raw('plan_label');
    let productId = defaults.default_product_id || null;
    let planId = defaults.default_plan_id || null;
    if (productName) {
      const match = find(products, productName);
      if (!match) errors.push({ row: rowNumber, error: `Unknown product "${productName}".` });
      else productId = match.id;
    }
    let plan = planId ? plans.find(item => item.id === planId) : null;
    if (planLabel) {
      const match = plans.find(item => normalizeHeader(item.label) === normalizeHeader(planLabel));
      if (!match) errors.push({ row: rowNumber, error: `Unknown subscription plan "${planLabel}".` });
      else { plan = match; planId = match.id; }
    }
    const lifetime = /^lifetime$/i.test(expiry) || Boolean(plan?.is_lifetime);

    if (purchaseDate || productId || planId || expiryDate || lifetime) {
      if (!purchaseDate) errors.push({ row: rowNumber, error: 'Date of Purchase is required when a subscription is given.' });
      candidate.subscription = {
        product_id: productId, plan_id: planId, plan_label: plan?.label || planLabel || '',
        purchase_date: purchaseDate, start_date: purchaseDate, is_lifetime: lifetime,
        expiry_date: lifetime ? null : expiryDate, status: 'ACTIVE', amount_minor: null,
        transaction_reference: raw('transaction_reference'), notes: '', renews: false,
      };
    }
    for (const field of fields) {
      const key = `custom:${field.id}`;
      if (!headerIndexes.has(key)) continue;
      try {
        candidate.custom[field.id] = normalizeFieldValue(field, raw(key));
      } catch (error) {
        errors.push({ row: rowNumber, error: error.message });
      }
    }
    candidate.__row = rowNumber;
    // A row with any problem is reported and left out of the import, while the
    // rows around it are still imported: nothing is ever written half-validated.
    candidate.__invalid = errors.length > errorsBefore;
    staged.push(candidate);
  });

  // Duplicates are reported for both the file and the database.
  const existing = (await db.query('SELECT id, name, business_name, phone, email FROM inv.pos_customers')).rows;
  const seen = new Map();
  const duplicates = [];
  for (const candidate of staged) {
    const clash = existing.find(row =>
      normalizeHeader(row.name) === normalizeHeader(candidate.name)
      && ((candidate.phone && row.phone === candidate.phone)
        || (candidate.email && normalizeHeader(row.email) === normalizeHeader(candidate.email))
        || (candidate.business_name && normalizeHeader(row.business_name) === normalizeHeader(candidate.business_name))));
    const inFile = seen.get(normalizeHeader(candidate.name));
    if (clash) duplicates.push({ row: candidate.__row, error: `Already exists as "${clash.name}".` });
    else if (inFile) duplicates.push({ row: candidate.__row, error: `Duplicate of row ${inFile} in this file.` });
    else seen.set(normalizeHeader(candidate.name), candidate.__row);
  }
  return { staged, errors, duplicates, headers: Object.keys(mapping) };
}

export async function applyImport(db, actor, { filename, staged, defaults = {} }) {
  const created = [];
  await db.transaction(async tx => {
    for (const candidate of staged) {
      const custom = candidate.custom;
      delete candidate.custom;
      const id = await insertCustomer(tx, actor, candidate);
      if (Object.keys(custom).length) {
        for (const [definitionId, value] of Object.entries(custom)) {
          if (value === '') continue;
          await tx.query(`INSERT INTO inv.custom_field_values(definition_id,customer_id,value,updated_by)
            VALUES($1,$2,$3,$4) ON CONFLICT (definition_id,customer_id)
            DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by`,
          [definitionId, id, value, actor.id]);
        }
      }
      created.push({ row: candidate.__row, id, name: candidate.name });
    }
    await audit(tx, 'TRACKER_IMPORT_APPLIED', { actorId: actor.id, entityType: 'TRACKER',
      metadata: { filename, created: created.length, defaults } });
  });
  return created;
}

export const importLimits = { MAX_IMPORT_ROWS };
