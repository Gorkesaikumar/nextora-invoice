import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell, safeStorage } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { getDatabase } from '../server/db.js';
import { migrate } from '../scripts/migrate.js';
import { configuration, createAPI } from '../server/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// A packaged build always runs against the bundled assets; `electron .` never does.
const isDev = !app.isPackaged;

/** Development renderer origin (Vite). Production serves from the app:// scheme. */
const DEV_ORIGIN = 'http://localhost:5174';
const APP_SCHEME = 'app';
const APP_ORIGIN = `${APP_SCHEME}://nextora`;

/** The origin the in-process API validates requests against in the current mode. */
const RENDERER_ORIGIN = isDev ? DEV_ORIGIN : APP_ORIGIN;

let mainWindow = null;
let api = null;
let db = null;
let cookieHeader = null;
let hasUnsavedChanges = false;
let forceClose = false;

function previewTempDir() {
  return join(app.getPath('temp'), 'nextora-invoicing-previews');
}

/**
 * A stable per-install secret keeps rate-limit counters hashing to the same rows
 * across restarts instead of accumulating a new key on every launch.
 */
let installSecretValue = null;
async function installSecret() {
  if (installSecretValue) return installSecretValue;
  const file = join(app.getPath('userData'), 'local-security.key');
  try {
    const existing = (await readFile(file, 'utf8')).trim();
    if (existing.length >= 32) {
      installSecretValue = existing;
      return existing;
    }
  } catch {
    // First run: the key has not been created yet.
  }
  const generated = randomBytes(32).toString('hex');
  await writeFile(file, generated, { mode: 0o600 });
  installSecretValue = generated;
  return generated;
}

/* ------------------------------------------------------------- app:// assets */

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

// The renderer may only reach its own bundle. Web fonts are the single exception
// so the interface keeps the Nextora typography online and degrades gracefully offline.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// Registered before the app is ready, so the scheme is trusted from the first load.
protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
}]);

/**
 * Serves the built renderer bundle from a real, non-file origin. Serving from
 * app:// (instead of file://) gives the page a proper origin for CSP, so the
 * Content-Security-Policy below is actually enforced.
 */
async function serveAppAsset(request) {
  const distDir = join(__dirname, '..', 'dist');
  const pathname = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
  const target = normalize(join(distDir, pathname || 'index.html'));
  if (target !== distDir && !target.startsWith(distDir + sep)) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const body = await readFile(target);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': MIME_TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

async function ensureDatabase() {
  if (!db) {
    const userData = app.getPath('userData');
    await mkdir(userData, { recursive: true });
    if (!process.env.DATABASE_PATH) {
      process.env.DATABASE_PATH = join(userData, 'nextora-invoicing.sqlite');
    }
    db = getDatabase();
    await migrate(db, { directory: join(__dirname, '../server/migrations-sqlite') });
    // The desktop runtime is a local single-user install: the API keeps every
    // origin, CSRF and role check, but cookies never travel over a network and
    // APP_URL is the local renderer origin rather than a public host.
    const cfg = configuration({
      ...process.env,
      NODE_ENV: 'development',
      APP_URL: RENDERER_ORIGIN,
      RATE_LIMIT_SECRET: await installSecret(),
    });
    api = createAPI(db, cfg);
    if (cookieHeader === null) {
      cookieHeader = await loadPersistedSessionCookie();
    }
  }
  return { db, api };
}

function sessionFilePath() {
  return join(app.getPath('userData'), 'local-session.dat');
}

async function persistSessionCookie(cookie) {
  try {
    const file = sessionFilePath();
    if (!cookie) {
      await rm(file, { force: true });
      return;
    }
    let data;
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(cookie);
      data = JSON.stringify({ encrypted: true, value: encrypted.toString('base64') });
    } else {
      data = JSON.stringify({ encrypted: false, value: cookie });
    }
    await writeFile(file, data, { mode: 0o600 });
  } catch {
    // Persistence failures are non-fatal
  }
}

async function loadPersistedSessionCookie() {
  try {
    const file = sessionFilePath();
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.encrypted && safeStorage && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(parsed.value, 'base64'));
    }
    return parsed.value || null;
  } catch {
    return null;
  }
}

function updateCookieFromResponse(response) {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) return;
  const pair = setCookie.split(';')[0].trim();
  const [, value = ''] = pair.split('=');
  if (!value || /Max-Age=0/i.test(setCookie)) {
    cookieHeader = null;
    persistSessionCookie(null);
  } else {
    cookieHeader = pair;
    persistSessionCookie(pair);
  }
}

