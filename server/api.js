import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import {
  assert, HttpError, uuid, loginSchema, registerSchema, recoverSchema, changePasswordSchema, clientSchema, productSchema, settingsSchema,
  quotationDraftSchema, invoiceDraftSchema, paymentSchema, creditNoteSchema, statusActionSchema, cancelSchema,
  convertSchema, PAYMENT_METHODS, INTERVALS, TAX_TREATMENTS, ROUNDING_MODES,
  posCustomerSchema, customFieldSchema, customValuesSchema, columnOrderSchema, employeeSchema, planSchema,
  privateShareSchema, publicShareSchema, shareUpdateSchema, importPreviewSchema, importApplySchema,
  subscriptionSchema, FIELD_TYPES, SUBSCRIPTION_STATUSES, ROLES,
  cleanupPreviewSchema, cleanupExportSchema, cleanupExecuteSchema,
  influencerSchema, agreementDraftSchema, agreementUpdateSchema, agreementStatusActionSchema,
  salesImportApplySchema, saleStatusUpdateSchema, bulkSaleStatusUpdateSchema,
  softwareAgreementCreateSchema, softwareAgreementUpdateSchema, softwareAgreementStatusActionSchema,
} from './domain.js';
import { authenticate, checkPassword, hashPassword, hash, token, sessionCookie, rateLimit,
  canWrite, canManageSettings } from './auth.js';
import { amountInWords } from './words.js';
import { computeDocument } from './money.js';
import { STATE_LIST } from './states.js';
import { GST_RATE_SLABS } from './gst.js';
import { audit } from './audit.js';
import {
  createClient, updateClient, deleteClient, setClientStatus, listClients, getClient, clientWarnings,
  createProduct, updateProduct, deleteProduct, listProducts, updateSettings, saveLogo, settings, logoBytes, requireWriter,
  requireManager,
} from './service.js';
import {
  listQuotations, getQuotation, createQuotation, updateQuotation, deleteDraftQuotation, sendQuotation,
  transitionQuotation, duplicateQuotation, listInvoices, getInvoice, createInvoice, updateInvoice,
  deleteDraftInvoice, issueInvoice, cancelInvoice, recordPayment, listPayments, getPayment,
  createAdjustmentNote, getAdjustmentNote, listAdjustmentNotes, quotationSnapshotForRender,
  invoiceSnapshotForRender,
} from './documents.js';
import {
  dashboard, invoiceRegister, collectionReport, receivables, quotationReport, revenueByClient,
  revenueByProduct, taxSummary, auditTrail, businessOverview, customerStatement, toCsv,
} from './reports.js';
import { renderDocument } from './pdf.js';
import { renderReportPdf } from './report-pdf.js';
import { renderReportHtml } from './report-html.js';
import { previewNumber } from './numbering.js';
import {
  columnCatalog, listCustomers, getCustomer, createCustomer, updateCustomer, setCustomerStatus, customerWarnings,
  addSubscription, updateSubscription, trackerMetrics, listEmployees, createEmployee, setEmployeeStatus,
  listPlans, createPlan, updatePlan, listCustomFields, createCustomField, updateCustomField, setCustomFieldStatus,
  saveCustomValues, saveColumnLayout, trackerRowsForExport, columnKeys, resolveColumns,
} from './tracker.js';
import {
  exportWorkbook, exportCsv, exportTemplate, readSpreadsheet, autoMap, planImport, applyImport,
} from './excel.js';
import {
  createPrivateShare, createPublicShare, listShares, getShare, updateShare, revokeShare, shareForActor,
  privateShareData, publicShareByToken, publicShareData, SENSITIVE_COLUMNS,
} from './sharing.js';
import { createBackup, restoreBackup, inspectDatabase } from './backup.js';
import {
  inspectCleanupData, previewCleanup, generateExportArchive, executeCleanup,
} from './cleanup.js';
import {
  listInfluencers, getInfluencer, createInfluencer, updateInfluencer, checkInfluencerDuplicates, deleteInfluencer,
  listAgreements, getAgreement, createAgreement, updateAgreementDraft, transitionAgreementStatus,
  duplicateAgreement, deleteDraftAgreement, buildContractSnapshot, recordPdfGenerated, marketingDashboard,
  saveBrandLogo, brandLogoBytes, getBrandAssetsSummary,
} from './marketing.js';
import { renderContractPdf } from './contract-pdf.js';
import {
  listSoftwareAgreements, getSoftwareAgreement, createSoftwareAgreement, updateSoftwareAgreementDraft,
  transitionSoftwareAgreementStatus, duplicateSoftwareAgreement, deleteDraftSoftwareAgreement, buildSoftwareContractSnapshot,
  recordSoftwarePdfGenerated, calculateSoftwareContractFinancials, DEFAULT_SERVICE_CATEGORIES,
} from './software-contracts.js';
import { renderSoftwareContractPdf } from './software-contract-pdf.js';
import { renderSoftwareContractHtml } from './software-contract-template.js';
import {
  generateSalesTemplate, parseAndValidateSalesFile, confirmSalesImport, listSalesBatches,
  getSalesDashboardMetrics, listSalesRecords, updateSaleRecordStatus, bulkUpdateSalesStatus,
  exportSalesToExcel,
} from './influencer-sales.js';
import {
  renderInfluencerSalesReportPdf, renderConsolidatedSalesReportPdf,
} from './sales-report-pdf.js';

const baseHeaders = {
  'Cache-Control': 'no-store, private',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  Vary: 'Cookie',
};
const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), {
  status, headers: { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8', ...extra },
});
const localSecret = token();
const emptyBody = z.object({}).strict();
const setupSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  password: z.string().min(10, 'Use a password of at least 10 characters').max(200),
  display_name: z.string().trim().min(1, 'Enter your name').max(120),
  business_name: z.string().trim().max(160).default('Nextora Creations'),
  state_code: z.string().trim().max(2).default(''),
}).strict();

/**
 * The Electron desktop runtime serves the renderer from a custom scheme, which
 * is a URL with an opaque origin (`new URL('app://x').origin === 'null'`). Such
 * a build is a local single-user install with no listening socket, so the origin
 * is echoed as a fixed literal instead of a parsed one. Hosted configurations
 * keep the strict parsing below. The origin check in createAPI is unchanged, so
 * a request that does not carry the desktop origin is still refused.
 */
export const DESKTOP_SCHEME = 'app:';

export function configuration(env = process.env) {
  const production = env.NODE_ENV === 'production' || env.NETLIFY === 'true';
  const configured = env.APP_URL || (production ? '' : 'http://localhost:5174');
  if (configured.startsWith(`${DESKTOP_SCHEME}//`)) {
    assert(!production, 503, 'APP_URL must be an application origin.', 'CONFIGURATION_ERROR');
    const desktopOrigin = configured.replace(/\/+$/, '');
    assert(/^app:\/\/[a-z0-9.-]+$/i.test(desktopOrigin), 503,
      'APP_URL must be an application origin.', 'CONFIGURATION_ERROR');
    return { production: false, appOrigin: desktopOrigin, rateSecret: env.RATE_LIMIT_SECRET || localSecret };
  }
  const app = new URL(configured);
  assert(!app.username && !app.password && app.pathname === '/' && !app.search && !app.hash
    && (production ? app.protocol === 'https:' : ['http:', 'https:'].includes(app.protocol)),
  503, 'APP_URL must be an application origin.', 'CONFIGURATION_ERROR');
  assert(!production || (env.RATE_LIMIT_SECRET || '').length >= 32, 503,
    'Server security configuration is incomplete.', 'CONFIGURATION_ERROR');
  return { production, appOrigin: app.origin, rateSecret: env.RATE_LIMIT_SECRET || localSecret };
}

async function body(request, schema, limit = 262144) {
  assert(request.headers.get('content-type')?.split(';')[0] === 'application/json', 415,
    'Send a JSON request.', 'UNSUPPORTED_MEDIA_TYPE');
  const reader = request.body?.getReader();
  assert(reader, 400, 'Request body is required.', 'VALIDATION_ERROR');
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, 'Request body is too large.', 'PAYLOAD_TOO_LARGE');
    }
    parts.push(Buffer.from(value));
  }
  let data;
  try {
    data = JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request must contain valid JSON.', 'INVALID_JSON');
  }
  return schema.parse(data);
}

