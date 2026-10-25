import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { assert, HttpError } from './domain.js';
import { audit } from './audit.js';
import { hash, token, rateLimit } from './auth.js';
import { listCustomers, columnCatalog, resolveColumns, trackerRowsForExport } from './tracker.js';
import { cellValue } from './excel.js';

/**
 * Sharing for the customer tracker.
 *
 *  - A private share is granted to identified accounts and is read-only. The
 *    server decides what is readable; hiding buttons is never the control.
 *  - A public share is a bearer link. It is disabled until the owner creates one
 *    explicitly, it exposes only the columns chosen for it, and it re-keys every
 *    column to an opaque slug so no internal identifier leaves the server.
 *
 * Customer records carry commercial and personal data, so a public link is
 * treated as public and the interface says so.
 */

/** Columns that stay out of a public link unless the owner selects them. */
export const SENSITIVE_COLUMNS = ['remarks'];

const publicSlug = index => `col_${index + 1}`;

export function publicShape(columns, rows) {
  const shaped = rows.map(row => {
    const record = {};
    columns.forEach((column, index) => { record[publicSlug(index)] = cellValue(row, column); });
    return record;
  });
  return {
    columns: columns.map((column, index) => ({ key: publicSlug(index), label: column.label, type: column.type })),
    rows: shaped,
  };
}

async function shareScopeIds(db, share) {
  if (share.scope_all) return null;
  const { rows } = await db.query('SELECT customer_id FROM inv.pos_share_customers WHERE share_id=$1', [share.id]);
  return rows.map(row => row.customer_id);
}

function assertLive(share) {
  assert(share, 404, 'That share does not exist.', 'NOT_FOUND');
  assert(!share.revoked_at, 410, 'This share has been revoked.', 'SHARE_REVOKED');
  assert(!share.expires_at || new Date(share.expires_at) > new Date(), 410, 'This share has expired.', 'SHARE_EXPIRED');
}

const loadShare = async (db, id) => (await db.query('SELECT * FROM inv.pos_shares WHERE id=$1', [id])).rows[0];

/* ---------------------------------------------------------- create / manage */

