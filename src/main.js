import './style.css';
import { api, setCsrfToken, setUnauthenticatedHandler } from './lib/api.js';
import { closeModal, esc, icon, toast } from './lib/ui.js';

import * as login from './views/login.js';
import * as dashboard from './views/dashboard.js';
import * as quotations from './views/quotations.js';
import * as invoices from './views/invoices.js';
import * as editor from './views/editor.js';
import * as clients from './views/clients.js';
import * as products from './views/products.js';
import * as payments from './views/payments.js';
import * as tracker from './views/tracker.js';
import * as reports from './views/reports.js';
import * as settings from './views/settings.js';
import * as cleanup from './views/cleanup.js';
import * as marketing from './views/marketing.js';

const NAV = [
  { href: '#/dashboard', label: 'Dashboard', icon: 'space_dashboard' },
  { href: '#/quotations', label: 'Quotations', icon: 'request_quote' },
  { href: '#/invoices', label: 'Invoices', icon: 'receipt_long' },
  { href: '#/clients', label: 'Clients', icon: 'groups' },
  { href: '#/products', label: 'Products & Services', icon: 'inventory_2' },
  { href: '#/payments', label: 'Payments', icon: 'payments' },
  { href: '#/tracker', label: 'POS Customers', icon: 'loyalty' },
  {
    href: '#/marketing',
    label: 'Marketing & Partnerships',
    icon: 'campaign',
    subitems: [
      { href: '#/marketing/influencers', label: 'Influencers' },
      { href: '#/marketing/contracts', label: 'Contracts & Agreements' },
      { href: '#/marketing/import', label: 'Import Sales Excel' },
      { href: '#/marketing/reports', label: 'Influencer Sales Reports' },
    ],
  },
  { href: '#/reports', label: 'Reports', icon: 'bar_chart' },
  { href: '#/settings', label: 'Settings', icon: 'settings' },
];

const state = {
  session: null,
  reference: null,
  actions: new Map(),
  page: 1,
  filters: {},
  view: null,
};

/* ------------------------------------------------------------ route parsing */

function parseRoute() {
  const raw = (location.hash || '#/dashboard').replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const search = new URLSearchParams(queryPart || '');
  return { segments, search };
}

const ROUTES = {
  dashboard: { module: dashboard, label: 'Dashboard' },
  quotations: { module: quotations, label: 'Quotations' },
  invoices: { module: invoices, label: 'Invoices' },
  clients: { module: clients, label: 'Clients' },
  products: { module: products, label: 'Products & Services' },
  payments: { module: payments, label: 'Payments' },
  tracker: { module: tracker, label: 'POS Customers' },
  reports: { module: reports, label: 'Reports' },
  marketing: { module: marketing, label: 'Marketing & Partnerships' },
  settings: { module: settings, label: 'Settings' },
  cleanup: { module: cleanup, label: 'Business Data Cleanup' },
};

export const navigate = href => {
  if (location.hash === href) { route(); return; }
  location.hash = href;
};

/** Context handed to each view; also the registry the global click handler uses. */
function context(container) {
  state.actions = new Map();
  return {
    session: state.session,
    reference: state.reference,
    navigate,
    get page() { return state.page; },
    setPage(value) { state.page = value; },
    get filters() { return state.filters; },
    setFilters(value) { state.filters = value; },
    on(name, handler) { state.actions.set(name, handler); return name; },
    refreshReference: async () => {
      state.reference = await api.get('/api/reference');
      return state.reference;
    },
    rerender: () => route(),
    container,
  };
}

/* ----------------------------------------------------------------- rendering */