const csvFile = (name, csv) => new Response(csv, {
  headers: { ...baseHeaders, 'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${name}"` },
});

/** Spreadsheet downloads are private to the browser and never cached. */
const fileResponse = (name, bytes, type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') =>
  new Response(bytes, {
    headers: { ...baseHeaders, 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"` },
  });

/** Row-level errors are handed back as a file so they can be fixed and re-imported. */
const buildErrorCsv = entries => ['row,error',
  ...entries.map(entry => `${entry.row},"${String(entry.error).replace(/"/g, '""')}"`)].join('\r\n');

export function createAPI(db, config) {
  return async function handle(request, { ip = 'unknown' } = {}) {
    try {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      const path = url.pathname.replace(/^\/\.netlify\/functions\/documents/, '/api').replace(/\/+$/, '') || '/api';
      const mutation = !['GET', 'HEAD'].includes(method);

      assert(path === '/api' || path.startsWith('/api/'), 404, 'Endpoint not found.', 'NOT_FOUND');
      if (mutation) {
        assert(request.headers.get('origin') === config.appOrigin, 403,
          'Requests must come from the invoicing application.', 'BAD_ORIGIN');
        assert(request.headers.get('sec-fetch-site') !== 'cross-site', 403,
          'Cross-site requests are not allowed.', 'BAD_ORIGIN');
      }
      await rateLimit(db, `ip:${ip}`, 300, 60, config.rateSecret);

      /* ------------------------------------------------------------- auth */

      if (path === '/api/auth/setup' && method === 'GET') {
        const count = (await db.query('SELECT count(*)::int AS n FROM inv.users')).rows[0].n;
        return json({ setup_required: count === 0 });
      }

      if (path === '/api/auth/setup' && method === 'POST') {
        await rateLimit(db, `setup:${ip}`, 10, 900, config.rateSecret);
        const input = await body(request, setupSchema);
        const raw = token();
        const csrf = token();
        const userId = randomUUID();
        const passwordHash = await hashPassword(input.password);
        await db.transaction(async tx => {
          const count = (await tx.query('SELECT count(*)::int AS n FROM inv.users')).rows[0].n;
          assert(count === 0, 409, 'The initial owner account has already been configured.', 'ALREADY_INITIALIZED');
          await tx.query(`INSERT INTO inv.users(id,email,password_hash,role,display_name,disabled,must_change_password)
            VALUES($1,$2,$3,'OWNER',$4,false,false)`, [userId, input.email, passwordHash, input.display_name]);
          await tx.query(`INSERT INTO inv.business_settings(id,business_name,state_code)
            VALUES(true,$1,$2)
            ON CONFLICT (id) DO UPDATE SET
              business_name = COALESCE(NULLIF($1,''), inv.business_settings.business_name),
              state_code = COALESCE(NULLIF($2,''), inv.business_settings.state_code)`,
          [input.business_name || 'Nextora Creations', input.state_code || '']);
          await tx.query(`INSERT INTO inv.sessions(token_hash,user_id,csrf_token,expires_at)
            VALUES($1,$2,$3,now()+interval '8 hours')`, [hash(raw), userId, csrf]);
          await audit(tx, 'USER_CREATED', { actorId: userId, entityType: 'USER', entityId: userId,
            metadata: { email: input.email, role: 'OWNER', bootstrap: true } });
          await audit(tx, 'USER_LOGIN', { actorId: userId, entityType: 'USER', entityId: userId });
        });
        return json({
          user: { id: userId, email: input.email, role: 'OWNER', display_name: input.display_name,
            must_change_password: false },
          csrf_token: csrf,
        }, 201, { 'Set-Cookie': sessionCookie(raw, config.production) });
      }

      if (path === '/api/auth/login' && method === 'POST') {
        await rateLimit(db, `login:${ip}`, 10, 900, config.rateSecret);
        const input = await body(request, loginSchema);
        await rateLimit(db, `account:${input.email}`, 15, 900, config.rateSecret);
        const user = (await db.query('SELECT * FROM inv.users WHERE email=$1', [input.email])).rows[0];
        const valid = await checkPassword(input.password, user?.password_hash);
        assert(valid && !user.disabled, 401, 'The email or password is incorrect.', 'INVALID_CREDENTIALS');
        const raw = token();
        const csrf = token();
        await db.transaction(async tx => {
          await tx.query(`INSERT INTO inv.sessions(token_hash,user_id,csrf_token,expires_at)
            VALUES($1,$2,$3,now()+interval '8 hours')`, [hash(raw), user.id, csrf]);
          await audit(tx, 'USER_LOGIN', { actorId: user.id, entityType: 'USER', entityId: user.id });
        });
        return json({
          user: { id: user.id, email: user.email, role: user.role, display_name: user.display_name,
            must_change_password: !!user.must_change_password },
          csrf_token: csrf,
        }, 200, { 'Set-Cookie': sessionCookie(raw, config.production) });
      }

      if (path === '/api/auth/register' && method === 'POST') {
        await rateLimit(db, `register:${ip}`, 10, 900, config.rateSecret);
        const input = await body(request, registerSchema);
        await rateLimit(db, `account-reg:${input.email}`, 10, 900, config.rateSecret);
        const existing = (await db.query('SELECT id FROM inv.users WHERE email=$1', [input.email])).rows[0];
        assert(!existing, 409, 'An account with this email address already exists.', 'DUPLICATE_EMAIL');

        const userCount = (await db.query('SELECT count(*)::int AS n FROM inv.users')).rows[0].n;
        const role = userCount === 0 ? 'OWNER' : 'FINANCE';
        const raw = token();
        const csrf = token();
        const userId = randomUUID();
        const passwordHash = await hashPassword(input.password);

        await db.transaction(async tx => {
          await tx.query(`INSERT INTO inv.users(id,email,password_hash,role,display_name,disabled,must_change_password)
            VALUES($1,$2,$3,$4,$5,false,false)`, [userId, input.email, passwordHash, role, input.display_name]);
          await tx.query(`INSERT INTO inv.sessions(token_hash,user_id,csrf_token,expires_at)
            VALUES($1,$2,$3,now()+interval '8 hours')`, [hash(raw), userId, csrf]);
          await audit(tx, 'USER_REGISTERED', { actorId: userId, entityType: 'USER', entityId: userId,
            metadata: { email: input.email, role } });
          await audit(tx, 'USER_LOGIN', { actorId: userId, entityType: 'USER', entityId: userId });
        });

        return json({
          user: { id: userId, email: input.email, role, display_name: input.display_name,
            must_change_password: false },
          csrf_token: csrf,
          message: 'Account created successfully.',
        }, 201, { 'Set-Cookie': sessionCookie(raw, config.production) });
      }

      if (path === '/api/auth/recover' && method === 'POST') {
        await rateLimit(db, `recover:${ip}`, 10, 900, config.rateSecret);
        const input = await body(request, recoverSchema);
        await rateLimit(db, `account-recover:${input.email}`, 10, 900, config.rateSecret);

        const settingsRow = (await db.query('SELECT recovery_key_hash FROM inv.business_settings WHERE id=true')).rows[0];
        const storedRecoveryHash = settingsRow?.recovery_key_hash;
        let recoveryValid = false;
        if (storedRecoveryHash && storedRecoveryHash.length > 0) {
          recoveryValid = await checkPassword(input.recovery_key, storedRecoveryHash);
        } else {
          // Default recovery key for local internal staff deployment
          recoveryValid = input.recovery_key === 'NEXTORA-RECOVERY-2026';
        }
        assert(recoveryValid, 401, 'Invalid recovery key. Contact your administrator for the current key.', 'INVALID_RECOVERY_KEY');

        const user = (await db.query('SELECT * FROM inv.users WHERE email=$1', [input.email])).rows[0];
        assert(user && !user.disabled, 404, 'No active account found for this email address.', 'USER_NOT_FOUND');

        const passwordHash = await hashPassword(input.password);
        await db.transaction(async tx => {
          await tx.query('UPDATE inv.users SET password_hash=$2, must_change_password=false WHERE id=$1',
            [user.id, passwordHash]);
          await tx.query('DELETE FROM inv.sessions WHERE user_id=$1', [user.id]);
          await audit(tx, 'PASSWORD_RECOVERED', { actorId: user.id, entityType: 'USER', entityId: user.id,
            metadata: { email: user.email } });
        });

        return json({ success: true, message: 'Password has been reset successfully. Please sign in.' }, 200);
      }

      /* ------------------------------------------------------ public shares */

      /*
       * A public link is served without a session, so these routes are handled
       * before authentication on purpose. Everything they can return is decided
       * by the stored share: its scope, its column list and its flags.
       */
      const publicMatch = path.match(/^\/api\/public\/([A-Za-z0-9_-]{20,80})(?:\/(rows|export))?$/);
      if (publicMatch) {
        const raw = publicMatch[1];
        const action = publicMatch[2];
        const withPassword = async () => {
          let password = '';
          if (mutation) {
            assert(request.headers.get('content-type')?.startsWith('application/json'), 415,
              'Send a JSON request.', 'UNSUPPORTED_MEDIA_TYPE');
            const payload = await request.clone().json().catch(() => ({}));
            password = typeof payload?.password === 'string' ? payload.password : '';
          }
          return publicShareByToken(db, raw, { ip, secret: config.rateSecret, password });
        };
        if (!action && method === 'GET') {
          // Describes the link (including whether it needs a password) without
          // releasing any data, so no password is required yet.
          const share = await publicShareByToken(db, raw,
            { ip, secret: config.rateSecret, enforcePassword: false, record: false });
          const catalog = await columnCatalog(db);
          const columns = catalog.columns.filter(column => share.columns.includes(column.key));
          return json({ share: { title: share.title, expires_at: share.expires_at },
            permissions: { search: share.allow_search, filter: share.allow_filter, download: share.allow_download },
            password_required: Boolean(share.password_hash),
            columns: columns.map(column => ({ key: column.key, label: column.label, type: column.type })) });
        }
        if (action === 'rows' && method === 'POST') {
          return json(await publicShareData(db, await withPassword(), url));
        }
        if (action === 'export' && method === 'POST') {
          const share = await withPassword();
          assert(share.allow_download, 403, 'Downloads are not enabled for this link.', 'FORBIDDEN');
          const data = await publicShareData(db, await withPassword(), url);
          const columns = data.columns.map(column => ({ ...column, width: 160 }));
          if (url.searchParams.get('format') === 'csv') {
            return csvFile('pos-customers.csv', await exportCsv({ columns, rows: data.rows }));
          }
          return fileResponse('pos-customers.xlsx', await exportWorkbook({ columns, rows: data.rows, title: share.title }));
        }
      }

      const actor = await authenticate(db, request, config.production);
      if (mutation) {
        assert(request.headers.get('x-csrf-token') === actor.csrf_token, 403,
          'Your security token has expired. Refresh the page.', 'CSRF_FAILED');
      }

      if (path === '/api/auth/me' && method === 'GET') {
        return json({ user: { id: actor.id, email: actor.email, role: actor.role, display_name: actor.display_name,
          must_change_password: !!actor.must_change_password }, csrf_token: actor.csrf_token });
      }
      if (path === '/api/auth/logout' && method === 'POST') {
        await body(request, emptyBody);
        await db.transaction(async tx => {
          await tx.query('DELETE FROM inv.sessions WHERE token_hash=$1', [actor.token_hash]);
          await audit(tx, 'USER_LOGOUT', { actorId: actor.id, entityType: 'USER', entityId: actor.id });
        });
        return json({ success: true }, 200, { 'Set-Cookie': sessionCookie('', config.production, 0) });
      }
      if (path === '/api/auth/password' && method === 'POST') {
        await rateLimit(db, `password:${actor.id}`, 5, 900, config.rateSecret);
        const input = await body(request, changePasswordSchema);
        await db.transaction(async tx => {
          const user = (await tx.query('SELECT * FROM inv.users WHERE id=$1 FOR UPDATE', [actor.id])).rows[0];
          assert(await checkPassword(input.current_password, user.password_hash), 401,
            'The current password is incorrect.', 'INVALID_CREDENTIALS');
          assert(input.password !== input.current_password, 400, 'Choose a different password.', 'VALIDATION_ERROR');
          await tx.query('UPDATE inv.users SET password_hash=$2, must_change_password=false WHERE id=$1',
            [actor.id, await hashPassword(input.password)]);
          await tx.query('DELETE FROM inv.sessions WHERE user_id=$1', [actor.id]);
          await audit(tx, 'PASSWORD_CHANGED', { actorId: actor.id, entityType: 'USER', entityId: actor.id });
        });
        return json({ success: true }, 200, { 'Set-Cookie': sessionCookie('', config.production, 0) });
      }
      if (path === '/api/settings/recovery-key' && method === 'POST') {
        requireManager(actor);
        const input = await body(request, z.object({
          recovery_key: z.string().trim().min(8, 'Recovery key must be at least 8 characters').max(128),
        }).strict());
        const keyHash = await hashPassword(input.recovery_key);
        await db.transaction(async tx => {
          await tx.query('UPDATE inv.business_settings SET recovery_key_hash=$1 WHERE id=true', [keyHash]);
          await audit(tx, 'RECOVERY_KEY_UPDATED', { actorId: actor.id, entityType: 'SETTINGS', entityId: 'recovery-key' });
        });
        return json({ success: true, message: 'Business recovery key updated successfully.' }, 200);
      }

      /* ---------------------------------------------------- reference data */

      if (path === '/api/reference' && method === 'GET') {
        const business = await settings(db);
        return json({
          states: STATE_LIST,
          gst_rate_slabs: GST_RATE_SLABS,
          tax_treatments: TAX_TREATMENTS,
          tax_modes: ['EXCLUSIVE', 'INCLUSIVE'],
          payment_methods: PAYMENT_METHODS,
          billing_intervals: INTERVALS,
          rounding_modes: ROUNDING_MODES,
          currencies: [{ code: 'INR', label: 'Indian Rupee' }],
          numbering_preview: {
            quotation: previewNumber(business.quotation_prefix, new Date()),
            invoice: previewNumber(business.invoice_prefix, new Date()),
            receipt: previewNumber(business.receipt_prefix, new Date()),
            influencer_agreement: previewNumber(business.influencer_contract_prefix || 'NC/INF', new Date()),
            software_agreement: previewNumber(business.software_contract_prefix || 'NC/SDA', new Date()),
          },
          software_service_categories: DEFAULT_SERVICE_CATEGORIES,
          business: { business_name: business.business_name, state_code: business.state_code,
            gstin: business.gstin, default_payment_terms_days: business.default_payment_terms_days,
            default_quotation_validity_days: business.default_quotation_validity_days,
            default_tax_rate_bp: business.default_tax_rate_bp, rounding_mode: business.rounding_mode,
            product_price_tax_mode: business.product_price_tax_mode || 'EXCLUSIVE',
            influencer_contract_prefix: business.influencer_contract_prefix || 'NC/INF',
            software_contract_prefix: business.software_contract_prefix || 'NC/SDA',
            terms: business.terms, quotation_terms: business.quotation_terms },
        });
      }

      /* ---------------------------------------------------------- settings */

      if (path === '/api/settings' && method === 'GET') return json({ settings: await settings(db) });
      if (path === '/api/settings' && method === 'PUT') {
        return json({ settings: await updateSettings(db, actor, await body(request, settingsSchema)) });
      }
      if (path === '/api/settings/logo' && method === 'POST') {
        const input = await body(request, z.object({ png: z.string().min(24).max(900000) }).strict(), 1048576);
        return json({ logo: await saveLogo(db, actor, input.png) });
      }
      if (path === '/api/settings/logo' && method === 'GET') {
        const asset = await brandLogoBytes(db, 'company_logo');
        if (!asset?.bytes) return new Response('Not found', { status: 404 });
        return new Response(asset.bytes, {
          status: 200,
          headers: { ...baseHeaders, 'Content-Type': asset.mimeType, 'Cache-Control': 'no-cache' }
        });
      }
      if ((path === '/api/settings/product-logo' || path === '/api/marketing/product-logo') && method === 'POST') {
        requireManager(actor);
        const input = await body(request, z.object({ logo: z.string().min(24).max(1800000) }).strict(), 2097152);
        return json({ logo: await saveBrandLogo(db, actor, input.logo, 'product_logo') });
      }
      if ((path === '/api/settings/product-logo' || path === '/api/marketing/product-logo') && method === 'GET') {
        const asset = await brandLogoBytes(db, 'product_logo');
        if (!asset?.bytes) return new Response('Not found', { status: 404 });
        return new Response(asset.bytes, {
          status: 200,
          headers: { ...baseHeaders, 'Content-Type': asset.mimeType, 'Cache-Control': 'no-cache' }
        });
      }
      if (path === '/api/marketing/brand-assets' && method === 'GET') {
        return json(await getBrandAssetsSummary(db));
      }
      if (path === '/api/backup/status' && method === 'GET') {
        requireManager(actor);
        return json(await inspectDatabase(db));
      }
      if (path === '/api/backup/create' && method === 'POST') {
        requireManager(actor);
        const input = await body(request, z.object({ destination_path: z.string().trim().min(1).max(1024) }).strict());
        const result = await createBackup(db, input.destination_path);
        await db.transaction(tx => audit(tx, 'DATABASE_BACKUP_CREATED', {
          actorId: actor.id, entityType: 'DATABASE', metadata: { size_bytes: result.size_bytes },
        }));
        return json({ backup: result });
      }
      if (path === '/api/backup/restore' && method === 'POST') {
        assert(actor.role === 'OWNER', 403, 'Only the owner can restore a database backup.', 'FORBIDDEN');
        const input = await body(request, z.object({ source_path: z.string().trim().min(1).max(1024) }).strict());
        const result = await restoreBackup(db, input.source_path);
        return json({ restore: result });
      }

      /* ---------------------------------------------------------- business data cleanup */

      if (path === '/api/cleanup/status' && method === 'GET') {
        requireManager(actor);
        return json(await inspectCleanupData(db));
      }
      if (path === '/api/cleanup/preview' && method === 'POST') {
        requireManager(actor);
        const input = await body(request, cleanupPreviewSchema);
        return json(await previewCleanup(db, {
          category: input.category,
          filterType: input.filter_type,
          fromDate: input.from_date,
          toDate: input.to_date,
          selectedIds: input.selected_ids,
        }));
      }
      if (path === '/api/cleanup/export' && method === 'POST') {
        requireManager(actor);
        const input = await body(request, cleanupExportSchema);
        return json(await generateExportArchive(db, {
          category: input.category,
          ids: input.ids,
          destinationDir: input.destination_dir,
        }));
      }
      if (path === '/api/cleanup/execute' && method === 'POST') {
        requireManager(actor);
        const input = await body(request, cleanupExecuteSchema);
        return json(await executeCleanup(db, actor, {
          category: input.category,
          ids: input.ids,
          verificationToken: input.verification_token,
          confirmationPhrase: input.confirmation_phrase,
          backupDir: input.backup_dir,
        }));
      }

      /* ---------------------------------------------------------- clients */

      if (path === '/api/clients' && method === 'GET') return json(await listClients(db, url));
      if (path === '/api/clients' && method === 'POST') {
        const input = await body(request, clientSchema);
        const found = await clientWarnings(db, input);
        return json({ ...(await getClient(db, (await createClient(db, actor, input)).id)), ...found }, 201);
      }
      if (path === '/api/clients/check-duplicates' && method === 'POST') {
        const input = await body(request, z.object({
          name: z.string().trim().max(160).default(''), company_name: z.string().trim().max(160).default(''),
          email: z.string().trim().max(254).default(''), gstin: z.string().trim().toUpperCase().max(15).default(''),
          state_code: z.string().trim().max(2).default(''), exclude_id: uuid.nullable().default(null),
        }).strict());
        return json(await clientWarnings(db, input));
      }
      const clientMatch = path.match(/^\/api\/clients\/([^/]+)(?:\/(status))?$/);
      if (clientMatch) {
        const id = uuid.parse(clientMatch[1]);
        if (!clientMatch[2] && method === 'GET') return json(await getClient(db, id));
        if (!clientMatch[2] && method === 'PATCH') return json({ client: await updateClient(db, actor, id, await body(request, clientSchema)) });
        if (!clientMatch[2] && method === 'DELETE') return json(await deleteClient(db, actor, id));
        if (clientMatch[2] === 'status' && method === 'POST') {
          const input = await body(request, z.object({ status: z.enum(['ACTIVE', 'ARCHIVED']) }).strict());
          return json({ client: await setClientStatus(db, actor, id, input.status) });
        }
      }

      /* -------------------------------------------------- products & services */

      if (path === '/api/products' && method === 'GET') return json(await listProducts(db, url));
      if (path === '/api/products' && method === 'POST') {
        requireWriter(actor);
        return json({ product: await createProduct(db, actor, await body(request, productSchema)) }, 201);
      }
      const productMatch = path.match(/^\/api\/products\/([^/]+)$/);
      if (productMatch && method === 'PATCH') {
        return json({ product: await updateProduct(db, actor, uuid.parse(productMatch[1]), await body(request, productSchema)) });
      }
      if (productMatch && method === 'DELETE') {
        return json(await deleteProduct(db, actor, uuid.parse(productMatch[1])));
      }

      /* -------------------------------------------------------- quotations */

      if (path === '/api/quotations' && method === 'GET') return json(await listQuotations(db, url));
      if (path === '/api/quotations' && method === 'POST') {
        return json(await createQuotation(db, actor, await body(request, quotationDraftSchema)), 201);
      }
      const quotationMatch = path.match(/^\/api\/quotations\/([^/]+)(?:\/(send|transition|convert|duplicate|pdf))?$/);
      if (quotationMatch) {
        const id = uuid.parse(quotationMatch[1]);
        const action = quotationMatch[2];
        if (!action && method === 'GET') return json(await getQuotation(db, id));
        if (!action && method === 'PATCH') return json(await updateQuotation(db, actor, id, await body(request, quotationDraftSchema)));
        if (!action && method === 'DELETE') return json(await deleteDraftQuotation(db, actor, id));
        if (action === 'send' && method === 'POST') return json(await sendQuotation(db, actor, id));
        if (action === 'duplicate' && method === 'POST') return json(await duplicateQuotation(db, actor, id), 201);
        if (action === 'transition' && method === 'POST') {
          const input = await body(request, statusActionSchema.extend({
            status: z.enum(['SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED']),
          }).strict());
          if (input.status === 'REJECTED' || input.status === 'CANCELLED') {
            assert(input.note.trim().length >= 5, 400, 'Give a reason for this change.', 'VALIDATION_ERROR');
          }
          return json(await transitionQuotation(db, actor, id, input.status, { note: input.note }));
        }
        if (action === 'convert' && method === 'POST') {
          const input = await body(request, convertSchema);
          return json(await convertQuotation(db, actor, id, input), 201);
        }
        if (action === 'pdf' && method === 'GET') {
          const { snapshot, issued } = await quotationSnapshotForRender(db, id);
          return pdfResponse(db, snapshot, { filename: `${safeName(snapshot.number) || 'draft'}.pdf`,
            view: url.searchParams.get('view') === '1', preview: !issued });
        }
      }

      /* ---------------------------------------------------------- invoices */

      if (path === '/api/invoices' && method === 'GET') return json(await listInvoices(db, url));
      if (path === '/api/invoices' && method === 'POST') {
        return json(await createInvoice(db, actor, await body(request, invoiceDraftSchema)), 201);
      }
      const invoiceMatch = path.match(/^\/api\/invoices\/([^/]+)(?:\/(issue|cancel|payments|credit-notes|pdf))?$/);
      if (invoiceMatch) {
        const id = uuid.parse(invoiceMatch[1]);
        const action = invoiceMatch[2];
        if (!action && method === 'GET') return json(await getInvoice(db, id));
        if (!action && method === 'PATCH') return json(await updateInvoice(db, actor, id, await body(request, invoiceDraftSchema)));
        if (!action && method === 'DELETE') return json(await deleteDraftInvoice(db, actor, id));
        if (action === 'issue' && method === 'POST') return json(await issueInvoice(db, actor, id));
        if (action === 'cancel' && method === 'POST') {
          const input = await body(request, cancelSchema.extend({ void: z.boolean().default(false) }).strict());
          return json(await cancelInvoice(db, actor, id, input.reason, { voided: input.void }));
        }
        if (action === 'payments' && method === 'POST') {
          return json(await recordPayment(db, actor, id, await body(request, paymentSchema)), 201);
        }
        if (action === 'credit-notes' && method === 'POST') {
          const input = await body(request, creditNoteSchema.extend({ kind: z.enum(['CREDIT', 'DEBIT']).default('CREDIT') }).strict());
          return json(await createAdjustmentNote(db, actor, id, {
            ...input, items: input.items.map(item => ({ ...item, tax_rate_bp: item.tax_rate_bp || 0 })),
          }), 201);
        }
        if (action === 'pdf' && method === 'GET') {
          const { snapshot, issued } = await invoiceSnapshotForRender(db, id);
          return pdfResponse(db, snapshot, { filename: `${safeName(snapshot.number) || 'draft'}.pdf`,
            view: url.searchParams.get('view') === '1', preview: !issued });
        }
      }

      /* ---------------------------------------------------------- payments */

      if (path === '/api/payments' && method === 'GET') return json(await listPayments(db, url));
      const paymentMatch = path.match(/^\/api\/payments\/([^/]+)(?:\/(receipt))?$/);
      if (paymentMatch) {
        const id = uuid.parse(paymentMatch[1]);
        if (!paymentMatch[2] && method === 'GET') return json({ payment: await getPayment(db, id) });
        if (paymentMatch[2] === 'receipt' && method === 'GET') {
          const payment = await getPayment(db, id);
          return pdfResponse(db, payment.snapshot, {
            filename: `${safeName(payment.receipt_number)}.pdf`,
            view: url.searchParams.get('view') === '1', preview: false,
          });
        }
      }

      /* --------------------------------------------------- adjustment notes */

      if (path === '/api/adjustment-notes' && method === 'GET') return json(await listAdjustmentNotes(db, url));
      const noteMatch = path.match(/^\/api\/adjustment-notes\/([^/]+)(?:\/(pdf))?$/);
      if (noteMatch) {
        const id = uuid.parse(noteMatch[1]);
        if (!noteMatch[2] && method === 'GET') return json(await getAdjustmentNote(db, id));
        if (noteMatch[2] === 'pdf' && method === 'GET') {
          const note = await getAdjustmentNote(db, id);
          return pdfResponse(db, note.note.snapshot, {
            filename: `${safeName(note.note.note_number)}.pdf`,
            view: url.searchParams.get('view') === '1', preview: false,
          });
        }
      }

      /* ----------------------------------------------------------- reports */

      const reportPdfResponse = (filename, pdfBytes, { view = true } = {}) => new Response(pdfBytes, {
        headers: {
          ...baseHeaders,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `${view ? 'inline' : 'attachment'}; filename="${safeName(filename)}"`,
        },
      });

      const reportHtmlResponse = html => new Response(html, {
        headers: {
          ...baseHeaders,
          'Content-Type': 'text/html; charset=utf-8',
        },
      });

      if (path === '/api/dashboard' && method === 'GET') return json(await dashboard(db, url));
      if (path === '/api/audit' && method === 'GET') return json(await auditTrail(db, url));

      if (path === '/api/reports/export-pdf' && method === 'GET') {
        const section = (url.searchParams.get('section') || 'invoices').toLowerCase();
        const format = url.searchParams.get('format') || 'pdf';
        const download = url.searchParams.get('download') === '1' || url.searchParams.get('download') === 'true';
        const view = !download;

        let reportData;
        if (section === 'overview') reportData = await businessOverview(db, url);
        else if (section === 'invoices') reportData = await invoiceRegister(db, url);
        else if (section === 'collections') reportData = await collectionReport(db, url);
        else if (section === 'receivables') reportData = await receivables(db);
        else if (section === 'quotations') reportData = await quotationReport(db, url);
        else if (section === 'clients') reportData = await revenueByClient(db, url);
        else if (section === 'products') reportData = await revenueByProduct(db, url);
        else if (section === 'tax') reportData = await taxSummary(db, url);
        else if (section === 'statement') reportData = await customerStatement(db, url.searchParams.get('client_id'), url);
        else throw new HttpError(400, `Unknown report section: ${section}`, 'UNKNOWN_SECTION');

        const options = {
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
          rangeLabel: url.searchParams.get('range_label') || (reportData.range?.label),
        };

        if (format === 'html') {
          return reportHtmlResponse(renderReportHtml(section, reportData, options));
        }

        const pdfBytes = await renderReportPdf(section, reportData, options);
        return reportPdfResponse(`report-${section}-${new Date().toISOString().slice(0, 10)}.pdf`, pdfBytes, { view });
      }

      if (path === '/api/reports/overview' && method === 'GET') {
        const data = await businessOverview(db, url);
        const format = url.searchParams.get('format');
        const options = { from: data.range?.from, to: data.range?.to, rangeLabel: data.range?.label };
        if (format === 'pdf') return reportPdfResponse('overview.pdf', await renderReportPdf('overview', data, options));
        if (format === 'html') return reportHtmlResponse(renderReportHtml('overview', data, options));
        return json(data);
      }

      if (path === '/api/reports/statement' && method === 'GET') {
        const clientId = url.searchParams.get('client_id');
        const data = await customerStatement(db, clientId, url);
        const format = url.searchParams.get('format');
        const options = { from: url.searchParams.get('from'), to: url.searchParams.get('to') };
        if (format === 'pdf') {
          return reportPdfResponse(`statement-${safeName(data.client?.name || 'customer')}.pdf`, await renderReportPdf('statement', data, options));
        }
        if (format === 'html') return reportHtmlResponse(renderReportHtml('statement', data, options));
        if (format === 'csv') {
          return csvFile(`statement-${safeName(data.client?.name || 'customer')}.csv`, toCsv([
            { key: 'trans_date', label: 'Date' },
            { key: 'trans_type', label: 'Type' },
            { key: 'doc_number', label: 'Document/Receipt #' },
            { key: 'notes', label: 'Description' },
            { key: 'debit_minor', label: 'Debit (Invoiced)' },
            { key: 'credit_minor', label: 'Credit (Paid)' },
            { key: 'balance_minor', label: 'Running Balance' },
          ], data.transactions));
        }
        return json(data);
      }

      const csvReports = {
        '/api/reports/invoices': ['invoices.csv', async () => {
          const data = await invoiceRegister(db, url);
          return toCsv([
            { key: 'invoice_number', label: 'Invoice number' }, { key: 'issue_date', label: 'Issue date' },
            { key: 'due_date', label: 'Due date' }, { key: 'client_name', label: 'Client' },
            { key: 'client_gstin', label: 'Client GSTIN' }, { key: 'status', label: 'Status' },
            { key: 'payment_status', label: 'Payment status' }, { key: 'taxable_minor', label: 'Taxable value' },
            { key: 'cgst_minor', label: 'CGST' }, { key: 'sgst_minor', label: 'SGST' }, { key: 'igst_minor', label: 'IGST' },
            { key: 'grand_total_minor', label: 'Invoice total' }, { key: 'paid_minor', label: 'Collected' },
            { key: 'balance_due_minor', label: 'Balance due' },
          ], data.rows);
        }],
        '/api/reports/collections': ['collections.csv', async () => {
          const data = await collectionReport(db, url);
          return toCsv([
            { key: 'receipt_number', label: 'Receipt number' }, { key: 'paid_on', label: 'Paid on' },
            { key: 'client_name', label: 'Client' }, { key: 'invoice_number', label: 'Invoice' },
            { key: 'method', label: 'Method' }, { key: 'reference', label: 'Reference' },
            { key: 'amount_minor', label: 'Amount' },
          ], data.rows);
        }],
        '/api/reports/receivables': ['receivables.csv', async () => {
          const data = await receivables(db);
          return toCsv([
            { key: 'invoice_number', label: 'Invoice number' }, { key: 'client_name', label: 'Client' },
            { key: 'issue_date', label: 'Issue date' }, { key: 'due_date', label: 'Due date' },
            { key: 'grand_total_minor', label: 'Invoice total' }, { key: 'paid_minor', label: 'Collected' },
            { key: 'balance_due_minor', label: 'Balance due' }, { key: 'days_overdue', label: 'Days overdue' },
            { key: 'ageing', label: 'Ageing bucket' },
          ], data.rows);
        }],
        '/api/reports/tax-summary': ['tax-summary.csv', async () => {
          const data = await taxSummary(db, url);
          return toCsv([
            { key: 'hsn_sac', label: 'HSN/SAC' }, { key: 'tax_rate_bp', label: 'Rate (basis points)' },
            { key: 'taxable_minor', label: 'Taxable value' }, { key: 'cgst_minor', label: 'CGST' },
            { key: 'sgst_minor', label: 'SGST' }, { key: 'igst_minor', label: 'IGST' },
            { key: 'tax_minor', label: 'Total tax' },
          ], data.output_rows);
        }],
        '/api/reports/revenue-by-product': ['revenue-by-product.csv', async () => {
          const data = await revenueByProduct(db, url);
          return toCsv([
            { key: 'description', label: 'Item description' }, { key: 'sku', label: 'SKU' },
            { key: 'category', label: 'Category' }, { key: 'quantity_milli', label: 'Quantity (milli)' },
            { key: 'unit', label: 'Unit' }, { key: 'line_items', label: 'Line items' },
            { key: 'invoices', label: 'Invoices count' }, { key: 'clients', label: 'Clients count' },
            { key: 'average_price_minor', label: 'Average price' }, { key: 'taxable_minor', label: 'Taxable value' },
            { key: 'tax_minor', label: 'Tax' }, { key: 'total_minor', label: 'Total sales' },
            { key: 'contribution_pct', label: 'Share' },
          ], data.rows);
        }],
        '/api/reports/revenue-by-client': ['revenue-by-client.csv', async () => {
          const data = await revenueByClient(db, url);
          return toCsv([
            { key: 'client_name', label: 'Client name' }, { key: 'company_name', label: 'Company' },
            { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
            { key: 'gstin', label: 'GSTIN' }, { key: 'invoice_count', label: 'Invoices count' },
            { key: 'first_invoice_date', label: 'First invoice date' }, { key: 'last_invoice_date', label: 'Last invoice date' },
            { key: 'invoiced_minor', label: 'Invoiced value' }, { key: 'collected_minor', label: 'Collected value' },
            { key: 'balance_minor', label: 'Balance due' }, { key: 'overdue_minor', label: 'Overdue balance' },
          ], data.rows);
        }],
        '/api/reports/quotations': ['quotations.csv', async () => {
          const data = await quotationReport(db, url);
          return toCsv([
            { key: 'quotation_number', label: 'Quotation number' }, { key: 'client_name', label: 'Client' },
            { key: 'title', label: 'Title' }, { key: 'issue_date', label: 'Issue date' },
            { key: 'expiry_date', label: 'Expiry date' }, { key: 'effective_status', label: 'Status' },
            { key: 'converted', label: 'Converted to invoice' }, { key: 'grand_total_minor', label: 'Quoted total' },
          ], data.rows);
        }],
      };

      if (path in csvReports && method === 'GET') {
        const [name, build] = csvReports[path];
        if (url.searchParams.get('format') === 'csv') return csvFile(name, await build());
      }

      if (path === '/api/reports/invoices' && method === 'GET') {
        const data = await invoiceRegister(db, url);
        const format = url.searchParams.get('format');
        const options = { from: url.searchParams.get('from'), to: url.searchParams.get('to') };
        if (format === 'pdf') return reportPdfResponse('invoices.pdf', await renderReportPdf('invoices', data, options));
        if (format === 'html') return reportHtmlResponse(renderReportHtml('invoices', data, options));
        return json(data);
      }

      if (path === '/api/reports/collections' && method === 'GET') {
        const data = await collectionReport(db, url);
        const format = url.searchParams.get('format');
        const options = { from: url.searchParams.get('from'), to: url.searchParams.get('to') };
        if (format === 'pdf') return reportPdfResponse('collections.pdf', await renderReportPdf('collections', data, options));
        if (format === 'html') return reportHtmlResponse(renderReportHtml('collections', data, options));
        return json(data);
      }

      if (path === '/api/reports/receivables' && method === 'GET') {
        const data = await receivables(db);
        const format = url.searchParams.get('format');
        if (format === 'pdf') return reportPdfResponse('receivables.pdf', await renderReportPdf('receivables', data));
        if (format === 'html') return reportHtmlResponse(renderReportHtml('receivables', data));
        return json(data);
      }

      if (path === '/api/reports/quotations' && method === 'GET') {
        const data = await quotationReport(db, url);
        const format = url.searchParams.get('format');
        const options = { from: url.searchParams.get('from'), to: url.searchParams.get('to') };
        if (format === 'pdf') return reportPdfResponse('quotations.pdf', await renderReportPdf('quotations', data, options));
        if (format === 'html') return reportHtmlResponse(renderReportHtml('quotations', data, options));
        return json(data);
      }

      if (path === '/api/reports/revenue-by-client' && method === 'GET') {
        const data = await revenueByClient(db, url);
        const format = url.searchParams.get('format');
        const options = { from: url.searchParams.get('from'), to: url.searchParams.get('to') };
        if (format === 'pdf') return reportPdfResponse('clients.pdf', await renderReportPdf('clients', data, options));
        if (format === 'html') return reportHtmlResponse(renderReportHtml('clients', data, options));
        return json(data);
      }

      if (path === '/api/reports/revenue-by-product' && method === 'GET') {
        const data = await revenueByProduct(db, url);
        const format = url.searchParams.get('format');
        const options = { from: url.searchParams.get('from'), to: url.searchParams.get('to') };
        if (format === 'pdf') return reportPdfResponse('products.pdf', await renderReportPdf('products', data, options));
        if (format === 'html') return reportHtmlResponse(renderReportHtml('products', data, options));
        return json(data);
      }

      if (path === '/api/reports/tax-summary' && method === 'GET') {
        const data = await taxSummary(db, url);
        const format = url.searchParams.get('format');
        const options = { from: url.searchParams.get('from'), to: url.searchParams.get('to') };
        if (format === 'pdf') return reportPdfResponse('tax-summary.pdf', await renderReportPdf('tax', data, options));
        if (format === 'html') return reportHtmlResponse(renderReportHtml('tax', data, options));
        return json(data);
      }

      /* ------------------------------------------------ pos customer tracker */

      /*
       * The tracker holds customer and subscription data for the operating
       * roles. A read-only role reaches customer rows only through a share that
       * names it, which is what makes a private share an actual boundary.
       */
      const trackerRead = () => assert(canWrite(actor), 403,
        'Your role can read the customer tracker only through a share.', 'FORBIDDEN');

      if (path === '/api/tracker/reference' && method === 'GET') {
        trackerRead();
        const catalog = await columnCatalog(db);
        return json({
          columns: catalog.columns, custom_fields: catalog.custom_fields,
          field_types: FIELD_TYPES, sensitive_columns: SENSITIVE_COLUMNS, subscription_statuses: SUBSCRIPTION_STATUSES,
          roles: ROLES, can_write: canWrite(actor), can_manage: canManageSettings(actor),
          employees: await listEmployees(db, { includeInactive: true }),
          plans: await listPlans(db, { includeArchived: true }),
          metrics: await trackerMetrics(db),
        });
      }
      if (path === '/api/tracker/metrics' && method === 'GET') {
        trackerRead();
        return json(await trackerMetrics(db));
      }
      if (path === '/api/tracker/customers' && method === 'GET') {
        trackerRead();
        return json(await listCustomers(db, url));
      }
      if (path === '/api/tracker/customers' && method === 'POST') {
        requireWriter(actor);
        const input = await body(request, posCustomerSchema);
        const found = await customerWarnings(db, input);
        return json({ ...(await createCustomer(db, actor, input)), ...found }, 201);
      }
      if (path === '/api/tracker/customers/check-duplicates' && method === 'POST') {
        const input = await body(request, z.object({
          name: z.string().trim().max(160).default(''), business_name: z.string().trim().max(200).default(''),
          phone: z.string().trim().max(24).default(''), email: z.string().trim().max(254).default(''),
          exclude_id: uuid.nullable().default(null),
        }).strict());
        return json(await customerWarnings(db, input));
      }
      const trackerCustomerMatch = path.match(/^\/api\/tracker\/customers\/([^/]+)(?:\/(status|subscriptions|fields))?$/);
      if (trackerCustomerMatch) {
        const id = uuid.parse(trackerCustomerMatch[1]);
        const action = trackerCustomerMatch[2];
        if (!action && method === 'GET') {
          trackerRead();
          return json(await getCustomer(db, id));
        }
        if (!action && method === 'PATCH') {
          requireWriter(actor);
          const input = await body(request, posCustomerSchema.extend({
            expected_updated_at: z.string().datetime({ offset: true }).nullable().default(null),
          }));
          return json(await updateCustomer(db, actor, id, input));
        }
        if (action === 'status' && method === 'POST') {
          requireWriter(actor);
          const input = await body(request, z.object({ status: z.enum(['ACTIVE', 'ARCHIVED']) }).strict());
          return json(await setCustomerStatus(db, actor, id, input.status));
        }
        if (action === 'subscriptions' && method === 'POST') {
          requireWriter(actor);
          const input = await body(request, subscriptionSchema);
          return json({ subscription: await addSubscription(db, actor, id, input) }, 201);
        }
        if (action === 'fields' && method === 'PUT') {
          requireWriter(actor);
          const input = await body(request, customValuesSchema);
          return json({ values: await saveCustomValues(db, actor, id, input) });
        }
      }
      const subscriptionMatch = path.match(/^\/api\/tracker\/subscriptions\/([^/]+)$/);
      if (subscriptionMatch && method === 'PATCH') {
        requireWriter(actor);
        const input = await body(request, subscriptionSchema.omit({ renews: true }));
        return json({ subscription: await updateSubscription(db, actor, uuid.parse(subscriptionMatch[1]), input) });
      }
      if (path === '/api/tracker/columns' && method === 'PUT') {
        requireWriter(actor);
        return json(await saveColumnLayout(db, actor, await body(request, columnOrderSchema)));
      }
      if (path === '/api/tracker/fields' && method === 'GET') {
        trackerRead();
        return json({ fields: await listCustomFields(db, { includeArchived: url.searchParams.get('archived') === '1' }) });
      }
      if (path === '/api/tracker/fields' && method === 'POST') {
        requireWriter(actor);
        return json({ field: await createCustomField(db, actor, await body(request, customFieldSchema)) }, 201);
      }
      const fieldMatch = path.match(/^\/api\/tracker\/fields\/([^/]+)(?:\/(status))?$/);
      if (fieldMatch) {
        const id = uuid.parse(fieldMatch[1]);
        if (!fieldMatch[2] && method === 'PATCH') {
          requireWriter(actor);
          return json({ field: await updateCustomField(db, actor, id, await body(request, customFieldSchema)) });
        }
        if (fieldMatch[2] === 'status' && method === 'POST') {
          requireWriter(actor);
          const input = await body(request, z.object({ status: z.enum(['ACTIVE', 'ARCHIVED']) }).strict());
          return json({ field: await setCustomFieldStatus(db, actor, id, input.status) });
        }
      }
      if (path === '/api/tracker/employees' && method === 'GET') {
        trackerRead();
        return json({ employees: await listEmployees(db, { includeInactive: url.searchParams.get('inactive') === '1' }) });
      }
      if (path === '/api/tracker/employees' && method === 'POST') {
        requireManager(actor);
        return json({ employee: await createEmployee(db, actor, await body(request, employeeSchema)) }, 201);
      }
      const employeeMatch = path.match(/^\/api\/tracker\/employees\/([^/]+)\/status$/);
      if (employeeMatch && method === 'POST') {
        requireManager(actor);
        const input = await body(request, z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }).strict());
        return json({ employee: await setEmployeeStatus(db, actor, uuid.parse(employeeMatch[1]), input.status) });
      }
      if (path === '/api/tracker/plans' && method === 'GET') {
        trackerRead();
        return json({ plans: await listPlans(db, { includeArchived: url.searchParams.get('archived') === '1' }) });
      }
      if (path === '/api/tracker/plans' && method === 'POST') {
        requireManager(actor);
        return json({ plan: await createPlan(db, actor, await body(request, planSchema)) }, 201);
      }
      const planMatch = path.match(/^\/api\/tracker\/plans\/([^/]+)$/);
      if (planMatch && method === 'PATCH') {
        requireManager(actor);
        return json({ plan: await updatePlan(db, actor, uuid.parse(planMatch[1]), await body(request, planSchema)) });
      }

      /* -------------------------------------------------------- tracker files */

      if (path === '/api/tracker/export' && method === 'GET') {
        trackerRead();
        const catalog = await columnCatalog(db);
        const requested = (url.searchParams.get('columns') || '').split(',').map(value => value.trim()).filter(Boolean);
        const columns = resolveColumns(catalog, requested.length ? requested : columnKeys(catalog));
        const ids = (url.searchParams.get('ids') || '').split(',').map(value => value.trim()).filter(Boolean);
        for (const id of ids) uuid.parse(id);
        const { rows, total } = await trackerRowsForExport(db, url, { customerIds: ids.length ? ids : null });
        const format = url.searchParams.get('format') || 'xlsx';
        if (format === 'template') return fileResponse('pos-customers-template.xlsx', await exportTemplate({ columns: catalog.columns }));
        const filters = Object.fromEntries([...url.searchParams].filter(([, value]) => value));
        if (format === 'csv') return csvFile('pos-customers.csv', await exportCsv({ columns, rows }));
        return fileResponse(`pos-customers-${new Date().toISOString().slice(0, 10)}.xlsx`,
          await exportWorkbook({ columns, rows, filters: { ...filters, exported_rows: String(total) } }));
      }
      if (path === '/api/tracker/import/preview' && method === 'POST') {
        trackerRead();
        const input = await body(request, importPreviewSchema, 9000000);
        const parsed = await readSpreadsheet(Buffer.from(input.content_base64, 'base64'), input.filename);
        assert(parsed.headers.length > 0, 400, 'That file has no header row.', 'EMPTY_FILE');
        const catalog = await columnCatalog(db);
        const mapping = autoMap(parsed.headers, catalog.columns);
        return json({ filename: input.filename, headers: parsed.headers,
          sample: parsed.rows.slice(0, 8), row_count: parsed.rows.length, mapping,
          columns: catalog.columns, unmatched: parsed.headers.filter(header => !mapping[header]) });
      }
      if (path === '/api/tracker/import' && method === 'POST') {
        requireWriter(actor);
        const input = await body(request, importApplySchema, 9000000);
        const parsed = await readSpreadsheet(Buffer.from(input.content_base64, 'base64'), input.filename);
        const catalog = await columnCatalog(db);
        const mapping = Object.keys(input.mapping).length ? input.mapping : autoMap(parsed.headers, catalog.columns);
        const mapped = new Set(Object.values(mapping));
        assert(mapped.has('name') || Object.values(mapping).includes('name'), 400,
          'Map at least the Customer Name column before importing.', 'MAPPING_INCOMPLETE');
        const plan = await planImport(db, { headers: parsed.headers, rows: parsed.rows, mapping,
          defaults: { default_product_id: input.default_product_id, default_plan_id: input.default_plan_id } });
        const blocked = input.skip_duplicates ? new Set(plan.duplicates.map(item => item.row)) : new Set();
        const errors = [...plan.errors, ...plan.duplicates.filter(item => blocked.has(item.row))];
        // Valid rows are imported even when other rows failed, and every
        // refused row is reported with its line number and reason.
        const accepted = plan.staged.filter(candidate => !candidate.__invalid && !blocked.has(candidate.__row));
        const created = accepted.length ? await applyImport(db, actor, { filename: input.filename, staged: accepted }) : [];
        return json({
          summary: { filename: input.filename, read: parsed.rows.length, created: created.length,
            skipped: plan.duplicates.filter(item => blocked.has(item.row)).length,
            updated: 0, failed: plan.errors.length },
          errors, duplicates: plan.duplicates,
          errors_csv: buildErrorCsv(errors),
        }, created.length ? 201 : 200);
      }

      /* --------------------------------------------------------- share links */

      if (path === '/api/shares' && method === 'GET') {
        // Share settings name recipients and scopes, so they are owner-only.
        requireManager(actor);
        return json(await listShares(db));
      }
      if (path === '/api/shares' && method === 'POST') {
        requireManager(actor);
        const shareType = url.searchParams.get('type') === 'public' ? 'public' : 'private';
        if (shareType === 'public') {
          return json(await createPublicShare(db, actor, await body(request, publicShareSchema)), 201);
        }
        return json({ share: await createPrivateShare(db, actor, await body(request, privateShareSchema)) }, 201);
      }
      const shareMatch = path.match(/^\/api\/shares\/([^/]+)(?:\/(rows|revoke|export))?$/);
      if (shareMatch) {
        const id = uuid.parse(shareMatch[1]);
        const action = shareMatch[2];
        if (!action && method === 'GET') {
          const { share } = await shareForActor(db, id, actor);
          return json(await (share.owner_id === actor.id ? getShare(db, id) : privateShareData(db, share, url)));
        }
        if (!action && method === 'PATCH') {
          requireManager(actor);
          const { share } = await shareForActor(db, id, actor);
          assert(share.owner_id === actor.id, 403, 'Only the owner can change this share.', 'FORBIDDEN');
          return json({ share: await updateShare(db, actor, id, await body(request, shareUpdateSchema)) });
        }
        if (action === 'revoke' && method === 'POST') {
          requireManager(actor);
          const { share } = await shareForActor(db, id, actor);
          assert(share.owner_id === actor.id, 403, 'Only the owner can revoke this share.', 'FORBIDDEN');
          const input = await body(request, z.object({ reason: z.string().trim().max(300).default('') }).strict());
          return json({ share: await revokeShare(db, actor, id, input.reason) });
        }
        if (action === 'rows' && method === 'GET') {
          const { share } = await shareForActor(db, id, actor);
          return json(await privateShareData(db, share, url));
        }
        // A recipient may download only when the owner granted export permission.
        if (action === 'export' && method === 'GET') {
          const { share } = await shareForActor(db, id, actor);
          assert(share.allow_download, 403, 'The owner did not allow downloads for this share.', 'FORBIDDEN');
          const data = await privateShareData(db, share, url);
          await audit(db, 'SHARE_DOWNLOADED', { actorId: actor.id, entityType: 'SHARE', entityId: id,
            metadata: { format: url.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx', rows: data.total } });
          if (url.searchParams.get('format') === 'csv') {
            return csvFile('pos-customers-shared.csv', await exportCsv({ columns: data.columns, rows: data.rows }));
          }
          return fileResponse('pos-customers-shared.xlsx',
            await exportWorkbook({ columns: data.columns, rows: data.rows, title: share.title }));
        }
      }

      /* ------------------------------------------- marketing & partnerships */

      if (path === '/api/marketing/dashboard' && method === 'GET') {
        requireManager(actor);
        return json(await marketingDashboard(db));
      }

      if (path === '/api/marketing/influencers' && method === 'GET') {
        requireManager(actor);
        return json(await listInfluencers(db, {
          search: url.searchParams.get('search') || '',
          status: url.searchParams.get('status') || '',
          page: url.searchParams.get('page') || 1,
          limit: url.searchParams.get('limit') || 25,
        }));
      }

      if (path === '/api/marketing/influencers/check-duplicates' && method === 'POST') {
        requireManager(actor);
        const input = await body(request, z.object({
          legal_name: z.string().optional(),
          display_name: z.string().optional(),
          instagram_username: z.string().optional(),
          email: z.string().optional(),
          phone: z.string().optional(),
          exclude_id: uuid.nullable().optional().default(null),
        }).strict());
        return json(await checkInfluencerDuplicates(db, input, input.exclude_id));
      }

      if (path === '/api/marketing/influencers' && method === 'POST') {
        requireManager(actor);
        const input = await body(request, influencerSchema);
        const result = await createInfluencer(db, actor, input);
        return json(result, 201);
      }

      const influencerMatch = path.match(/^\/api\/marketing\/influencers\/([0-9a-fA-F-]+)$/);
      if (influencerMatch) {
        requireManager(actor);
        const id = uuid.parse(influencerMatch[1]);
        if (method === 'GET') {
          return json({ influencer: await getInfluencer(db, id) });
        }
        if (method === 'PATCH') {
          const input = await body(request, influencerSchema.partial());
          return json(await updateInfluencer(db, actor, id, input));
        }
        if (method === 'DELETE') {
          return json(await deleteInfluencer(db, actor, id));
        }
      }

      if (path === '/api/marketing/agreements' && method === 'GET') {
        requireManager(actor);
        return json(await listAgreements(db, {
          influencerId: url.searchParams.get('influencer_id') || null,
          status: url.searchParams.get('status') || '',
          search: url.searchParams.get('search') || '',
          page: url.searchParams.get('page') || 1,
          limit: url.searchParams.get('limit') || 25,
        }));
      }

      if (path === '/api/marketing/agreements' && method === 'POST') {
        requireManager(actor);
        const input = await body(request, agreementDraftSchema);
        return json({ agreement: await createAgreement(db, actor, input) }, 201);
      }

      const agreementMatch = path.match(/^\/api\/marketing\/agreements\/([0-9a-fA-F-]+)(?:\/([a-z-]+))?$/);
      if (agreementMatch) {
        requireManager(actor);
        const id = uuid.parse(agreementMatch[1]);
        const action = agreementMatch[2];

        if (!action && method === 'GET') {
          return json({ agreement: await getAgreement(db, id) });
        }
        if (!action && method === 'PATCH') {
          const input = await body(request, agreementUpdateSchema);
          return json({ agreement: await updateAgreementDraft(db, actor, id, input) });
        }
        if (!action && method === 'DELETE') {
          return json(await deleteDraftAgreement(db, actor, id));
        }
        if (action === 'archive' && method === 'POST') {
          return json({ agreement: await transitionAgreementStatus(db, actor, id, { action: 'ARCHIVE', reason: 'Archived by administrator' }) });
        }
        if (action === 'status' && method === 'POST') {
          const input = await body(request, agreementStatusActionSchema);
          return json({ agreement: await transitionAgreementStatus(db, actor, id, input) });
        }
        if (action === 'duplicate' && method === 'POST') {
          return json({ agreement: await duplicateAgreement(db, actor, id) }, 201);
        }
        if (action === 'preview' && method === 'GET') {
          return json({ snapshot: await buildContractSnapshot(db, id) });
        }
        if (action === 'generate-pdf' && method === 'POST') {
          const snapshot = await buildContractSnapshot(db, id);
          await recordPdfGenerated(db, actor, id, snapshot);
          const [companyLogo, productLogo] = await Promise.all([
            brandLogoBytes(db, 'company_logo').catch(() => null),
            brandLogoBytes(db, 'product_logo').catch(() => null),
          ]);
          const bytes = await renderContractPdf(snapshot, { companyLogo, productLogo });
          return json({
            success: true,
            contract_number: snapshot.contract_number,
            pdf_generated_at: snapshot.pdf_generated_at,
            bytes_length: bytes.length,
          });
        }
        if (action === 'pdf' && method === 'GET') {
          const agreement = await getAgreement(db, id);
          const snapshot = agreement.snapshot
            ? (typeof agreement.snapshot === 'string' ? JSON.parse(agreement.snapshot) : agreement.snapshot)
            : await buildContractSnapshot(db, id);

          const [companyLogo, productLogo] = await Promise.all([
            brandLogoBytes(db, 'company_logo').catch(() => null),
            brandLogoBytes(db, 'product_logo').catch(() => null),
          ]);
          const bytes = await renderContractPdf(snapshot, { companyLogo, productLogo });
          const safeContractNum = (agreement.contract_number || 'contract').replace(/[^A-Za-z0-9_-]/g, '_');
          const isView = url.searchParams.get('view') === 'true';

          await audit(db, 'AGREEMENT_PDF_DOWNLOADED', {
            actorId: actor.id, entityType: 'AGREEMENT', entityId: id,
            metadata: { contract_number: agreement.contract_number, is_view: isView }
          });

          return new Response(bytes, {
            status: 200,
            headers: {
              ...baseHeaders,
              'Content-Type': 'application/pdf',
              'Content-Disposition': `${isView ? 'inline' : 'attachment'}; filename="${safeContractNum}_Influencer_Agreement.pdf"`,
            },
          });
        }
      }

      /* ------------------------------------------- unified contracts list */
      if (path === '/api/marketing/contracts' && method === 'GET') {
        requireManager(actor);
        const search = url.searchParams.get('search') || '';
        const status = url.searchParams.get('status') || '';
        const type = url.searchParams.get('contract_type') || '';
        const page = Number(url.searchParams.get('page') || 1);
        const limit = Number(url.searchParams.get('limit') || 25);

        let infAgreements = [];
        let swAgreements = [];

        if (!type || type === 'INFLUENCER') {
          const infRes = await listAgreements(db, { search, status, page: 1, limit: 1000 });
          infAgreements = (infRes.agreements || []).map(a => ({
            ...a,
            contract_type: 'INFLUENCER',
            contract_type_label: 'Influencer Marketing Agreement',
            counterparty_name: a.influencer_legal_name || a.influencer_display_name,
            secondary_info: `@${a.influencer_instagram_username || ''}`,
            commercial_summary: `${(a.commission_basis_points / 100).toFixed(2)}% Rev Share`,
          }));
        }

        if (!type || type === 'SOFTWARE_SERVICES') {
          const swRes = await listSoftwareAgreements(db, { search, status, page: 1, limit: 1000 });
          swAgreements = (swRes.agreements || []).map(a => ({
            ...a,
            contract_type: 'SOFTWARE_SERVICES',
            contract_type_label: 'Software Development Services Agreement',
            counterparty_name: a.client_name,
            secondary_info: a.service_category,
            commercial_summary: `₹${((a.final_amount_minor || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          }));
        }

        const combined = [...infAgreements, ...swAgreements].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const total = combined.length;
        const offset = (page - 1) * limit;
        const pageRows = combined.slice(offset, offset + limit);

        return json({ contracts: pageRows, total, page, limit });
      }

      /* ------------------------------------------- software development agreements */
      if (path === '/api/marketing/software-agreements' && method === 'GET') {
        requireManager(actor);
        return json(await listSoftwareAgreements(db, {
          clientId: url.searchParams.get('client_id') || null,
          status: url.searchParams.get('status') || '',
          search: url.searchParams.get('search') || '',
          page: url.searchParams.get('page') || 1,
          limit: url.searchParams.get('limit') || 25,
        }));
      }

      if (path === '/api/marketing/software-agreements' && method === 'POST') {
        requireManager(actor);
        const input = await body(request, softwareAgreementCreateSchema);
        return json({ agreement: await createSoftwareAgreement(db, actor, input) }, 201);
      }

      if (path === '/api/marketing/software-agreements/calculate' && method === 'POST') {
        requireManager(actor);
        const input = await body(request, z.object({
          base_price_minor: z.number().default(0),
          pricing_mode: z.enum(['EXCLUSIVE', 'INCLUSIVE']).default('EXCLUSIVE'),
          gst_rate_bp: z.number().default(1800),
          gst_treatment: z.string().default('TAXABLE'),
          discount_minor: z.number().default(0),
          additional_charges_minor: z.number().default(0),
          client_state_code: z.string().default('36'),
          advance_percentage_bp: z.number().default(1000),
          payment_milestones: z.array(z.any()).default([]),
        }));
        const { rows: settingsRows } = await db.query('SELECT * FROM inv.business_settings WHERE id = true');
        const business = settingsRows[0] || {};
        return json({
          financials: calculateSoftwareContractFinancials({
            ...input,
            supplier_state_code: business.state_code || '36',
          }),
        });
      }

      const swAgreementMatch = path.match(/^\/api\/marketing\/software-agreements\/([0-9a-fA-F-]+)(?:\/([a-z-]+))?$/);
      if (swAgreementMatch) {
        requireManager(actor);
        const id = uuid.parse(swAgreementMatch[1]);
        const action = swAgreementMatch[2];

        if (!action && method === 'GET') {
          return json({ agreement: await getSoftwareAgreement(db, id) });
        }
        if (!action && method === 'PATCH') {
          const input = await body(request, softwareAgreementUpdateSchema);
          return json({ agreement: await updateSoftwareAgreementDraft(db, actor, id, input) });
        }
        if (!action && method === 'DELETE') {
          return json(await deleteDraftSoftwareAgreement(db, actor, id));
        }
        if (action === 'archive' && method === 'POST') {
          return json({ agreement: await transitionSoftwareAgreementStatus(db, actor, id, { action: 'ARCHIVE', reason: 'Archived by administrator' }) });
        }
        if (action === 'status' && method === 'POST') {
          const input = await body(request, softwareAgreementStatusActionSchema);
          return json({ agreement: await transitionSoftwareAgreementStatus(db, actor, id, input) });
        }
        if (action === 'duplicate' && method === 'POST') {
          return json({ agreement: await duplicateSoftwareAgreement(db, actor, id) }, 201);
        }
        if (action === 'preview' && method === 'GET') {
          const snapshot = await buildSoftwareContractSnapshot(db, id);
          const companyLogo = await brandLogoBytes(db, 'company_logo').catch(() => null);
          const logoDataUri = companyLogo?.bytes ? `data:${companyLogo.mimeType || 'image/png'};base64,${Buffer.from(companyLogo.bytes).toString('base64')}` : '';
          const html = renderSoftwareContractHtml(snapshot, { logoDataUri, standalone: false });
          return json({ snapshot, html, logoDataUri });
        }
        if (action === 'html' && method === 'GET') {
          const agreement = await getSoftwareAgreement(db, id);
          const snapshot = (agreement.status === 'DRAFT' || !agreement.snapshot)
            ? await buildSoftwareContractSnapshot(db, id)
            : (typeof agreement.snapshot === 'string' ? JSON.parse(agreement.snapshot) : agreement.snapshot);
          const companyLogo = await brandLogoBytes(db, 'company_logo').catch(() => null);
          const logoDataUri = companyLogo?.bytes ? `data:${companyLogo.mimeType || 'image/png'};base64,${Buffer.from(companyLogo.bytes).toString('base64')}` : '';
          const html = renderSoftwareContractHtml(snapshot, { logoDataUri, standalone: true });
          const safeContractNum = (agreement.contract_number || 'contract').replace(/[^A-Za-z0-9_-]/g, '_');
          return new Response(html, {
            status: 200,
            headers: {
              ...baseHeaders,
              'Content-Type': 'text/html; charset=utf-8',
              'Content-Disposition': `inline; filename="${safeContractNum}_Software_Development_Agreement.html"`,
            },
          });
        }
        if (action === 'generate-pdf' && method === 'POST') {
          const snapshot = await buildSoftwareContractSnapshot(db, id);
          await recordSoftwarePdfGenerated(db, actor, id, snapshot);
          const [companyLogo, productLogo] = await Promise.all([
            brandLogoBytes(db, 'company_logo').catch(() => null),
            brandLogoBytes(db, 'product_logo').catch(() => null),
          ]);
          const bytes = await renderSoftwareContractPdf(snapshot, { companyLogo, productLogo });
          return json({
            success: true,
            contract_number: snapshot.contract_number,
            pdf_generated_at: snapshot.pdf_generated_at,
            bytes_length: bytes.length,
          });
        }
        if (action === 'pdf' && method === 'GET') {
          const agreement = await getSoftwareAgreement(db, id);
          const snapshot = (agreement.status === 'DRAFT' || !agreement.snapshot)
            ? await buildSoftwareContractSnapshot(db, id)
            : (typeof agreement.snapshot === 'string' ? JSON.parse(agreement.snapshot) : agreement.snapshot);

          const [companyLogo, productLogo] = await Promise.all([
            brandLogoBytes(db, 'company_logo').catch(() => null),
            brandLogoBytes(db, 'product_logo').catch(() => null),
          ]);
          const bytes = await renderSoftwareContractPdf(snapshot, { companyLogo, productLogo });
          const safeContractNum = (agreement.contract_number || 'contract').replace(/[^A-Za-z0-9_-]/g, '_');
          const isView = url.searchParams.get('view') === 'true';

          await audit(db, 'SOFTWARE_AGREEMENT_PDF_DOWNLOADED', {
            actorId: actor.id, entityType: 'SOFTWARE_AGREEMENT', entityId: id,
            metadata: { contract_number: agreement.contract_number, is_view: isView }
          });

          return new Response(bytes, {
            status: 200,
            headers: {
              ...baseHeaders,
              'Content-Type': 'application/pdf',
              'Content-Disposition': `${isView ? 'inline' : 'attachment'}; filename="${safeContractNum}_Software_Development_Agreement.pdf"`,
            },
          });
        }
      }

      /* ------------------------------------------- marketing sales tracking & import */
      if (path === '/api/marketing/sales/template' && method === 'GET') {
        requireManager(actor);
        return fileResponse('nextora_influencer_sales_template.xlsx', await generateSalesTemplate());
      }

      if (path === '/api/marketing/sales/preview-import' && method === 'POST') {
        requireManager(actor);
        const input = await body(request, importPreviewSchema, 10000000);
        const buffer = Buffer.from(input.content_base64, 'base64');
        return json(await parseAndValidateSalesFile(db, buffer, input.filename));
      }

      if (path === '/api/marketing/sales/confirm-import' && method === 'POST') {
        requireManager(actor);
        const input = await body(request, salesImportApplySchema, 10000000);
        return json(await confirmSalesImport(db, actor, input));
      }

      if (path === '/api/marketing/sales/batches' && method === 'GET') {
        requireManager(actor);
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
        return json(await listSalesBatches(db, { page }));
      }

      if (path === '/api/marketing/sales/dashboard' && method === 'GET') {
        requireManager(actor);
        const fromDate = url.searchParams.get('fromDate') || '';
        const toDate = url.searchParams.get('toDate') || '';
        const productId = url.searchParams.get('productId') || '';
        const influencerId = url.searchParams.get('influencerId') || '';
        return json(await getSalesDashboardMetrics(db, { fromDate, toDate, productId, influencerId }));
      }

      if (path === '/api/marketing/sales' && method === 'GET') {
        requireManager(actor);
        const influencerId = url.searchParams.get('influencerId') || null;
        const search = url.searchParams.get('search') || '';
        const fromDate = url.searchParams.get('fromDate') || '';
        const toDate = url.searchParams.get('toDate') || '';
        const productId = url.searchParams.get('productId') || '';
        const status = url.searchParams.get('status') || '';
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
        const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '25', 10)));
        const sort = url.searchParams.get('sort') || 'purchased_date_desc';
        return json(await listSalesRecords(db, { influencerId, search, fromDate, toDate, productId, status, page, limit, sort }));
      }

      if (path === '/api/marketing/sales/export.xlsx' && method === 'GET') {
        requireManager(actor);
        const influencerId = url.searchParams.get('influencerId') || null;
        const search = url.searchParams.get('search') || '';
        const fromDate = url.searchParams.get('fromDate') || '';
        const toDate = url.searchParams.get('toDate') || '';
        const productId = url.searchParams.get('productId') || '';
        const status = url.searchParams.get('status') || '';
        const { records } = await listSalesRecords(db, { influencerId, search, fromDate, toDate, productId, status, page: 1, limit: 10000 });
        const buf = await exportSalesToExcel({
          records,
          filters: { search, fromDate, toDate, productId, status }
        });
        const monthStr = new Date().toISOString().slice(0, 7);
        await audit(db, 'SALES_EXCEL_EXPORTED', {
          actorId: actor.id, entityType: 'SALES_EXPORT',
          metadata: { record_count: records.length, filters: { influencerId, search, fromDate, toDate, productId, status } }
        });
        return fileResponse(`nextora_influencer_sales_${monthStr}.xlsx`, buf);
      }

      if (path === '/api/marketing/sales/bulk-status' && method === 'POST') {
        requireManager(actor);
        const input = await body(request, bulkSaleStatusUpdateSchema);
        return json(await bulkUpdateSalesStatus(db, actor, input));
      }

      const saleStatusMatch = path.match(/^\/api\/marketing\/sales\/([0-9a-fA-F-]+)\/status$/);
      if (saleStatusMatch && method === 'POST') {
        requireManager(actor);
        const id = uuid.parse(saleStatusMatch[1]);
        const input = await body(request, saleStatusUpdateSchema);
        return json(await updateSaleRecordStatus(db, actor, id, input));
      }

      if (path === '/api/marketing/sales/consolidated-report.pdf' && method === 'GET') {
        requireManager(actor);
        const fromDate = url.searchParams.get('fromDate') || '';
        const toDate = url.searchParams.get('toDate') || '';
        const productId = url.searchParams.get('productId') || '';
        const data = await getSalesDashboardMetrics(db, { fromDate, toDate, productId });
        const [companyLogo, productLogo] = await Promise.all([
          brandLogoBytes(db, 'company_logo').catch(() => null),
          brandLogoBytes(db, 'product_logo').catch(() => null),
        ]);
        const bytes = await renderConsolidatedSalesReportPdf(data, { companyLogo, productLogo });
        const monthStr = new Date().toISOString().slice(0, 7);
        const isView = url.searchParams.get('view') === 'true';

        await audit(db, 'CONSOLIDATED_SALES_REPORT_DOWNLOADED', {
          actorId: actor.id, entityType: 'SALES_REPORT',
          metadata: { fromDate, toDate, productId, is_view: isView }
        });

        return new Response(bytes, {
          status: 200,
          headers: {
            ...baseHeaders,
            'Content-Type': 'application/pdf',
            'Content-Disposition': `${isView ? 'inline' : 'attachment'}; filename="nextora_all_influencers_${monthStr}.pdf"`,
          },
        });
      }

      const influencerSalesMatch = path.match(/^\/api\/marketing\/influencers\/([0-9a-fA-F-]+)\/sales(?:\/(export\.xlsx|report\.pdf))?$/);
      if (influencerSalesMatch) {
        requireManager(actor);
        const infId = uuid.parse(influencerSalesMatch[1]);
        const action = influencerSalesMatch[2];
        const influencer = await getInfluencer(db, infId);

        if (!action && method === 'GET') {
          const search = url.searchParams.get('search') || '';
          const fromDate = url.searchParams.get('fromDate') || '';
          const toDate = url.searchParams.get('toDate') || '';
          const productId = url.searchParams.get('productId') || '';
          const status = url.searchParams.get('status') || '';
          const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
          const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '25', 10)));
          const sort = url.searchParams.get('sort') || 'purchased_date_desc';
          const salesData = await listSalesRecords(db, { influencerId: infId, search, fromDate, toDate, productId, status, page, limit, sort });
          return json({ influencer, ...salesData });
        }

        if (action === 'export.xlsx' && method === 'GET') {
          const search = url.searchParams.get('search') || '';
          const fromDate = url.searchParams.get('fromDate') || '';
          const toDate = url.searchParams.get('toDate') || '';
          const productId = url.searchParams.get('productId') || '';
          const status = url.searchParams.get('status') || '';
          const { records } = await listSalesRecords(db, { influencerId: infId, search, fromDate, toDate, productId, status, page: 1, limit: 10000 });
          const buf = await exportSalesToExcel({
            records,
            influencer,
            filters: { search, fromDate, toDate, productId, status }
          });
          const safeName = (influencer.display_name || 'influencer').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
          const monthStr = new Date().toISOString().slice(0, 7);

          await audit(db, 'INFLUENCER_SALES_EXCEL_EXPORTED', {
            actorId: actor.id, entityType: 'SALES_EXPORT', entityId: infId,
            metadata: { influencer_id: infId, record_count: records.length }
          });

          return fileResponse(`nextora_influencer_sales_${safeName}_${monthStr}.xlsx`, buf);
        }

        if (action === 'report.pdf' && method === 'GET') {
          const fromDate = url.searchParams.get('fromDate') || '';
          const toDate = url.searchParams.get('toDate') || '';
          const productId = url.searchParams.get('productId') || '';
          const { records } = await listSalesRecords(db, { influencerId: infId, fromDate, toDate, productId, page: 1, limit: 10000 });

          const { rows: agRows } = await db.query(
            `SELECT * FROM inv.influencer_agreements WHERE influencer_id = $1 AND status = 'ACTIVE' LIMIT 1`,
            [infId]
          );
          const agreement = agRows[0] || null;

          const totalSales = records.length;
          const verifiedRev = records.reduce((sum, r) => sum + (r.is_revenue_verified ? (r.eligible_revenue_minor || 0) : 0), 0);
          const calcComm = records.reduce((sum, r) => sum + (r.is_revenue_verified ? (r.calculated_commission_minor || 0) : 0), 0);
          const pendingComm = records.reduce((sum, r) => sum + (['PENDING', 'VERIFIED'].includes(r.commission_status) ? (r.calculated_commission_minor || 0) : 0), 0);
          const approvedComm = records.reduce((sum, r) => sum + (r.commission_status === 'APPROVED' ? (r.calculated_commission_minor || 0) : 0), 0);
          const paidComm = records.reduce((sum, r) => sum + (r.commission_status === 'PAID' ? (r.calculated_commission_minor || 0) : 0), 0);

          const reportData = {
            report_number: `REP-${infId.slice(0, 8).toUpperCase()}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
            influencer,
            agreement,
            period_label: fromDate && toDate ? `${fromDate} to ${toDate}` : 'All Attributed Sales',
            summary: {
              total_sales: totalSales,
              verified_revenue_minor: verifiedRev,
              calculated_commission_minor: calcComm,
              pending_commission_minor: pendingComm,
              approved_commission_minor: approvedComm,
              paid_commission_minor: paidComm,
            },
            records,
          };

          const [companyLogo, productLogo] = await Promise.all([
            brandLogoBytes(db, 'company_logo').catch(() => null),
            brandLogoBytes(db, 'product_logo').catch(() => null),
          ]);

          const bytes = await renderInfluencerSalesReportPdf(reportData, { companyLogo, productLogo });
          const safeName = (influencer.display_name || 'influencer').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
          const monthStr = new Date().toISOString().slice(0, 7);
          const isView = url.searchParams.get('view') === 'true';

          await audit(db, 'INFLUENCER_SALES_REPORT_DOWNLOADED', {
            actorId: actor.id, entityType: 'SALES_REPORT', entityId: infId,
            metadata: { influencer_id: infId, record_count: records.length, is_view: isView }
          });

          return new Response(bytes, {
            status: 200,
            headers: {
              ...baseHeaders,
              'Content-Type': 'application/pdf',
              'Content-Disposition': `${isView ? 'inline' : 'attachment'}; filename="nextora_influencer_report_${safeName}_${monthStr}.pdf"`,
            },
          });
        }
      }

      throw new HttpError(404, 'Endpoint not found.', 'NOT_FOUND');
    } catch (error) {
      if (error instanceof ZodError) {
        return json({ error: 'Please check the form values.', code: 'VALIDATION_ERROR',
          fields: error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })) }, 400);
      }
      if (error instanceof HttpError) {
        return json({ error: error.message, code: error.code }, error.status,
          error.status === 429 ? { 'Retry-After': '900' } : {});
      }
      if (error?.code === '23505') return json({ error: 'This record already exists. Refresh and try again.', code: 'DUPLICATE' }, 409);
      if (error?.code === '23503') return json({ error: 'This record is still referenced and cannot be removed.', code: 'IN_USE' }, 409);
      if (error?.code === 'P0001' || /Immutable/i.test(error?.message || '')) {
        return json({ error: 'This document is part of the financial record and cannot be changed.', code: 'IMMUTABLE' }, 409);
      }
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        return json({
          error: 'Filesystem write permission denied. The application attempted to write to a protected directory. Please verify export folder permissions or choose a writable path.',
          code: 'STORAGE_PERMISSION_DENIED',
        }, 403);
      }
      // Never log request bodies, credentials, connection strings or document contents.
      console.error('Invoicing API failure', config.production
        ? { type: error?.name, code: error?.code || 'INTERNAL' }
        : { type: error?.name, code: error?.code || 'INTERNAL', message: error?.message });
      return json({ error: 'The invoicing service is temporarily unavailable. Please try again later.', code: 'UNAVAILABLE' }, 503);
    }
  };

  async function pdfResponse(database, snapshot, { filename, view, preview }) {
    const logo = await logoBytes(database).catch(() => null);
    const bytes = await renderDocument(snapshot, { logoPng: logo, preview });
    return new Response(bytes, {
      headers: { ...baseHeaders, 'Content-Type': 'application/pdf',
        'Content-Disposition': `${view ? 'inline' : 'attachment'}; filename="${safeName(filename)}"` },
    });
  }

  /** Conversion is guarded inside a transaction so repeated clicks cannot duplicate an invoice. */
  async function convertQuotation(database, actor, id, input) {
    return database.transaction(async tx => {
      const quotation = (await tx.query('SELECT * FROM inv.quotations WHERE id=$1 FOR UPDATE', [id])).rows[0];
      assert(quotation, 404, 'That quotation does not exist.', 'NOT_FOUND');
      assert(quotation.status === 'ACCEPTED', 409,
        'Record the client acceptance before converting this quotation.', 'NOT_ACCEPTED');
      assert(!quotation.converted_invoice_id, 409, 'This quotation has already been converted to an invoice.', 'ALREADY_CONVERTED');
      const items = (await tx.query('SELECT * FROM inv.quotation_items WHERE quotation_id=$1 ORDER BY position', [id])).rows;
      assert(items.length > 0, 400, 'This quotation has no line items.', 'EMPTY_DOCUMENT');
      const business = await settings(tx);
      const dueDate = input.due_date || addDays(input.issue_date, quotation.payment_terms_days);
      const taxMode = quotation.tax_mode || 'EXCLUSIVE';
      const lines = input.items || items.map(item => ({
        product_id: item.product_id, description: item.description, category: item.category, hsn_sac: item.hsn_sac,
        unit: item.unit, quantity_milli: item.quantity_milli, unit_price_minor: item.unit_price_minor,
        discount_bp: item.discount_bp, discount_minor: item.discount_minor, tax_rate_bp: item.tax_rate_bp,
        tax_treatment: item.tax_treatment, tax_mode: item.tax_mode || taxMode,
      }));
      const invoiceId = randomUUID();
      const computed = computeDocument({
        items: lines,
        additional_charges: input.items ? [] : quotation.additional_charges,
        invoice_discount_bp: input.items ? 0 : quotation.invoice_discount_bp,
        invoice_discount_minor: input.items ? 0 : quotation.invoice_discount_minor,
        supply_type: quotation.supply_type,
        round_off_enabled: quotation.round_off_enabled,
        tax_mode: taxMode,
      });
      const totals = { ...computed.totals, amount_in_words: amountInWords(computed.totals.grand_total_minor) };
      await tx.query(`INSERT INTO inv.invoices(id,client_id,quotation_id,status,title,description,scope_of_work,inclusions,
          exclusions,assumptions,warranty_terms,delivery_timeline,notes,terms,issue_date,due_date,
          place_of_supply_state_code,supply_type,payment_terms_days,payment_terms,project_reference,
          invoice_discount_bp,invoice_discount_minor,round_off_enabled,tax_mode,additional_charges,totals,created_by)
        VALUES($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
      [invoiceId, quotation.client_id, id, quotation.title, quotation.description, quotation.scope_of_work,
        quotation.inclusions, quotation.exclusions, quotation.assumptions, quotation.warranty_terms,
        quotation.delivery_timeline, quotation.notes, quotation.terms, input.issue_date, dueDate,
        quotation.place_of_supply_state_code, quotation.supply_type, quotation.payment_terms_days,
        quotation.payment_terms, quotation.quotation_number, quotation.invoice_discount_bp,
        quotation.invoice_discount_minor, quotation.round_off_enabled, taxMode,
        JSON.stringify(input.items ? [] : quotation.additional_charges), JSON.stringify(totals), actor.id]);
      for (const [index, line] of computed.lines.entries()) {
        await tx.query(`INSERT INTO inv.invoice_items(id,invoice_id,position,product_id,description,category,hsn_sac,unit,
            quantity_milli,unit_price_minor,discount_bp,discount_minor,tax_rate_bp,tax_treatment,gross_minor,
            item_discount_minor,invoice_discount_minor,taxable_minor,cgst_minor,sgst_minor,igst_minor,tax_minor,total_minor,tax_mode)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
        [randomUUID(), invoiceId, index, line.product_id, line.description, line.category, line.hsn_sac, line.unit,
          line.quantity_milli, line.unit_price_minor, line.discount_bp, line.discount_minor, line.tax_rate_bp,
          line.tax_treatment, line.gross_minor, line.item_discount_minor, line.invoice_discount_minor,
          line.taxable_minor, line.cgst_minor, line.sgst_minor, line.igst_minor, line.tax_minor, line.total_minor,
          line.tax_mode || taxMode]);
      }
      const claimed = await tx.query(
        'UPDATE inv.quotations SET converted_invoice_id=$2, updated_at=now() WHERE id=$1 AND converted_invoice_id IS NULL RETURNING id',
        [id, invoiceId]);
      assert(claimed.rowCount === 1, 409, 'This quotation has already been converted to an invoice.', 'ALREADY_CONVERTED');
      await tx.query(`INSERT INTO inv.document_status_history(id,document_type,document_id,from_status,to_status,note,actor_id)
        VALUES($1,'QUOTATION',$2,'ACCEPTED','ACCEPTED',$3,$4)`,
      [randomUUID(), id, `Converted to invoice draft ${invoiceId}`, actor.id]);
      await audit(tx, 'QUOTATION_CONVERTED', { actorId: actor.id, entityType: 'QUOTATION', entityId: id,
        metadata: { invoice_id: invoiceId, grand_total_minor: totals.grand_total_minor } });
      return getInvoice(tx, invoiceId);
    });
  }
}

const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + Number(days || 0));
  return value.toISOString().slice(0, 10);
};
const safeName = value => String(value || '').replace(/[^A-Za-z0-9._/-]/g, '-').replace(/\//g, '-');
