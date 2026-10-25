/**
 * End-to-end smoke test for the desktop application.
 *
 * Runs the real Electron main process (the same module the installer launches)
 * against a throwaway user-data directory, then drives the renderer the way a
 * user would: first-run setup, then the POS customer tracker.
 *
 * It exercises the packaged code path - app:// assets with the production
 * Content-Security-Policy - by presenting the app as packaged, so no installer
 * build is needed. Pass --dev to test the Vite dev-server path instead (start
 * `npm run dev:web` in another terminal first).
 *
 *   npm run build && npm run smoke:desktop
 *
 * Nothing in the developer's real database or %APPDATA% directory is touched.
 * The report is written to tmp/desktop-smoke-result.json as well as stdout,
 * because app.exit() can truncate piped output.
 */
import { app, BrowserWindow } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const devPath = process.argv.includes('--dev');
const userDataDir = mkdtempSync(join(tmpdir(), 'nextora-smoke-'));
app.setPath('userData', userDataDir);

let productionPath = false;
if (!devPath) {
  try {
    Object.defineProperty(app, 'isPackaged', { get: () => true, configurable: true });
    productionPath = app.isPackaged === true;
  } catch {
    productionPath = false;
  }
}

const resultPath = (process.argv.find(argument => argument.startsWith('--result=')) || '').slice(9)
  || join('tmp', 'desktop-smoke-result.json');

const steps = [];
const problems = [];
const consoleLog = [];
const step = (name, detail) => {
  steps.push(detail === undefined ? { name } : { name, detail });
  console.log(`  - ${name}${detail === undefined ? '' : `: ${detail}`}`);
};

let finished = false;
async function finish(code) {
  if (finished) return;
  finished = true;
  const report = JSON.stringify({
    mode: productionPath ? 'packaged (app:// + CSP)' : 'development (vite dev server)',
    userDataDir,
    steps,
    problems,
    consoleLog,
  }, null, 2);
  try {
    await writeFile(resultPath, report);
  } catch {
    // The console output below still carries the report.
  }
  console.log(`SMOKE_RESULT ${report}`);
  console.log(code === 0 ? 'SMOKE_OK' : 'SMOKE_FAILED');
  app.exit(code);
}

// A main-process exception would otherwise raise a blocking error dialog.
process.on('uncaughtException', error => {
  problems.push(`main process exception: ${error?.stack || error}`);
  finish(1);
});
process.on('unhandledRejection', error => {
  problems.push(`main process rejection: ${error?.stack || error}`);
  finish(1);
});
process.on('exit', () => {
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});
setTimeout(() => {
  problems.push('the smoke test did not finish within 90 seconds');
  finish(1);
}, 90000).unref();

console.log(`smoke: starting (${devPath ? 'development' : 'packaged'} path)`);

function classifyConsole(...args) {
  const first = args[0];
  const structured = typeof first === 'object' && first !== null && 'level' in first;
  const level = structured ? first.level : args[1];
  const message = structured ? first.message : args[2];
  return { level: String(level), message: String(message) };
}

// Attached before the application module loads so nothing is missed.
app.on('ready', () => console.log('smoke: ready event fired'));

