import { randomUUID } from 'node:crypto';
import { assert, DEFAULT_COLUMNS } from './domain.js';
import { audit } from './audit.js';
import { canWrite } from './auth.js';
import { pagination, searchTerm } from './service.js';

/**
 * The Nextora POS customer tracker.
 *
 * Two ideas shape this module:
 *
 * 1. A customer owns many subscriptions, so a renewal or an upgrade never
 *    erases the previous purchase. The spreadsheet shows the current
 *    subscription, and the customer view shows the whole history.
 * 2. Columns are data. Default columns come from DEFAULT_COLUMNS and custom
 *    columns from inv.custom_field_definitions, so adding a column never runs
 *    a migration and never rewrites an existing row.
 */

const escapeLike = value => value.replace(/[!%_]/g, '!$&');
const SORTS = {
  serial: 'c.created_at',
  name: 'lower(c.name)',
  business_name: 'lower(c.business_name)',
  purchase_date: 'sub.purchase_date',
  expiry_date: 'sub.expiry_date',
  product: 'lower(p.name)',
  employee: 'lower(e.name)',
};
const SUBSCRIPTION_FILTERS = ['', 'ACTIVE', 'EXPIRING_SOON', 'EXPIRING_7', 'EXPIRING_15', 'EXPIRING_30', 'EXPIRED', 'LIFETIME'];
/** Today is the database's date, so a browser clock cannot change what is "expiring". */
const currentDate = async db => (await db.query('SELECT current_date AS today')).rows[0].today;

/* ------------------------------------------------------------------- columns */

/**
 * Default columns keep their declared order and labels; the stored layout only
 * carries position, width and visibility so a resized or hidden column is
 * remembered without letting a client rename a system column.
 */
export async function columnCatalog(db) {
  const layout = (await db.query('SELECT key, position, visible, width FROM inv.pos_column_layout')).rows;
  const custom = (await db.query(`SELECT id,label,field_type,description,required,options,default_value,position,
      visible,width,editor_roles,status FROM inv.custom_field_definitions
    WHERE entity='POS_CUSTOMER' AND status='ACTIVE' ORDER BY position, lower(label)`)).rows;
  const byKey = new Map(layout.map(row => [row.key, row]));
  const columns = DEFAULT_COLUMNS.map((column, index) => {
    const stored = byKey.get(column.key);
    return { ...column, position: stored?.position ?? index, visible: stored?.visible ?? true,
      width: stored?.width ?? column.width, custom: false };
  });
  for (const field of custom) {
    columns.push({ key: `custom:${field.id}`, label: field.label, type: field.field_type, width: field.width,
      editable: true, required: field.required, visible: field.visible, position: field.position,
      options: field.options, description: field.description, editor_roles: field.editor_roles,
      definition_id: field.id, custom: true });
  }
  columns.sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
  return {
    columns,
    custom_fields: custom.map(field => ({ id: field.id, label: field.label, field_type: field.field_type,
      description: field.description, required: field.required, options: field.options,
      default_value: field.default_value, position: field.position, visible: field.visible,
      width: field.width, editor_roles: field.editor_roles })),
  };
}

export const columnKeys = catalog => catalog.columns.map(column => column.key);

/** Resolves the requested column list against the catalog; unknown keys are refused. */
export function resolveColumns(catalog, keys) {
  const available = new Map(catalog.columns.map(column => [column.key, column]));
  if (!keys || keys.length === 0) return catalog.columns.filter(column => column.visible || column.key === 'serial');
  return keys.map(key => {
    const column = available.get(key);
    assert(column, 400, `Unknown column ${key}.`, 'UNKNOWN_COLUMN');
    return column;
  });
}

export async function saveColumnLayout(db, actor, input) {
  await db.transaction(async tx => {
    for (const [index, column] of input.columns.entries()) {
      const key = column.key.startsWith('custom:') ? null : column.key;
      if (key) {
        await tx.query(`INSERT INTO inv.pos_column_layout(key,position,visible,width,updated_at,updated_by)
          VALUES($1,$2,$3,$4,now(),$5)
          ON CONFLICT (key) DO UPDATE SET position=EXCLUDED.position, visible=EXCLUDED.visible,
            width=EXCLUDED.width, updated_at=now(), updated_by=EXCLUDED.updated_by`,
        [key, index, column.visible, column.width, actor.id]);
      } else {
        const id = column.key.slice('custom:'.length);
        await tx.query(`UPDATE inv.custom_field_definitions SET position=$2, visible=$3, width=$4, updated_at=now()
          WHERE id=$1 AND entity='POS_CUSTOMER'`, [id, index, column.visible, column.width]);
      }
    }
    await audit(tx, 'TRACKER_LAYOUT_SAVED', { actorId: actor.id, entityType: 'TRACKER',
      metadata: { columns: input.columns.length } });
  });
  return columnCatalog(db);
}

/* ----------------------------------------------------------- custom fields */

export async function listCustomFields(db, { includeArchived = false } = {}) {
  const { rows } = await db.query(`SELECT d.*, (SELECT count(*) FROM inv.custom_field_values v WHERE v.definition_id=d.id
      AND v.value <> '')::int AS value_count
    FROM inv.custom_field_definitions d
    WHERE entity='POS_CUSTOMER' AND ($1 OR status='ACTIVE') ORDER BY position, lower(label)`, [includeArchived]);
  return rows;
}