async function dispatchApi({ method = 'GET', path = '/', headers = {}, body } = {}) {
  await ensureDatabase();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${RENDERER_ORIGIN}${normalizedPath}`;
  const reqHeaders = new Headers(headers);
  reqHeaders.set('origin', RENDERER_ORIGIN);
  reqHeaders.set('sec-fetch-site', 'same-origin');
  if (cookieHeader && !reqHeaders.has('cookie')) {
    reqHeaders.set('cookie', cookieHeader);
  }
  const request = new Request(url, {
    method: method.toUpperCase(),
    headers: reqHeaders,
    body: body !== undefined && !['GET', 'HEAD'].includes(method.toUpperCase())
      ? (typeof body === 'string' ? body : JSON.stringify(body))
      : undefined,
  });
  const response = await api(request, { ip: '127.0.0.1' });
  if (response.status === 401 && cookieHeader) {
    cookieHeader = null;
    persistSessionCookie(null);
  } else {
    updateCookieFromResponse(response);
  }
  return response;
}

function extractFilename(response, fallback = 'document.pdf') {
  const header = response.headers.get('content-disposition') || '';
  const match = /filename="([^"]+)"/.exec(header);
  return match ? match[1] : fallback;
}

function filtersForFilename(filename) {
  const ext = extname(filename).toLowerCase();
  if (ext === '.pdf') return [{ name: 'PDF Document', extensions: ['pdf'] }];
  if (ext === '.xlsx') return [{ name: 'Excel Workbook', extensions: ['xlsx'] }];
  if (ext === '.csv') return [{ name: 'CSV Spreadsheet', extensions: ['csv'] }];
  return [{ name: 'All Files', extensions: ['*'] }];
}

function sendNavigate(hash) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:navigate', hash);
  }
}

function buildAppMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Invoice',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendNavigate('#/invoices/new'),
        },
        {
          label: 'New Quotation',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => sendNavigate('#/quotations/new'),
        },
        { type: 'separator' },
        {
          label: 'Print',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.print({ printBackground: true });
            }
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Navigate',
      submenu: [
        { label: 'Dashboard', accelerator: 'CmdOrCtrl+1', click: () => sendNavigate('#/dashboard') },
        { label: 'Quotations', accelerator: 'CmdOrCtrl+2', click: () => sendNavigate('#/quotations') },
        { label: 'Invoices', accelerator: 'CmdOrCtrl+3', click: () => sendNavigate('#/invoices') },
        { label: 'Clients', accelerator: 'CmdOrCtrl+4', click: () => sendNavigate('#/clients') },
        { label: 'Products & Services', accelerator: 'CmdOrCtrl+5', click: () => sendNavigate('#/products') },
        { label: 'Payments', accelerator: 'CmdOrCtrl+6', click: () => sendNavigate('#/payments') },
        { label: 'POS Customer Tracker', accelerator: 'CmdOrCtrl+7', click: () => sendNavigate('#/tracker') },
        { label: 'Reports', accelerator: 'CmdOrCtrl+8', click: () => sendNavigate('#/reports') },
        { label: 'Settings & Backup', accelerator: 'CmdOrCtrl+,', click: () => sendNavigate('#/settings') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    title: 'Nextora Creations | Invoicing',
    backgroundColor: '#F7F7F5',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Restrict external window opening to safe protocols only
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
        shell.openExternal(url);
      }
    } catch {
      // Ignore malformed URLs
    }
    return { action: 'deny' };
  });

  // Prevent navigation away from the local application
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(DEV_ORIGIN) || url.startsWith(`${APP_ORIGIN}/`)) return;
    event.preventDefault();
  });

  // Protect unsaved changes before closing the window
  mainWindow.on('close', event => {
    if (!forceClose && hasUnsavedChanges) {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        buttons: ['Cancel', 'Discard Changes & Quit'],
        defaultId: 0,
        cancelId: 0,
        title: 'Unsaved Changes',
        message: 'You have unsaved edits on the current screen. Are you sure you want to close Nextora Invoicing?',
      });
      if (choice === 0) {
        event.preventDefault();
        return;
      }
    }
  });

  mainWindow.loadURL(isDev ? DEV_ORIGIN : `${APP_ORIGIN}/index.html`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* --------------------------------------------------------------------- IPC */

ipcMain.handle('api:request', async (_event, spec) => {
  const response = await dispatchApi(spec);
  const responseHeaders = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  const contentType = response.headers.get('content-type') || '';
  const isBinary = contentType.includes('application/pdf')
    || contentType.includes('octet-stream')
    || contentType.includes('spreadsheetml')
    || contentType.includes('image/')
    || contentType.includes('font/');
  let bodyData;
  if (isBinary) {
    const buffer = Buffer.from(await response.arrayBuffer());
    bodyData = buffer.toString('base64');
    responseHeaders['x-encoded'] = 'base64';
  } else {
    bodyData = await response.text();
  }
  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body: bodyData,
  };
});

ipcMain.handle('doc:open', async (_event, { path, download = false } = {}) => {
  if (!path || typeof path !== 'string' || !path.startsWith('/api/')) {
    return { ok: false, status: 400, error: 'A valid document API path is required.' };
  }
  try {
    const response = await dispatchApi({ method: 'GET', path });
    if (response.status < 200 || response.status >= 300) {
      let message = 'Could not generate document.';
      try {
        const err = await response.json();
        if (err?.error) message = err.error;
      } catch { /* ignore */ }
      return { ok: false, status: response.status, error: message };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      return { ok: false, status: 500, error: 'The generated document was empty.' };
    }
    const filename = extractFilename(response, 'document.pdf');
    const contentType = response.headers.get('content-type') || '';

    if (download || !contentType.includes('application/pdf')) {
      const parentWin = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : null;
      if (!parentWin) return { ok: false, canceled: true };
      const saveResult = await dialog.showSaveDialog(parentWin, {
        title: 'Save Document',
        defaultPath: filename,
        filters: filtersForFilename(filename),
      });
      if (saveResult.canceled || !saveResult.filePath) {
        return { ok: true, canceled: true };
      }
      await writeFile(saveResult.filePath, buffer);
      return { ok: true, saved: true, filePath: saveResult.filePath };
    }

    // Preview PDF in a dedicated desktop preview window
    const dir = previewTempDir();
    await mkdir(dir, { recursive: true });
    const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_');
    const tempFile = join(dir, `${Date.now()}-${safeName}`);
    await writeFile(tempFile, buffer);

    const parentWin = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : undefined;
    const previewWin = new BrowserWindow({
      width: 960,
      height: 820,
      parent: parentWin,
      title: `${filename} — Preview`,
      backgroundColor: '#525659',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        plugins: true,
      },
    });
    previewWin.setMenuBarVisibility(false);
    await previewWin.loadFile(tempFile);
    return { ok: true, previewed: true, filePath: tempFile };
  } catch (error) {
    return {
      ok: false,
      status: error.status || 500,
      error: error.message || 'An error occurred while opening the document.',
    };
  }
});

ipcMain.handle('db:backup', async (_event, { csrfToken } = {}) => {
  if (!mainWindow) return { ok: false, canceled: true };
  const dateStamp = new Date().toISOString().slice(0, 10);
  const saveResult = await dialog.showSaveDialog(mainWindow, {
    title: 'Create Local Database Backup',
    defaultPath: `nextora-invoicing-backup-${dateStamp}.sqlite`,
    filters: [{ name: 'SQLite Database Backup', extensions: ['sqlite', 'db'] }],
  });
  if (saveResult.canceled || !saveResult.filePath) {
    return { ok: true, canceled: true };
  }
  const response = await dispatchApi({
    method: 'POST',
    path: '/api/backup/create',
    headers: {
      'content-type': 'application/json',
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
    },
    body: JSON.stringify({ destination_path: saveResult.filePath }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, error: payload.error || 'Backup failed.' };
  }
  return { ok: true, backup: payload.backup };
});

ipcMain.handle('db:restore', async (_event, { csrfToken } = {}) => {
  if (!mainWindow) return { ok: false, canceled: true };
  const openResult = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Database Backup to Restore',
    properties: ['openFile'],
    filters: [{ name: 'SQLite Database Backup', extensions: ['sqlite', 'db'] }],
  });
  if (openResult.canceled || !openResult.filePaths?.length) {
    return { ok: true, canceled: true };
  }
  const sourcePath = openResult.filePaths[0];
  const confirm = dialog.showMessageBoxSync(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Restore Backup'],
    defaultId: 0,
    cancelId: 0,
    title: 'Confirm Database Restore',
    message: 'Restoring this backup will replace current local application records. An automatic safety backup of your current database will be saved first. Continue?',
  });
  if (confirm !== 1) {
    return { ok: true, canceled: true };
  }
  const response = await dispatchApi({
    method: 'POST',
    path: '/api/backup/restore',
    headers: {
      'content-type': 'application/json',
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
    },
    body: JSON.stringify({ source_path: sourcePath }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, error: payload.error || 'Restore failed.' };
  }
  cookieHeader = null;
  return { ok: true, restore: payload.restore };
});

ipcMain.handle('app:setUnsavedChanges', (_event, dirty) => {
  hasUnsavedChanges = Boolean(dirty);
  return true;
});

ipcMain.handle('app:openDataFolder', async () => {
  const target = app.getPath('userData');
  const failure = await shell.openPath(target);
  return failure ? { ok: false, error: failure } : { ok: true, path: target };
});

ipcMain.handle('app:print', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.webContents.print({ printBackground: true });
  return true;
});

ipcMain.handle('dialog:openFile', async (_event, options = {}) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:saveFile', async (_event, options = {}) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, options);
  if (result.canceled) return null;
  return result.filePath;
});

/* --------------------------------------------------------------- lifecycle */

app.whenReady().then(async () => {
  // The bundled renderer is served from app:// with the CSP above; in
  // development Vite owns the origin and the dev server headers apply instead.
  if (!isDev) protocol.handle(APP_SCHEME, serveAppAsset);

  await ensureDatabase();
  buildAppMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', async () => {
  forceClose = true;
  try {
    await rm(previewTempDir(), { recursive: true, force: true });
  } catch { /* ignore temp cleanup failure */ }
  try {
    if (db) await db.close();
  } catch { /* ignore close error */ }
});