export async function createPrivateShare(db, actor, input) {
  return db.transaction(async tx => {
    const catalog = await columnCatalog(tx);
    const columns = resolveColumns(catalog, input.columns).map(column => column.key);
    const recipients = [...new Set(input.recipients.map(email => email.toLowerCase()))];
    // Read-only access is granted to accounts that exist; there is no open
    // invitation flow, so an unknown address cannot be handed customer data.
    const accounts = (await tx.query('SELECT id,email,role,disabled FROM inv.users WHERE email = ANY($1::text[])',
      [recipients])).rows;
    const missing = recipients.filter(email => !accounts.some(account => account.email === email));
    assert(missing.length === 0, 422,
      `No application account exists for ${missing.join(', ')}. Create the account first, then share with it.`,
      'UNKNOWN_RECIPIENT');
    assert(accounts.every(account => !account.disabled), 409, 'A selected account is disabled.', 'RECIPIENT_DISABLED');
    const customerIds = await validateScope(tx, input);
    const id = randomUUID();
    await tx.query(`INSERT INTO inv.pos_shares(id,share_type,title,owner_id,scope_all,filter,columns,allow_search,
        allow_filter,allow_download,expires_at,created_by)
      VALUES($1,'PRIVATE',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, input.title, actor.id, input.scope_all, JSON.stringify({}), JSON.stringify(columns), input.allow_search,
      input.allow_filter, input.allow_download, input.expires_at, actor.id]);
    for (const email of recipients) {
      await tx.query('INSERT INTO inv.pos_share_recipients(share_id,user_id,email) VALUES($1,$2,$3)',
        [id, accounts.find(account => account.email === email).id, email]);
    }
    for (const customerId of customerIds) {
      await tx.query('INSERT INTO inv.pos_share_customers(share_id,customer_id) VALUES($1,$2)', [id, customerId]);
    }
    await audit(tx, 'TRACKER_SHARED_PRIVATE', { actorId: actor.id, entityType: 'SHARE', entityId: id,
      metadata: { title: input.title, recipients, scope_all: input.scope_all, records: customerIds.length,
        columns, allow_download: input.allow_download } });
    return describeShare(await loadShare(tx, id), recipients, customerIds);
  });
}

async function validateScope(tx, input) {
  if (input.scope_all) return [];
  const { rows } = await tx.query('SELECT id FROM inv.pos_customers WHERE id = ANY($1::uuid[])', [input.customer_ids]);
  assert(rows.length === input.customer_ids.length, 404,
    'One of the selected customers does not exist.', 'NOT_FOUND');
  return rows.map(row => row.id);
}

/**
 * The only place a share token exists in plain text is this return value; the
 * database keeps a SHA-256 of it, so a leaked table cannot be replayed.
 */
export async function createPublicShare(db, actor, input) {
  const raw = token();
  const created = await db.transaction(async tx => {
    const catalog = await columnCatalog(tx);
    const columns = resolveColumns(catalog, input.columns).map(column => column.key);
    const customerIds = await validateScope(tx, input);
    const id = randomUUID();
    const password = input.password || null;
    await tx.query(`INSERT INTO inv.pos_shares(id,share_type,title,owner_id,scope_all,filter,columns,allow_search,
        allow_filter,allow_download,password_hash,token_hash,expires_at,created_by)
      VALUES($1,'PUBLIC',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, input.title, actor.id, input.scope_all, JSON.stringify({}), JSON.stringify(columns), input.allow_search,
      input.allow_filter, input.allow_download, password ? createHash('sha256').update(password).digest('hex') : null,
      hash(raw), input.expires_at, actor.id]);
    for (const customerId of customerIds) {
      await tx.query('INSERT INTO inv.pos_share_customers(share_id,customer_id) VALUES($1,$2)', [id, customerId]);
    }
    await audit(tx, 'TRACKER_SHARED_PUBLIC', { actorId: actor.id, entityType: 'SHARE', entityId: id,
      metadata: { title: input.title, scope_all: input.scope_all, records: customerIds.length, columns,
        password_protected: Boolean(password), expires_at: input.expires_at } });
    return describeShare(await loadShare(tx, id), [], customerIds);
  });
  return { share: created, token: raw,
    warnings: publicWarnings(created.columns) };
}

export function publicWarnings(columns) {
  const sensitive = columns.filter(key => SENSITIVE_COLUMNS.includes(key) || key.startsWith('custom:'));
  return sensitive.length
    ? [`This link includes ${sensitive.join(', ')}. Anyone who receives the link can read those values - public links can be forwarded.`]
    : ['Anyone with this link can read the shared columns. Public links can be forwarded, so treat them as public.'];
}

function describeShare(share, recipients = null, customerIds = null) {
  return {
    id: share.id, share_type: share.share_type, title: share.title, scope_all: share.scope_all,
    columns: share.columns, allow_search: share.allow_search, allow_filter: share.allow_filter,
    allow_download: share.allow_download, expires_at: share.expires_at, revoked_at: share.revoked_at,
    created_at: share.created_at, last_accessed_at: share.last_accessed_at, access_count: share.access_count,
    password_protected: Boolean(share.password_hash),
    recipients: recipients ?? null, customer_count: customerIds?.length ?? null,
  };
}