app.on('browser-window-created', (_event, win) => {
  console.log('smoke: window created');
  win.webContents.on('console-message', (...args) => {
    const { level, message } = classifyConsole(...args);
    consoleLog.push(`${level}: ${message}`);
    if (['error', '3'].includes(level)) problems.push(`console: ${message}`);
  });
  win.webContents.on('preload-error', (_event, path, error) => {
    problems.push(`preload error in ${path}: ${error?.message || error}`);
  });
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    problems.push(`did-fail-load ${code} ${description} ${url}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    problems.push(`renderer gone: ${details.reason}`);
  });
});

/**
 * executeJavaScript never settles when the renderer is wedged, so every call is
 * raced against a deadline. A hang becomes a diagnosable failure instead.
 */
async function evaluate(win, expression, timeoutMs = 10000) {
  let timer;
  const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(undefined), timeoutMs); });
  try {
    return await Promise.race([win.webContents.executeJavaScript(expression), deadline]);
  } catch (error) {
    return { evalError: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(win, expression, label, timeoutMs = 40000) {
  const started = Date.now();
  for (;;) {
    const value = await evaluate(win, expression);
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await delay(150);
  }
}

async function firstWindow() {
  const started = Date.now();
  for (;;) {
    const [win] = BrowserWindow.getAllWindows();
    if (win) return win;
    if (Date.now() - started > 40000) {
      throw new Error('No application window appeared. The main process failed to start the interface.');
    }
    await delay(150);
  }
}

async function waitForLoad(win) {
  const started = Date.now();
  for (;;) {
    if (!win.webContents.isLoading()) return;
    if (Date.now() - started > 40000) {
      throw new Error(`The renderer never finished loading (url: ${win.webContents.getURL() || 'none'}).`);
    }
    await delay(150);
  }
}

async function run() {
  console.log(`smoke: application ready (isReady=${app.isReady()}), waiting for a window`);
  await app.whenReady();
  const win = await firstWindow();
  await waitForLoad(win);
  step('renderer loaded', win.webContents.getURL());

  if (productionPath) {
    const csp = await evaluate(win,
      "fetch('app://nextora/index.html').then(r => r.headers.get('content-security-policy') || '')", 10000);
    if (typeof csp === 'string' && csp.includes("default-src 'self'")) step('content security policy', "default-src 'self'");
    else problems.push(`The production Content-Security-Policy could not be verified: ${JSON.stringify(csp)}`);
  }

  const heading = await waitFor(win, "document.querySelector('h1')?.textContent?.trim() || ''", 'the first-run screen');
  step('first screen', heading);
  if (!/set up/i.test(heading)) problems.push(`Expected the first-run setup screen, saw "${heading}".`);

  const submitted = await evaluate(win, `(() => {
    const form = document.querySelector('#login-form');
    if (!form) return 'no-setup-form';
    const set = (name, value) => {
      const node = form.querySelector('[name="' + name + '"]');
      if (!node) throw new Error('Missing field ' + name);
      node.value = value;
    };
    set('display_name', 'Smoke Owner');
    set('email', 'smoke@example.test');
    set('password', 'smoke-owner-password');
    set('business_name', 'Nextora Creations');
    set('state_code', '36');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    return 'submitted';
  })()`);
  step('first-run setup submitted', submitted);
  if (submitted !== 'submitted') problems.push(`The setup form could not be submitted: ${JSON.stringify(submitted)}`);

  const outcome = await waitFor(win, `(() => {
    if (location.hash.startsWith('#/dashboard') && document.querySelector('#app').textContent.includes('smoke@example.test')) return 'dashboard';
    const banner = document.querySelector('#login-error');
    if (banner && !banner.classList.contains('hidden')) return 'screen: ' + banner.textContent.trim();
    return '';
  })()`, 'the dashboard to open after setup');
  step('after setup', outcome);
  if (outcome !== 'dashboard') problems.push(`Setup did not open the workspace: ${JSON.stringify(outcome)}`);

  const clients = await evaluate(win,
    "window.electronAPI.request({ method: 'GET', path: '/api/clients' }).then(r => r.status)", 15000);
  step('IPC request through the preload bridge', `GET /api/clients -> ${clients}`);
  if (clients !== 200) problems.push(`The preload bridge returned ${JSON.stringify(clients)} for GET /api/clients.`);

  // Test end-to-end PDF generation and IPC doc:open bridge
  const pdfTest = await evaluate(win, `(async () => {
    try {
      const meRes = await window.electronAPI.request({ method: 'GET', path: '/api/auth/me' });
      const me = JSON.parse(meRes.body);
      const csrf = me.csrf_token;
      const headers = { 'x-csrf-token': csrf, 'content-type': 'application/json' };

      const clientRes = await window.electronAPI.request({
        method: 'POST', path: '/api/clients', headers,
        body: JSON.stringify({
          kind: 'BUSINESS', name: 'Smoke Client Ltd', company_name: 'Smoke Client',
          state_code: '36', country: 'India', notes: '', payment_terms_days: 15, gst_registered: false
        })
      });
      const clientData = JSON.parse(clientRes.body);
      const clientId = clientData?.client?.id;

      const invoiceRes = await window.electronAPI.request({
        method: 'POST', path: '/api/invoices', headers,
        body: JSON.stringify({
          client_id: clientId, title: 'Smoke Test Invoice', description: 'Testing PDF generation',
          scope_of_work: '', inclusions: '', exclusions: '', assumptions: '', warranty_terms: '',
          delivery_timeline: '', notes: '', terms: '',
          issue_date: '2026-10-25', expiry_date: null, due_date: null,
          place_of_supply_state_code: '36', payment_terms_days: 15, payment_terms: '',
          po_reference: '', project_reference: '', invoice_discount_bp: 0, invoice_discount_minor: 0,
          round_off_enabled: true, additional_charges: [], milestones: [],
          items: [{
            product_id: null, description: 'Smoke Test Item', category: '', hsn_sac: '',
            unit: 'NOS', quantity_milli: 1000, unit_price_minor: 500000, discount_bp: 0, discount_minor: 0,
            tax_rate_bp: 1800, tax_treatment: 'TAXABLE'
          }]
        })
      });
      const invoiceData = JSON.parse(invoiceRes.body);
      const invoiceId = invoiceData?.invoice?.id;

      await window.electronAPI.request({
        method: 'POST', path: '/api/invoices/' + invoiceId + '/issue', headers,
        body: '{}'
      });

      await window.electronAPI.request({
        method: 'POST', path: '/api/products', headers,
        body: JSON.stringify({
          name: 'Nextora POS mobile app', sku: 'NXM', description: 'IT is a yearly activation billing application',
          category: 'Mobile app', unit: 'NOS', unit_price_minor: 599900, tax_treatment: 'TAXABLE',
          tax_rate_bp: 1800, hsn_sac: '7674', status: 'ACTIVE', billing_interval: 'YEARLY',
          license_duration_months: 12, validity_notes: ''
        })
      });

      const docResult = await window.electronAPI.openDocument({
        path: '/api/invoices/' + invoiceId + '/pdf'
      });
      return docResult;
    } catch (e) {
      return { error: e.message, stack: e.stack };
    }
  })()`, 25000);

  // Close any preview window opened during the test
  const allWindows = BrowserWindow.getAllWindows();
  for (const w of allWindows) {
    if (w !== win && !w.isDestroyed()) {
      w.destroy();
    }
  }

  step('PDF generation and doc:open bridge', JSON.stringify(pdfTest));
  if (!pdfTest?.ok) problems.push(`PDF generation failed through doc:open: ${JSON.stringify(pdfTest)}`);

  // A foreign origin must still be refused by the in-process API.
  const foreignOrigin = await evaluate(win, `window.electronAPI.request({
    method: 'PUT', path: '/api/settings',
    headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
    body: '{}',
  }).then(r => r.status)`, 15000);
  step('foreign origin refused', `PUT /api/settings -> ${foreignOrigin}`);
  if (foreignOrigin !== 403) problems.push(`A foreign origin was not refused (status ${JSON.stringify(foreignOrigin)}).`);

  // The POS customer tracker must be reachable and render against SQLite.
  await evaluate(win, "location.hash = '#/tracker'");
  await waitFor(win, "document.querySelector('#content h1')?.textContent?.trim() === 'POS Customers' ? 'ok' : ''",
    'the POS customer tracker');
  const tracker = await evaluate(win, `(() => {
    const content = document.querySelector('#content');
    return {
      hasTable: Boolean(content.querySelector('table')),
      columns: content.querySelectorAll('thead th').length,
      rows: content.querySelectorAll('tbody tr').length,
    };
  })()`);
  step('POS customer tracker', `${tracker?.columns} columns, ${tracker?.rows} rows`);
  if (!tracker?.hasTable) problems.push('The tracker grid did not render a table.');

  // Test the Add Customer workflow in the UI (reproducing and verifying fix for "r is not a function")
  await evaluate(win, "document.querySelector('[data-action=\"customer-new\"]')?.click()");
  await waitFor(win, "document.querySelector('#customer-form') ? 'ok' : ''", 'Add Customer modal opening');
  const modalOpened = await evaluate(win, "Boolean(document.querySelector('#customer-form'))");
  if (!modalOpened) problems.push('Clicking Add Customer did not open the modal.');

  // Test form submission
  await evaluate(win, `(() => {
    const form = document.querySelector('#customer-form');
    if (!form) return;
    const nameInput = form.querySelector('[name=\"name\"]');
    if (nameInput) nameInput.value = 'Smoke Test Customer';
    const bizInput = form.querySelector('[name=\"business_name\"]');
    if (bizInput) bizInput.value = 'Smoke Test Cafe';
    document.querySelector('[data-action=\"customer-save\"]')?.click();
  })()`);

  await waitFor(win, "!document.querySelector('#customer-form') ? 'ok' : ''", 'Add Customer modal closing after save');
  const modalClosed = await evaluate(win, "!document.querySelector('#customer-form')");
  if (!modalClosed) problems.push('Add Customer modal did not close after saving.');

  await delay(500);
  const updatedTracker = await evaluate(win, `(() => {
    const content = document.querySelector('#content');
    return {
      rows: content.querySelectorAll('tbody tr').length,
      hasSmokeCustomer: content.innerText.includes('Smoke Test Customer'),
    };
  })()`);
  step('Add Customer workflow', `modal opened, saved customer, rows: ${updatedTracker?.rows}, contains customer: ${updatedTracker?.hasSmokeCustomer}`);
  if (!updatedTracker?.hasSmokeCustomer) problems.push('Added customer did not appear in the tracker table.');

  // The Products & Services page must render, have proper horizontal padding and table alignment
  await evaluate(win, "location.hash = '#/products'");
  await waitFor(win, "document.querySelector('#content h1')?.textContent?.trim() === 'Products & Services' ? 'ok' : ''",
    'the Products & Services page');
  const productsView = await evaluate(win, `(() => {
    const content = document.querySelector('#content');
    const h1 = content.querySelector('h1');
    const card = content.querySelector('section');
    const filters = content.querySelector('#product-filters');
    const table = content.querySelector('table');
    const bodyWidth = document.body.scrollWidth;
    const windowWidth = window.innerWidth;
    const firstTh = table ? table.querySelector('thead th') : null;
    const thPadding = firstTh ? window.getComputedStyle(firstTh).paddingLeft : null;
    const filterPadding = filters ? window.getComputedStyle(filters).paddingLeft : null;
    return {
      hasHeader: Boolean(h1),
      hasCard: Boolean(card),
      hasFilters: Boolean(filters),
      bodyScrollWidth: bodyWidth,
      windowInnerWidth: windowWidth,
      noWindowOverflow: bodyWidth <= windowWidth,
      thPaddingLeft: thPadding,
      filterPaddingLeft: filterPadding,
      paddingAligned: thPadding === filterPadding,
    };
  })()`);
  step('Products & Services layout', JSON.stringify(productsView));
  if (!productsView?.hasCard) problems.push('Products & Services card not rendered.');
  if (!productsView?.noWindowOverflow) problems.push(`Window overflow detected: body scrollWidth ${productsView?.bodyScrollWidth} > window width ${productsView?.windowInnerWidth}`);

  win.setSize(1024, 768);
  await delay(200);
  const laptopOverflow = await evaluate(win, "document.body.scrollWidth <= window.innerWidth");
  step('responsive 1024px no full-page overflow', String(laptopOverflow));
  if (!laptopOverflow) problems.push('Horizontal window overflow detected at 1024px width');
  win.setSize(1280, 800);

  const setupState = await evaluate(win,
    "window.electronAPI.request({ method: 'GET', path: '/api/auth/setup' }).then(r => r.body)", 15000);
  step('setup endpoint state', setupState);

  const dbFile = join(userDataDir, 'nextora-invoicing.sqlite');
  if (!existsSync(dbFile)) {
    problems.push(`The database was not created at ${dbFile}.`);
  } else {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
      const users = Number(db.prepare('SELECT count(*) n FROM inv_users').get().n);
      const tables = Number(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n);
      const migrations = Number(db.prepare('SELECT count(*) n FROM inv_schema_migrations').get().n);
      const audit = Number(db.prepare('SELECT count(*) n FROM inv_audit_logs').get().n);
      step('sqlite database', `${dbFile} (${Math.round(statSync(dbFile).size / 1024)} KB)`);
      step('schema', `${tables} tables, ${migrations} migrations`);
      step('records', `${users} user(s), ${audit} audit event(s)`);
      if (users !== 1) problems.push(`Expected exactly one owner account, found ${users}.`);
      if (migrations < 4) problems.push(`Expected at least 4 applied migrations, found ${migrations}.`);
      if (tables < 30) problems.push(`Expected the full schema, found only ${tables} tables.`);
    } finally {
      db.close();
    }
  }

  step('renderer origin', await evaluate(win, 'location.origin'));
}

/*
 * The entry module must finish evaluating before Electron emits 'ready', so the
 * harness never awaits readiness at the top level: it would deadlock against the
 * bootstrap that is waiting for this module.
 */
console.log('smoke: loading the application main process');
import('../electron/main.js')
  .then(() => {
    console.log('smoke: application module loaded');
    return run();
  })
  .then(() => finish(problems.length ? 1 : 0))
  .catch(error => {
    problems.push(`harness: ${error?.stack || error}`);
    finish(1);
  });