function shell(activeKey, content) {
  const user = state.session?.user;
  const roleLabel = { OWNER: 'Owner', ADMIN: 'Administrator', FINANCE: 'Finance', ACCOUNTANT: 'Accountant' }[user?.role] || user?.role;
  return `
    <div class="flex min-h-screen bg-surface-dim">
      <aside id="sidebar" class="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-outline bg-surface lg:flex print:hidden">
        ${sidebarInner(activeKey, user, roleLabel)}
      </aside>
      <div id="sidebar-mobile" class="fixed inset-0 z-40 hidden lg:hidden print:hidden">
        <div class="absolute inset-0 bg-black/40" data-action="nav-toggle"></div>
        <aside class="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-outline bg-surface">
          ${sidebarInner(activeKey, user, roleLabel)}
        </aside>
      </div>
      <div class="min-w-0 flex-1 lg:pl-64">
        <header class="sticky top-0 z-30 flex items-center gap-3 border-b border-outline bg-surface px-4 py-3 lg:hidden print:hidden">
          <button type="button" data-action="nav-toggle" class="text-on-surface" aria-label="Open navigation">${icon('menu')}</button>
          <span class="font-headline text-sm font-bold">Nextora Invoicing</span>
        </header>
        <main id="content" class="mx-auto w-full max-w-container-max min-w-0 px-4 py-6 md:px-8 md:py-8"></main>
      </div>
    </div>`;
}