export async function listShares(db) {
  const { rows } = await db.query(`SELECT s.*, (SELECT count(*) FROM inv.pos_share_recipients r WHERE r.share_id=s.id)::int AS recipient_count,
      (SELECT count(*) FROM inv.pos_share_customers c WHERE c.share_id=s.id)::int AS selected_customers,
      (SELECT COALESCE(json_agg(r.email ORDER BY r.email), '[]'::json) FROM inv.pos_share_recipients r WHERE r.share_id=s.id) AS recipients
    FROM inv.pos_shares s ORDER BY s.created_at DESC`);
  return {
    shares: rows.map(row => ({
      id: row.id, share_type: row.share_type, title: row.title, scope_all: row.scope_all, columns: row.columns,
      allow_search: row.allow_search, allow_filter: row.allow_filter, allow_download: row.allow_download,
      expires_at: row.expires_at, revoked_at: row.revoked_at, created_at: row.created_at,
      last_accessed_at: row.last_accessed_at, access_count: row.access_count,
      password_protected: Boolean(row.password_hash), recipients: row.recipients,
      customer_count: row.scope_all ? null : row.selected_customers, recipient_count: row.recipient_count,
    })),
    counts: {
      private: rows.filter(row => row.share_type === 'PRIVATE').length,
      public: rows.filter(row => row.share_type === 'PUBLIC').length,
      active: rows.filter(row => !row.revoked_at && (!row.expires_at || new Date(row.expires_at) > new Date())).length,
    },
  };
}

export async function getShare(db, id) {
  const share = await loadShare(db, id);
  assert(share, 404, 'That share does not exist.', 'NOT_FOUND');
  const recipients = (await db.query('SELECT email, user_id, created_at FROM inv.pos_share_recipients WHERE share_id=$1 ORDER BY email',
    [id])).rows;
  const customers = (await db.query(`SELECT c.id, c.name, c.business_name FROM inv.pos_share_customers sc
    JOIN inv.pos_customers c ON c.id=sc.customer_id WHERE sc.share_id=$1 ORDER BY lower(c.name)`, [id])).rows;
  const access = (await db.query(`SELECT recipient_email, outcome, created_at FROM inv.pos_share_access
    WHERE share_id=$1 ORDER BY created_at DESC LIMIT 50`, [id])).rows;
  return { share: describeShare(share, recipients.map(row => row.email), customers.map(row => row.id)),
    recipients, customers, access_log: access };
}