export async function createCustomField(db, actor, input) {
  const id = randomUUID();
  await db.transaction(async tx => {
    const clash = (await tx.query(`SELECT id FROM inv.custom_field_definitions WHERE entity='POS_CUSTOMER' AND lower(label)=lower($1)`,
      [input.label])).rows[0];
    assert(!clash, 409, 'A column with this name already exists.', 'DUPLICATE_FIELD');
    const position = input.position || (await tx.query(
      'SELECT COALESCE(max(position),0)+1 AS next FROM inv.custom_field_definitions WHERE entity=\'POS_CUSTOMER\'')).rows[0].next;
    await tx.query(`INSERT INTO inv.custom_field_definitions(id,entity,label,field_type,description,required,options,
        default_value,position,visible,width,editor_roles,created_by)
      VALUES($1,'POS_CUSTOMER',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, input.label, input.field_type, input.description, input.required, JSON.stringify(input.options),
      input.default_value, position, input.visible, input.width, input.editor_roles, actor.id]);
    // A new column must not invalidate existing customers: a default value is
    // written only when the field actually defines one.
    if (input.default_value) {
      await tx.query(`INSERT INTO inv.custom_field_values(definition_id,customer_id,value,updated_by)
        SELECT $1, id, $2, $3 FROM inv.pos_customers WHERE status='ACTIVE'`,
      [id, input.default_value, actor.id]);
    }
    await audit(tx, 'CUSTOM_FIELD_CREATED', { actorId: actor.id, entityType: 'CUSTOM_FIELD', entityId: id,
      metadata: { label: input.label, field_type: input.field_type } });
  });
  return (await db.query('SELECT * FROM inv.custom_field_definitions WHERE id=$1', [id])).rows[0];
}

export async function updateCustomField(db, actor, id, input) {
  return db.transaction(async tx => {
    const existing = (await tx.query('SELECT * FROM inv.custom_field_definitions WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(existing, 404, 'That column does not exist.', 'NOT_FOUND');
    if (existing.field_type !== input.field_type) {
      // Changing the type would reinterpret stored values, so it is refused
      // rather than silently corrupting them.
      const filled = (await tx.query("SELECT count(*)::int AS n FROM inv.custom_field_values WHERE definition_id=$1 AND value <> ''",
        [id])).rows[0].n;
      assert(filled === 0, 409, 'Archive this column and add a new one instead: it already holds values.',
        'FIELD_HAS_VALUES');
    }
    const clash = (await tx.query(`SELECT id FROM inv.custom_field_definitions
      WHERE entity='POS_CUSTOMER' AND lower(label)=lower($1) AND id<>$2`, [input.label, id])).rows[0];
    assert(!clash, 409, 'A column with this name already exists.', 'DUPLICATE_FIELD');
    await tx.query(`UPDATE inv.custom_field_definitions SET label=$2, field_type=$3, description=$4, required=$5,
        options=$6, position=$7, visible=$8, width=$9, editor_roles=$10, updated_at=now() WHERE id=$1`,
    [id, input.label, input.field_type, input.description, input.required, JSON.stringify(input.options),
      input.position, input.visible, input.width, input.editor_roles]);
    await audit(tx, 'CUSTOM_FIELD_UPDATED', { actorId: actor.id, entityType: 'CUSTOM_FIELD', entityId: id,
      metadata: { label: input.label, renamed: existing.label !== input.label } });
    return (await tx.query('SELECT * FROM inv.custom_field_definitions WHERE id=$1', [id])).rows[0];
  });
}

/** Archiving keeps every stored value; a column is never dropped in place. */
export async function setCustomFieldStatus(db, actor, id, status) {
  return db.transaction(async tx => {
    const existing = (await tx.query('SELECT * FROM inv.custom_field_definitions WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(existing, 404, 'That column does not exist.', 'NOT_FOUND');
    await tx.query(`UPDATE inv.custom_field_definitions SET status=$2,
        archived_at=CASE WHEN $2='ARCHIVED' THEN now() ELSE NULL END, updated_at=now() WHERE id=$1`, [id, status]);
    await audit(tx, status === 'ARCHIVED' ? 'CUSTOM_FIELD_ARCHIVED' : 'CUSTOM_FIELD_RESTORED',
      { actorId: actor.id, entityType: 'CUSTOM_FIELD', entityId: id, metadata: { label: existing.label } });
    return (await tx.query('SELECT * FROM inv.custom_field_definitions WHERE id=$1', [id])).rows[0];
  });
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const URL_PATTERN = /^https?:\/\/[^\s]+$/i;

/**
 * Validation lives on the server because the browser is not the authority on
 * what a column may contain. Unsupported input is rejected per field so the
 * grid can highlight the offending cell.
 */
export function normalizeFieldValue(definition, raw) {
  const value = String(raw ?? '').trim();
  const fail = message => assert(false, 422, `${definition.label}: ${message}`, 'INVALID_FIELD_VALUE');
  if (value === '') {
    assert(!definition.required, 422, `${definition.label} is required.`, 'INVALID_FIELD_VALUE');
    return '';
  }
  switch (definition.field_type) {
    case 'TEXT': case 'LONG_TEXT': case 'PHONE':
      if (definition.field_type === 'PHONE') assert(/^[+0-9][0-9\s-()]{5,23}$/.test(value), 422,
        `${definition.label}: enter a valid phone number`, 'INVALID_FIELD_VALUE');
      return value.slice(0, definition.field_type === 'TEXT' ? 300 : 4000);
    case 'NUMBER': case 'CURRENCY': {
      const number = Number(value.replace(/,/g, ''));
      if (!Number.isFinite(number)) fail('enter a number');
      if (definition.field_type === 'CURRENCY') {
        assert(number >= 0, 422, `${definition.label}: currency cannot be negative`, 'INVALID_FIELD_VALUE');
        assert(Math.abs(number * 100 - Math.round(number * 100)) < 1e-6, 422,
          `${definition.label}: use at most two decimal places`, 'INVALID_FIELD_VALUE');
      }
      return String(number);
    }
    case 'DATE': {
      if (!DATE_PATTERN.test(value)) fail('use the date picker (YYYY-MM-DD)');
      const date = new Date(`${value}T00:00:00Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail('enter a real date');
      return value;
    }
    case 'CHECKBOX': {
      const truthy = ['true', '1', 'yes', 'y', 'on'];
      const falsy = ['false', '0', 'no', 'n', 'off'];
      const normalized = value.toLowerCase();
      if (truthy.includes(normalized)) return 'true';
      if (falsy.includes(normalized)) return 'false';
      fail('use yes or no');
      break;
    }
    case 'DROPDOWN':
      assert(definition.options.includes(value), 422,
        `${definition.label}: choose one of ${definition.options.join(', ')}`, 'INVALID_FIELD_VALUE');
      return value;
    case 'MULTI_SELECT': {
      const chosen = value.split(',').map(item => item.trim()).filter(Boolean);
      const unknown = chosen.filter(item => !definition.options.includes(item));
      assert(unknown.length === 0, 422, `${definition.label}: unknown option ${unknown.join(', ')}`, 'INVALID_FIELD_VALUE');
      return [...new Set(chosen)].join(', ');
    }
    case 'URL':
      if (!URL_PATTERN.test(value)) fail('use a full http or https link');
      return value.slice(0, 500);
    case 'EMAIL':
      if (!EMAIL_PATTERN.test(value)) fail('enter a valid email address');
      return value.toLowerCase().slice(0, 254);
    default:
      return fail('unsupported field type');
  }
}

export async function saveCustomValues(db, actor, customerId, input) {
  return db.transaction(async tx => {
    const customer = (await tx.query('SELECT * FROM inv.pos_customers WHERE id=$1', [customerId])).rows[0];
    assert(customer, 404, 'That customer does not exist.', 'NOT_FOUND');
    const saved = [];
    for (const entry of input.values) {
      const definition = (await tx.query(`SELECT * FROM inv.custom_field_definitions WHERE id=$1 AND entity='POS_CUSTOMER'`,
        [entry.definition_id])).rows[0];
      assert(definition, 404, 'That column does not exist.', 'NOT_FOUND');
      assert(definition.status === 'ACTIVE', 409, `${definition.label} is archived and cannot be edited.`, 'FIELD_ARCHIVED');
      // Column-level permissions are checked here, not in the browser.
      assert(definition.editor_roles.includes(actor.role), 403,
        `${definition.label} can only be edited by ${definition.editor_roles.join(', ')}.`, 'FORBIDDEN');
      const value = normalizeFieldValue({ ...definition, options: definition.options || [] }, entry.value);
      if (value === '') {
        await tx.query('DELETE FROM inv.custom_field_values WHERE definition_id=$1 AND customer_id=$2',
          [definition.id, customerId]);
      } else {
        await tx.query(`INSERT INTO inv.custom_field_values(definition_id,customer_id,value,updated_by)
          VALUES($1,$2,$3,$4) ON CONFLICT (definition_id,customer_id)
          DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by`,
        [definition.id, customerId, value, actor.id]);
      }
      saved.push({ definition_id: definition.id, value });
    }
    await tx.query('UPDATE inv.pos_customers SET updated_at=now() WHERE id=$1', [customerId]);
    await audit(tx, 'CUSTOMER_FIELDS_SAVED', { actorId: actor.id, entityType: 'POS_CUSTOMER', entityId: customerId,
      metadata: { fields: saved.length } });
    return saved;
  });
}

/* --------------------------------------------------------------- employees */

export async function listEmployees(db, { includeInactive = false } = {}) {
  const { rows } = await db.query(`SELECT e.*, (SELECT count(*) FROM inv.pos_customers c WHERE c.employee_id=e.id
      AND c.status='ACTIVE')::int AS customer_count
    FROM inv.pos_employees e WHERE ($1 OR e.status='ACTIVE') ORDER BY lower(e.name)`, [includeInactive]);
  return rows;
}

export async function createEmployee(db, actor, input) {
  const id = randomUUID();
  await db.transaction(async tx => {
    if (input.user_id) {
      const user = (await tx.query('SELECT id FROM inv.users WHERE id=$1', [input.user_id])).rows[0];
      assert(user, 404, 'That application user does not exist.', 'NOT_FOUND');
    }
    await tx.query('INSERT INTO inv.pos_employees(id,name,email,user_id,status,created_by) VALUES($1,$2,$3,$4,$5,$6)',
      [id, input.name, input.email, input.user_id, input.status, actor.id]);
    await audit(tx, 'EMPLOYEE_CREATED', { actorId: actor.id, entityType: 'EMPLOYEE', entityId: id,
      metadata: { name: input.name } });
  });
  return (await db.query('SELECT * FROM inv.pos_employees WHERE id=$1', [id])).rows[0];
}

export async function setEmployeeStatus(db, actor, id, status) {
  return db.transaction(async tx => {
    const existing = (await tx.query('SELECT * FROM inv.pos_employees WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(existing, 404, 'That employee does not exist.', 'NOT_FOUND');
    await tx.query('UPDATE inv.pos_employees SET status=$2 WHERE id=$1', [id, status]);
    await audit(tx, status === 'INACTIVE' ? 'EMPLOYEE_DEACTIVATED' : 'EMPLOYEE_REACTIVATED',
      { actorId: actor.id, entityType: 'EMPLOYEE', entityId: id, metadata: { name: existing.name } });
    return (await tx.query('SELECT * FROM inv.pos_employees WHERE id=$1', [id])).rows[0];
  });
}

/* ------------------------------------------------------------------- plans */

export async function listPlans(db, { includeArchived = false } = {}) {
  const { rows } = await db.query(`SELECT p.*, (SELECT count(*) FROM inv.pos_subscriptions s WHERE s.plan_id=p.id)::int AS subscription_count
    FROM inv.pos_subscription_plans p WHERE ($1 OR p.status='ACTIVE') ORDER BY p.position, p.duration_months`, [includeArchived]);
  return rows;
}

export async function createPlan(db, actor, input) {
  const id = randomUUID();
  await db.transaction(async tx => {
    const clash = (await tx.query('SELECT id FROM inv.pos_subscription_plans WHERE lower(label)=lower($1)', [input.label])).rows[0];
    assert(!clash, 409, 'A plan with this name already exists.', 'DUPLICATE_PLAN');
    await tx.query(`INSERT INTO inv.pos_subscription_plans(id,label,duration_months,is_lifetime,status,notes,position,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, input.label, input.duration_months, input.is_lifetime, input.status, input.notes, input.position, actor.id]);
    await audit(tx, 'PLAN_CREATED', { actorId: actor.id, entityType: 'PLAN', entityId: id, metadata: { label: input.label } });
  });
  return (await db.query('SELECT * FROM inv.pos_subscription_plans WHERE id=$1', [id])).rows[0];
}

export async function updatePlan(db, actor, id, input) {
  return db.transaction(async tx => {
    const existing = (await tx.query('SELECT * FROM inv.pos_subscription_plans WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(existing, 404, 'That plan does not exist.', 'NOT_FOUND');
    const clash = (await tx.query('SELECT id FROM inv.pos_subscription_plans WHERE lower(label)=lower($1) AND id<>$2',
      [input.label, id])).rows[0];
    assert(!clash, 409, 'A plan with this name already exists.', 'DUPLICATE_PLAN');
    await tx.query(`UPDATE inv.pos_subscription_plans SET label=$2, duration_months=$3, is_lifetime=$4,
        status=$5, notes=$6, position=$7 WHERE id=$1`,
    [id, input.label, input.duration_months, input.is_lifetime, input.status, input.notes, input.position]);
    await audit(tx, 'PLAN_UPDATED', { actorId: actor.id, entityType: 'PLAN', entityId: id,
      metadata: { label: input.label, label_changed: existing.label !== input.label } });
    return (await tx.query('SELECT * FROM inv.pos_subscription_plans WHERE id=$1', [id])).rows[0];
  });
}

/* -------------------------------------------------------------- subscription */

/**
 * Renewals are appended, never overwritten: renewing records a new subscription
 * that points at the one it replaces.
 */
async function insertSubscription(tx, actor, customerId, input, { renewedFrom = null } = {}) {
  const product = input.product_id
    ? (await tx.query('SELECT id, name FROM inv.products WHERE id=$1', [input.product_id])).rows[0] : null;
  assert(!input.product_id || product, 404, 'That product does not exist.', 'NOT_FOUND');
  const plan = input.plan_id
    ? (await tx.query('SELECT * FROM inv.pos_subscription_plans WHERE id=$1', [input.plan_id])).rows[0] : null;
  assert(!input.plan_id || plan, 404, 'That subscription plan does not exist.', 'NOT_FOUND');
  assert(input.plan_id || input.plan_label, 400, 'Choose a subscription plan or name one.', 'VALIDATION_ERROR');
  const isLifetime = input.is_lifetime || Boolean(plan?.is_lifetime);
  // A dated plan with no expiry would silently never expire, so one is derived
  // from the plan duration when the operator leaves it blank.
  let expiry = input.expiry_date;
  if (!isLifetime && !expiry) {
    if (plan && plan.duration_months > 0) {
      const start = input.start_date || input.purchase_date;
      const date = new Date(`${start}T00:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + plan.duration_months);
      expiry = date.toISOString().slice(0, 10);
    } else {
      assert(false, 400, 'Provide an expiry date or choose a lifetime plan.', 'VALIDATION_ERROR');
    }
  }
  assert(isLifetime || expiry, 400, 'Provide an expiry date, or mark the plan as lifetime.', 'VALIDATION_ERROR');
  const id = randomUUID();
  await tx.query(`INSERT INTO inv.pos_subscriptions(id,customer_id,product_id,plan_id,plan_label,purchase_date,start_date,
      expiry_date,is_lifetime,status,amount_minor,transaction_reference,notes,renewed_from,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
  [id, customerId, input.product_id, input.plan_id, plan?.label || input.plan_label || '', input.purchase_date,
    input.start_date || input.purchase_date, isLifetime ? null : expiry, isLifetime, input.status,
    input.amount_minor, input.transaction_reference, input.notes, renewedFrom, actor.id]);
  return id;
}

export async function addSubscription(db, actor, customerId, input) {
  return db.transaction(async tx => {
    const customer = (await tx.query('SELECT * FROM inv.pos_customers WHERE id=$1 FOR UPDATE', [customerId])).rows[0];
    assert(customer, 404, 'That customer does not exist.', 'NOT_FOUND');
    assert(customer.status === 'ACTIVE', 409, 'Restore this customer before adding a subscription.', 'CUSTOMER_ARCHIVED');
    const previous = input.renews
      ? (await tx.query('SELECT id FROM inv.pos_subscriptions WHERE customer_id=$1 ORDER BY purchase_date DESC, created_at DESC LIMIT 1',
        [customerId])).rows[0]?.id || null
      : null;
    if (previous) await tx.query("UPDATE inv.pos_subscriptions SET status='CANCELLED', updated_at=now() WHERE id=$1", [previous]);
    const id = await insertSubscription(tx, actor, customerId, input, { renewedFrom: previous });
    await tx.query('UPDATE inv.pos_customers SET updated_at=now() WHERE id=$1', [customerId]);
    await audit(tx, previous ? 'SUBSCRIPTION_RENEWED' : 'SUBSCRIPTION_ADDED',
      { actorId: actor.id, entityType: 'POS_SUBSCRIPTION', entityId: id,
        metadata: { customer_id: customerId, product_id: input.product_id, plan_label: input.plan_label || null } });
    return tx.query('SELECT * FROM inv.pos_subscriptions WHERE id=$1', [id]).then(result => result.rows[0]);
  });
}

export async function updateSubscription(db, actor, id, input) {
  return db.transaction(async tx => {
    const existing = (await tx.query('SELECT * FROM inv.pos_subscriptions WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(existing, 404, 'That subscription does not exist.', 'NOT_FOUND');
    const isLifetime = input.is_lifetime;
    assert(isLifetime || input.expiry_date, 400, 'Provide an expiry date, or mark the plan as lifetime.', 'VALIDATION_ERROR');
    await tx.query(`UPDATE inv.pos_subscriptions SET product_id=$2, plan_id=$3, plan_label=$4, purchase_date=$5,
        start_date=$6, expiry_date=$7, is_lifetime=$8, status=$9, amount_minor=$10, transaction_reference=$11,
        notes=$12, updated_at=now() WHERE id=$1`,
    [id, input.product_id, input.plan_id, input.plan_label || existing.plan_label, input.purchase_date,
      input.start_date || input.purchase_date, isLifetime ? null : input.expiry_date, isLifetime, input.status,
      input.amount_minor, input.transaction_reference, input.notes]);
    await audit(tx, 'SUBSCRIPTION_UPDATED', { actorId: actor.id, entityType: 'POS_SUBSCRIPTION', entityId: id,
      metadata: { customer_id: existing.customer_id } });
    return (await tx.query('SELECT * FROM inv.pos_subscriptions WHERE id=$1', [id])).rows[0];
  });
}

/* ----------------------------------------------------------------- customers */

/** Advisory only: a duplicate warning never blocks a legitimate customer. */
export async function customerWarnings(db, { name, business_name = '', phone = '', email = '', exclude_id = null }) {
  const { rows } = await db.query(`
    SELECT id, name, business_name, phone,
      (CASE WHEN length($3) > 0 AND phone = $3 THEN 3 ELSE 0 END
        + CASE WHEN length($1) > 0 AND lower(name) = lower($1) THEN 2 ELSE 0 END
        + CASE WHEN length($2) > 0 AND lower(business_name) = lower($2) THEN 1 ELSE 0 END
        + CASE WHEN length($4) > 0 AND lower(email) = lower($4) THEN 1 ELSE 0 END) AS relevance
    FROM inv.pos_customers
    WHERE id <> COALESCE($5::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
      AND ((length($1) > 0 AND lower(name) = lower($1))
        OR (length($2) > 0 AND lower(business_name) = lower($2))
        OR (length($3) > 0 AND phone = $3)
        OR (length($4) > 0 AND lower(email) = lower($4)))
    ORDER BY relevance DESC, created_at ASC LIMIT 5`,
  [name || '', business_name, phone, email, exclude_id]);
  const warnings = rows.length ? [`A similar customer already exists: ${rows.map(row => row.name).join(', ')}.`] : [];
  return { duplicates: rows, warnings };
}

/** The subscription the spreadsheet shows: the most recent purchase, preferring one still running. */
const CURRENT_SUBSCRIPTION = `LEFT JOIN inv.pos_subscriptions sub ON sub.id = (
    SELECT s.id FROM inv.pos_subscriptions s WHERE s.customer_id = c.id
    ORDER BY (s.status = 'ACTIVE') DESC, s.purchase_date DESC, s.created_at DESC LIMIT 1)`;

function customerFilters(url) {
  const value = key => (url.searchParams.get(key) || '').trim();
  return {
    term: `%${escapeLike(searchTerm(url))}%`,
    product: value('product_id'), plan: value('plan_id'), employee: value('employee_id'),
    subscription: SUBSCRIPTION_FILTERS.includes(value('subscription')) ? value('subscription') : '',
    // The grid opens on active customers; "ALL" is the explicit opt-in to see
    // archived rows as well.
    status: value('status') === 'ALL' ? ''
      : (['ACTIVE', 'ARCHIVED'].includes(value('status')) ? value('status') : 'ACTIVE'),
    from: value('purchase_from') || null, to: value('purchase_to') || null,
    expiryFrom: value('expiry_from') || null, expiryTo: value('expiry_to') || null,
  };
}

/**
 * One query per page of rows plus one for custom values: the grid never issues
 * a query per customer.
 */
export async function listCustomers(db, url, { customerIds = null } = {}) {
  const { page, limit, offset } = pagination(url);
  const filters = customerFilters(url);
  const requestedSort = url.searchParams.get('sort') || 'serial';
  const sortKey = SORTS[requestedSort] ? requestedSort : 'serial';
  // The unfiltered grid reads newest first; every named sort reads A-Z ascending.
  const requestedDirection = (url.searchParams.get('direction') || (sortKey === 'serial' ? 'desc' : 'asc')).toLowerCase();
  const direction = requestedDirection === 'desc' ? 'DESC' : 'ASC';
  const scoped = Array.isArray(customerIds);
  const conditions = [
    `($1 = '' OR c.status = $1)`,
    `($2 = '' OR sub.product_id = $2::uuid)`,
    `($3 = '' OR sub.plan_id = $3::uuid)`,
    `($4 = '' OR c.employee_id = $4::uuid)`,
    `($5::date IS NULL OR sub.purchase_date >= $5::date)`,
    `($6::date IS NULL OR sub.purchase_date <= $6::date)`,
    `($7::date IS NULL OR sub.expiry_date >= $7::date)`,
    `($8::date IS NULL OR sub.expiry_date <= $8::date)`,
    `($9 = '' OR c.name ILIKE $11 ESCAPE '!' OR c.business_name ILIKE $11 ESCAPE '!' OR c.address ILIKE $11 ESCAPE '!'
      OR c.remarks ILIKE $11 ESCAPE '!' OR e.name ILIKE $11 ESCAPE '!' OR p.name ILIKE $11 ESCAPE '!'
      OR sub.plan_label ILIKE $11 ESCAPE '!'
      OR EXISTS (SELECT 1 FROM inv.custom_field_values v JOIN inv.custom_field_definitions d ON d.id = v.definition_id
        WHERE v.customer_id = c.id AND v.value ILIKE $11 ESCAPE '!'))`,
    // An empty scope array means "no restriction", so one statement serves the
    // grid, an export and a share without rebuilding conditional SQL.
    `(cardinality($12::uuid[]) = 0 OR c.id = ANY($12::uuid[]))`,
    `($10 = '' OR ($10 = 'LIFETIME' AND sub.is_lifetime)
      OR ($10 = 'ACTIVE' AND NOT sub.is_lifetime AND sub.expiry_date >= current_date)
      OR ($10 IN ('EXPIRED') AND NOT sub.is_lifetime AND sub.expiry_date < current_date)
      OR ($10 IN ('EXPIRING_SOON','EXPIRING_7','EXPIRING_15','EXPIRING_30') AND NOT sub.is_lifetime
        AND sub.expiry_date >= current_date
        AND sub.expiry_date <= current_date + (CASE $10 WHEN 'EXPIRING_7' THEN 7 WHEN 'EXPIRING_15' THEN 15
          WHEN 'EXPIRING_30' THEN 30 ELSE 30 END)))`,
  ];
  // Parameters are ordered so the count query binds the same prefix: the scope
  // array is $12 and pagination follows it.
  const values = [filters.status, filters.product, filters.plan, filters.employee, filters.from, filters.to,
    filters.expiryFrom, filters.expiryTo, searchTerm(url), filters.subscription, filters.term,
    scoped ? customerIds : [], limit, offset];
  const where = `WHERE ${conditions.join(' AND ')}`;
  const base = `FROM inv.pos_customers c
    ${CURRENT_SUBSCRIPTION}
    LEFT JOIN inv.pos_employees e ON e.id = c.employee_id
    LEFT JOIN inv.products p ON p.id = sub.product_id`;
  const rows = (await db.query(`
    SELECT c.id, c.name, c.business_name, c.address, c.employee_id, c.email, c.phone, c.remarks, c.client_id,
      c.status, c.archived_at, c.created_at, c.updated_at,
      e.name AS employee_name,
      sub.id AS subscription_id, sub.product_id, sub.plan_id, sub.plan_label, sub.purchase_date, sub.start_date,
      sub.expiry_date, sub.is_lifetime, sub.status AS subscription_status, sub.amount_minor,
      sub.transaction_reference, sub.notes AS subscription_notes,
      p.name AS product_name, p.category AS product_category, p.unit AS product_unit,
      (sub.expiry_date IS NOT NULL AND NOT sub.is_lifetime AND sub.expiry_date < current_date) AS expired,
      (sub.expiry_date IS NOT NULL AND NOT sub.is_lifetime AND sub.expiry_date >= current_date
        AND sub.expiry_date <= current_date + 30) AS expiring_soon,
      (SELECT count(*) FROM inv.pos_subscriptions s2 WHERE s2.customer_id = c.id)::int AS subscription_count
    ${base} ${where}
    ORDER BY ${SORTS[sortKey]} ${direction} NULLS LAST, c.id
    LIMIT $13 OFFSET $14`, values)).rows;
  const total = (await db.query(`SELECT count(*)::int AS total ${base} ${where}`,
    values.slice(0, 12))).rows[0].total;
  const ids = rows.map(row => row.id);
  const customValues = {};
  if (ids.length) {
    const stored = (await db.query(`SELECT customer_id, definition_id, value FROM inv.custom_field_values
      WHERE customer_id = ANY($1::uuid[])`, [ids])).rows;
    for (const row of stored) {
      customValues[row.customer_id] = customValues[row.customer_id] || {};
      customValues[row.customer_id][`custom:${row.definition_id}`] = row.value;
    }
  }
  const decorated = rows.map((row, index) => {
    const normalized = {
      ...row,
      expired: Boolean(row.expired),
      expiring_soon: Boolean(row.expiring_soon),
    };
    return {
      ...normalized,
      // S.No. is a display sequence over the current filter and sort: it is not an identity.
      serial: offset + index + 1,
      custom: customValues[row.id] || {},
      warnings: subscriptionWarnings(normalized),
    };
  });
  return { customers: decorated, total, page, limit };
}

/** Expiry that precedes the purchase is a warning, not a blocked row. */
function subscriptionWarnings(row) {
  const warnings = [];
  if (!row.subscription_id) warnings.push('No subscription recorded yet.');
  if (row.expired) warnings.push(`Expired on ${row.expiry_date}.`);
  else if (row.expiring_soon) warnings.push(`Expires on ${row.expiry_date}.`);
  if (row.subscription_id && row.expiry_date && row.purchase_date && row.expiry_date < row.purchase_date) {
    warnings.push('The expiry date is before the purchase date - please confirm.');
  }
  return warnings;
}

export async function getCustomer(db, id) {
  const customer = (await db.query(`SELECT c.*, e.name AS employee_name, cl.name AS client_name
    FROM inv.pos_customers c LEFT JOIN inv.pos_employees e ON e.id=c.employee_id
    LEFT JOIN inv.clients cl ON cl.id=c.client_id WHERE c.id=$1`, [id])).rows[0];
  assert(customer, 404, 'That customer does not exist.', 'NOT_FOUND');
  const subscriptions = (await db.query(`SELECT s.*, p.name AS product_name, pl.label AS plan_name
    FROM inv.pos_subscriptions s LEFT JOIN inv.products p ON p.id=s.product_id
    LEFT JOIN inv.pos_subscription_plans pl ON pl.id=s.plan_id
    WHERE s.customer_id=$1 ORDER BY s.purchase_date DESC, s.created_at DESC`, [id])).rows;
  const custom = (await db.query(`SELECT v.definition_id, v.value, d.label, d.field_type
    FROM inv.custom_field_values v JOIN inv.custom_field_definitions d ON d.id=v.definition_id
    WHERE v.customer_id=$1`, [id])).rows;
  const today = await currentDate(db);
  return { customer, subscriptions, custom,
    days_to_expiry: subscriptions[0]?.expiry_date
      ? Math.round((new Date(`${subscriptions[0].expiry_date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000)
      : null };
}

/** Takes a transaction so an import can create many customers atomically. */
export async function insertCustomer(tx, actor, input) {
  const id = randomUUID();
  if (input.employee_id) {
    const employee = (await tx.query('SELECT id FROM inv.pos_employees WHERE id=$1', [input.employee_id])).rows[0];
    assert(employee, 404, 'That employee does not exist.', 'NOT_FOUND');
  }
  if (input.client_id) {
    const client = (await tx.query('SELECT id FROM inv.clients WHERE id=$1', [input.client_id])).rows[0];
    assert(client, 404, 'That billing client does not exist.', 'NOT_FOUND');
  }
  await tx.query(`INSERT INTO inv.pos_customers(id,name,business_name,address,employee_id,email,phone,remarks,client_id,
      status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
  [id, input.name, input.business_name, input.address, input.employee_id, input.email, input.phone,
    input.remarks, input.client_id || null, input.status || 'ACTIVE', actor.id]);
  if (input.subscription) await insertSubscription(tx, actor, id, input.subscription);
  await audit(tx, 'CUSTOMER_CREATED', { actorId: actor.id, entityType: 'POS_CUSTOMER', entityId: id,
    metadata: { name: input.name, business_name: input.business_name } });
  return id;
}

export async function createCustomer(db, actor, input) {
  const id = await db.transaction(tx => insertCustomer(tx, actor, input));
  return getCustomer(db, id);
}

/**
 * `expected_updated_at` gives the grid optimistic concurrency: a row that moved
 * under the editor is refused instead of silently overwriting someone else.
 */
export async function updateCustomer(db, actor, id, input) {
  await db.transaction(async tx => {
    const existing = (await tx.query('SELECT * FROM inv.pos_customers WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(existing, 404, 'That customer does not exist.', 'NOT_FOUND');
    if (input.expected_updated_at) {
      assert(new Date(existing.updated_at).toISOString() === new Date(input.expected_updated_at).toISOString(), 409,
        'This customer changed in another session. Reload the row and apply your edits again.', 'STALE_ROW');
    }
    if (input.employee_id) {
      const employee = (await tx.query('SELECT id FROM inv.pos_employees WHERE id=$1', [input.employee_id])).rows[0];
      assert(employee, 404, 'That employee does not exist.', 'NOT_FOUND');
    }
    const nextUpdated = new Date(Math.max(Date.now(), new Date(existing.updated_at).getTime() + 1));
    await tx.query(`UPDATE inv.pos_customers SET name=$2, business_name=$3, address=$4, employee_id=$5, email=$6,
        phone=$7, remarks=$8, client_id=$9, updated_at=$10 WHERE id=$1`,
    [id, input.name, input.business_name, input.address, input.employee_id, input.email, input.phone,
      input.remarks, input.client_id, nextUpdated]);
    if (input.subscription) {
      const current = (await tx.query(`SELECT id FROM inv.pos_subscriptions WHERE customer_id=$1
        ORDER BY (status='ACTIVE') DESC, purchase_date DESC, created_at DESC LIMIT 1`, [id])).rows[0];
      if (current) {
        await tx.query(`UPDATE inv.pos_subscriptions SET product_id=$2, plan_id=$3, plan_label=$4, purchase_date=$5,
            start_date=$6, expiry_date=$7, is_lifetime=$8, status=$9, transaction_reference=$10, updated_at=now()
          WHERE id=$1`,
        [current.id, input.subscription.product_id, input.subscription.plan_id,
          input.subscription.plan_label || '', input.subscription.purchase_date,
          input.subscription.start_date || input.subscription.purchase_date,
          input.subscription.is_lifetime ? null : input.subscription.expiry_date, input.subscription.is_lifetime,
          input.subscription.status, input.subscription.transaction_reference]);
      } else {
        await insertSubscription(tx, actor, id, input.subscription);
      }
    }
    await audit(tx, 'CUSTOMER_UPDATED', { actorId: actor.id, entityType: 'POS_CUSTOMER', entityId: id,
      metadata: { name: input.name, subscription_touched: Boolean(input.subscription) } });
  });
  return getCustomer(db, id);
}

export async function setCustomerStatus(db, actor, id, status) {
  await db.transaction(async tx => {
    const existing = (await tx.query('SELECT * FROM inv.pos_customers WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(existing, 404, 'That customer does not exist.', 'NOT_FOUND');
    await tx.query(`UPDATE inv.pos_customers SET status=$2,
        archived_at=CASE WHEN $2='ARCHIVED' THEN now() ELSE NULL END, updated_at=now() WHERE id=$1`, [id, status]);
    await audit(tx, status === 'ARCHIVED' ? 'CUSTOMER_ARCHIVED' : 'CUSTOMER_RESTORED',
      { actorId: actor.id, entityType: 'POS_CUSTOMER', entityId: id, metadata: { name: existing.name } });
  });
  return getCustomer(db, id);
}

/* ------------------------------------------------------------------ metrics */

/**
 * Every figure is counted from stored rows; nothing is hardcoded. Desktop,
 * mobile and both are derived from the products each customer actually holds.
 */
export async function trackerMetrics(db) {
  const today = await currentDate(db);
  const totals = (await db.query(`
    SELECT count(*)::int AS total_customers,
      count(*) FILTER (WHERE status='ARCHIVED')::int AS archived_customers,
      count(*) FILTER (WHERE status='ACTIVE')::int AS active_customers
    FROM inv.pos_customers`)).rows[0];
  const byProduct = (await db.query(`
    SELECT
      count(DISTINCT s.customer_id) FILTER (WHERE p.name ILIKE '%desktop%' AND p.name NOT ILIKE '%mobile%')::int AS desktop,
      count(DISTINCT s.customer_id) FILTER (WHERE p.name ILIKE '%mobile%' AND p.name NOT ILIKE '%desktop%')::int AS mobile,
      count(DISTINCT s.customer_id) FILTER (WHERE p.name ILIKE '%desktop%' AND p.name ILIKE '%mobile%')::int AS both
    FROM inv.pos_subscriptions s JOIN inv.products p ON p.id=s.product_id`)).rows[0];
  const subscription = (await db.query(`
    SELECT
      count(*) FILTER (WHERE NOT is_lifetime AND expiry_date >= current_date)::int AS active,
      count(*) FILTER (WHERE NOT is_lifetime AND expiry_date < current_date)::int AS expired,
      count(*) FILTER (WHERE is_lifetime)::int AS lifetime,
      count(*) FILTER (WHERE NOT is_lifetime AND expiry_date >= current_date AND expiry_date <= current_date + 7)::int AS expiring_7,
      count(*) FILTER (WHERE NOT is_lifetime AND expiry_date >= current_date AND expiry_date <= current_date + 15)::int AS expiring_15,
      count(*) FILTER (WHERE NOT is_lifetime AND expiry_date >= current_date AND expiry_date <= current_date + 30)::int AS expiring_30,
      count(*) FILTER (WHERE status='CANCELLED')::int AS cancelled
    FROM inv.pos_subscriptions`)).rows[0];
  const byEmployee = (await db.query(`
    SELECT e.id, e.name, count(c.id)::int AS customers,
      count(c.id) FILTER (WHERE EXISTS (
        SELECT 1 FROM inv.pos_subscriptions s WHERE s.customer_id=c.id AND NOT s.is_lifetime
          AND s.expiry_date < current_date))::int AS expired
    FROM inv.pos_employees e LEFT JOIN inv.pos_customers c ON c.employee_id=e.id AND c.status='ACTIVE'
    WHERE e.status='ACTIVE' GROUP BY e.id, e.name ORDER BY customers DESC, lower(e.name)`)).rows;
  const bySubscription = (await db.query(`
    SELECT COALESCE(NULLIF(plan_label,''), 'Not set') AS label, count(*)::int AS customers
    FROM inv.pos_subscriptions s WHERE s.status <> 'CANCELLED'
      AND s.id = (SELECT s2.id FROM inv.pos_subscriptions s2 WHERE s2.customer_id=s.customer_id
        ORDER BY (s2.status='ACTIVE') DESC, s2.purchase_date DESC LIMIT 1)
    GROUP BY 1 ORDER BY customers DESC`, [])).rows;
  return {
    today,
    totals: { ...totals, ...byProduct },
    subscriptions: subscription,
    by_employee: byEmployee,
    by_subscription: bySubscription,
    renewals_due: subscription.expired + subscription.expiring_30,
  };
}

/** Rows for export and shares reuse the same query the grid uses. */
export async function trackerRowsForExport(db, url, { customerIds = null } = {}) {
  const first = await listCustomers(db, new URL(`http://export/?limit=100&${url.searchParams.toString()}`), { customerIds });
  const rows = [...first.customers];
  const pages = Math.ceil(first.total / 100);
  for (let page = 2; page <= Math.min(pages, 100); page += 1) {
    const next = await listCustomers(db, new URL(`http://export/?limit=100&page=${page}&${url.searchParams.toString()}`),
      { customerIds });
    rows.push(...next.customers);
  }
  return { rows, total: first.total };
}

export { canWrite };