function sidebarInner(activeKey, user, roleLabel) {
  return `
    <div class="border-b border-outline px-5 py-5">
      <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-on-surface-variant">Nextora Creations</p>
      <p class="font-headline text-lg font-bold tracking-tight">Invoicing</p>
    </div>
    <nav class="flex-1 overflow-y-auto py-3" aria-label="Main">
      ${NAV.map(item => {
        const active = item.href === `#/${activeKey}` || (item.subitems && activeKey === 'marketing');
        return `
          <a href="${item.href}" class="flex items-center gap-3 border-l-2 px-5 py-2.5 text-sm transition-colors
            ${active ? 'border-cyan-accent bg-surface-dim font-semibold text-on-surface' : 'border-transparent text-on-surface-variant hover:bg-surface-dim hover:text-on-surface'}">
            ${icon(item.icon, '!text-[20px]')}<span>${esc(item.label)}</span>
          </a>
          ${item.subitems && active ? `
            <div class="ml-9 border-l border-outline my-1 pl-3 space-y-1">
              ${item.subitems.map(sub => `
                <a href="${sub.href}" class="block py-1 text-xs text-on-surface-variant hover:text-on-surface transition-colors">
                  ${esc(sub.label)}
                </a>
              `).join('')}
            </div>
          ` : ''}
        `;
      }).join('')}
    </nav>
    <div class="border-t border-outline px-5 py-4">
      <p class="truncate font-mono text-[11px] text-on-surface-variant">${esc(user?.email || '')}</p>
      <p class="mt-0.5 text-xs text-on-surface-variant">${esc(roleLabel || '')}</p>
      <div class="mt-3 flex flex-col gap-2">
        <a href="#/settings" class="flex items-center gap-2 text-xs text-on-surface-variant hover:text-on-surface">${icon('manage_accounts', '!text-[16px]')}Account &amp; settings</a>
        <button type="button" data-action="logout" class="flex items-center gap-2 text-xs text-on-surface-variant hover:text-on-surface">
          ${icon('logout', '!text-[16px]')}Sign out</button>
      </div>
    </div>`;
}

function renderLogin(message) {
  document.getElementById('app').innerHTML = login.render({ message });
  login.mount();
}

async function route() {
  if (!state.session) return;
  setUnsavedChanges(false);
  const { segments, search } = parseRoute();
  const key = segments[0] || 'dashboard';
  const routeInfo = ROUTES[key];

  if (!routeInfo) { navigate('#/dashboard'); return; }

  const container = document.getElementById('content');
  container.setAttribute('aria-busy', 'true');
  closeModal();

  // Editors are full-page forms rather than list views.
  const isEditor = segments.length === 3 && ['new', 'edit'].includes(segments[2])
    || (segments[1] === 'new' && segments.length === 2);
  const isDetail = segments.length === 2;

  if (['quotations', 'invoices'].includes(key) && (isEditor || isDetail)) {
    const params = {
      kind: key === 'quotations' ? 'QUOTATION' : 'INVOICE',
      id: segments[1] === 'new' ? null : segments[1],
      mode: isEditor ? (segments[2] === 'edit' || segments[1] === 'new' ? 'edit' : 'view') : 'view',
      search,
    };
    await editor.render(container, params, context(container));
  } else {
    const params = { search, segments };
    await routeInfo.module.render(container, params, context(container));
  }
  container.removeAttribute('aria-busy');
  window.scrollTo({ top: 0 });
}

function mount() {
  const activeKey = parseRoute().segments[0] || 'dashboard';
  document.getElementById('app').innerHTML = shell(activeKey, '');
  document.getElementById('content').innerHTML = '<div class="py-16 text-center text-sm text-on-surface-variant">Loading…</div>';
}

/* ------------------------------------------------------------------ events */

document.addEventListener('click', async event => {
  const link = event.target.closest('a[href^="#/"]');
  if (link && !event.metaKey && !event.ctrlKey) event.preventDefault();

  const trigger = event.target.closest('[data-action]');
  if (!trigger) { if (link) navigate(link.getAttribute('href')); return; }
  const name = trigger.dataset.action;

  if (name === 'nav-toggle') {
    const panel = document.getElementById('sidebar-mobile');
    panel.classList.toggle('hidden');
    return;
  }
  if (name === 'close-modal') { closeModal(); return; }
  if (name === 'logout') {
    try { await api.post('/api/auth/logout'); } catch { /* the session is going away regardless */ }
    state.session = null;
    setCsrfToken(null);
    location.hash = '#/dashboard';
    renderLogin();
    return;
  }

  const handler = state.actions.get(name);
  if (handler) {
    event.preventDefault();
    try {
      await handler(trigger, event);
    } catch (error) {
      toast(error.message || 'Something went wrong.', 'danger');
    }
  }
});

window.addEventListener('hashchange', () => { if (state.session) { state.page = 1; mount(); route(); } });

setUnauthenticatedHandler(() => {
  const hadSession = Boolean(state.session);
  state.session = null;
  setCsrfToken(null);
  renderLogin(hadSession ? 'Your session ended. Please sign in again.' : '');
});

/* -------------------------------------------------------- desktop shell */

/**
 * The Electron main process owns unsaved-change protection and an application
 * menu; both must survive a web build, so every call here is optional.
 */
export const setUnsavedChanges = dirty => {
  globalThis.window?.electronAPI?.setUnsavedChanges?.(Boolean(dirty));
};

window.electronAPI?.onNavigate?.(hash => { if (hash) navigate(hash); });

/* -------------------------------------------------------------------- boot */

function renderSetup(message) {
  document.getElementById('app').innerHTML = login.renderSetup({ message });
  login.mountSetup();
}

/** Shared by sign-in and first-run setup: both return a user and a CSRF token. */
async function startSession(result) {
  state.session = result;
  setCsrfToken(result.csrf_token);
  state.reference = await api.get('/api/reference');
  if (!location.hash || location.hash === '#/') location.hash = '#/dashboard';
  mount();
  await route();
}

async function boot() {
  try {
    const setup = await api.get('/api/auth/setup');
    if (setup.setup_required) { renderSetup(); return; }
  } catch {
    // Any configuration problem is reported by the sign-in attempt below.
  }
  try {
    await startSession(await api.probe('/api/auth/me'));
  } catch {
    renderLogin();
  }
}

login.wire(async credentials => {
  await startSession(await api.post('/api/auth/login', credentials));
}, () => renderLogin());

login.wireRegister(async payload => {
  await startSession(await api.post('/api/auth/register', payload));
});

login.wireRecover(async payload => {
  return await api.post('/api/auth/recover', payload);
});

login.wireSetup(async payload => {
  try {
    await startSession(await api.post('/api/auth/setup', payload));
  } catch (error) {
    // Another window finished setup first, or the account already exists.
    if (error.code === 'ALREADY_INITIALIZED') { renderLogin(error.message); return; }
    throw error;
  }
});

boot();

export { state, api };