export async function updateShare(db, actor, id, input) {
  return db.transaction(async tx => {
    const share = (await tx.query('SELECT * FROM inv.pos_shares WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(share, 404, 'That share does not exist.', 'NOT_FOUND');
    const columns = input.columns
      ? resolveColumns(await columnCatalog(tx), input.columns).map(column => column.key)
      : share.columns;
    await tx.query(`UPDATE inv.pos_shares SET title=$2, columns=$3, allow_download=$4, expires_at=$5,
        revoked_at=CASE WHEN $6 THEN COALESCE(revoked_at, now()) ELSE NULL END WHERE id=$1`,
    [id, input.title ?? share.title, JSON.stringify(columns), input.can_download ?? share.allow_download,
      input.expires_at === undefined ? share.expires_at : input.expires_at,
      input.revoked === undefined ? Boolean(share.revoked_at) : input.revoked]);
    await audit(tx, share.share_type === 'PUBLIC' ? 'PUBLIC_SHARE_UPDATED' : 'PRIVATE_SHARE_UPDATED',
      { actorId: actor.id, entityType: 'SHARE', entityId: id,
        metadata: { revoked: input.revoked ?? null, allow_download: input.can_download ?? null,
          title: input.title ?? null, columns } });
    return describeShare(await loadShare(tx, id));
  });
}

export async function revokeShare(db, actor, id, reason = '') {
  return db.transaction(async tx => {
    const share = (await tx.query('SELECT * FROM inv.pos_shares WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(share, 404, 'That share does not exist.', 'NOT_FOUND');
    if (!share.revoked_at) {
      // Revocation takes effect on the next request because every read checks it.
      await tx.query('UPDATE inv.pos_shares SET revoked_at=now() WHERE id=$1', [id]);
      await audit(tx, 'SHARE_REVOKED', { actorId: actor.id, entityType: 'SHARE', entityId: id,
        metadata: { title: share.title, share_type: share.share_type, reason } });
    }
    return describeShare(await loadShare(tx, id));
  });
}

/* ------------------------------------------------------------- read access */

/** Owner or listed recipient; nobody else, whatever the interface shows. */
export async function shareForActor(db, id, actor) {
  const share = await loadShare(db, id);
  assertLive(share);
  if (share.owner_id === actor.id) return { share, role: 'OWNER' };
  const recipient = (await db.query('SELECT * FROM inv.pos_share_recipients WHERE share_id=$1 AND user_id=$2',
    [id, actor.id])).rows[0];
  assert(recipient, 403, 'This share was not granted to your account.', 'FORBIDDEN');
  return { share, role: 'RECIPIENT' };
}

async function sharedRows(db, share, url) {
  const catalog = await columnCatalog(db);
  const columns = resolveColumns(catalog, share.columns);
  // A recipient may search and filter only when the owner enabled it.
  const scope = await shareScopeIds(db, share);
  const effective = new URL(url.toString());
  if (!share.allow_filter) {
    for (const key of ['product_id', 'plan_id', 'employee_id', 'subscription', 'purchase_from', 'purchase_to',
      'expiry_from', 'expiry_to', 'status']) {
      effective.searchParams.delete(key);
    }
  }
  if (!share.allow_search) effective.searchParams.delete('search');
  const { rows, total } = await trackerRowsForExport(db, effective, { customerIds: scope });
  return { columns, ...publicShape(columns, rows), total,
    permissions: { search: share.allow_search, filter: share.allow_filter, download: share.allow_download } };
}

export async function privateShareData(db, share, url) {
  const data = await sharedRows(db, share, url);
  return { share: describeShare(share), ...data };
}

export async function publicShareData(db, share, url) {
  const data = await sharedRows(db, share, url);
  return { share: { title: share.title, expires_at: share.expires_at },
    permissions: data.permissions, columns: data.columns, rows: data.rows, total: data.total };
}

/** Public access is rate-limited per address and every attempt is logged. */
export async function publicShareByToken(db, rawToken,
  { ip = 'unknown', secret, password = '', enforcePassword = true, record = true } = {}) {
  assert(/^[A-Za-z0-9_-]{20,80}$/.test(String(rawToken || '')), 404, 'This link is not valid.', 'NOT_FOUND');
  await rateLimit(db, `share:${ip}`, 120, 300, secret);
  const digest = hash(rawToken);
  const share = (await db.query(`SELECT * FROM inv.pos_shares WHERE share_type='PUBLIC' AND token_hash=$1`, [digest])).rows[0];
  const log = (outcome, shareId) => db.query('INSERT INTO inv.pos_share_access(id,share_id,ip_hash,outcome) VALUES($1,$2,$3,$4)',
    [randomUUID(), shareId, hash(ip), outcome]);
  if (!share) throw new HttpError(404, 'This link is not valid.', 'NOT_FOUND');
  if (share.revoked_at || (share.expires_at && new Date(share.expires_at) <= new Date())) {
    await log('DENIED', share.id);
    throw new HttpError(410, share.revoked_at ? 'This link has been revoked.' : 'This link has expired.',
      share.revoked_at ? 'SHARE_REVOKED' : 'SHARE_EXPIRED');
  }
  if (enforcePassword && share.password_hash) {
    const supplied = createHash('sha256').update(String(password)).digest('hex');
    const ok = timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(share.password_hash, 'hex'));
    assert(ok, 401, 'This link needs its password.', 'PASSWORD_REQUIRED');
  }
  // The metadata call only asks what the link needs, so it is not counted as a
  // view of the data.
  if (record) {
    await db.query('UPDATE inv.pos_shares SET last_accessed_at=now(), access_count=access_count+1 WHERE id=$1', [share.id]);
    await log('VIEWED', share.id);
  }
  return share;
}

export { timingSafeEqual };
