import { formatMinor, formatDate, amountInWords } from './money.js';

/* ---------------------------------------------------------------- escaping */

export const esc = value => String(value ?? '').replace(/[&<>"']/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

/* --------------------------------------------------------------- formatting */

export const money = minor => formatMinor(Number(minor || 0));
export const moneyPlain = minor => formatMinor(Number(minor || 0), { symbol: '' });
export const date = value => (value ? formatDate(value) : '—');
export const words = minor => amountInWords(Number(minor || 0));
export const percent = bp => `${(Number(bp || 0) / 100).toFixed(Number(bp || 0) % 100 === 0 ? 0 : 2)}%`;

export function toMajor(minor) {
  return (Number(minor || 0) / 100).toFixed(2);
}

export function parseAmount(text) {
  const cleaned = String(text ?? '').replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

export function toQuantity(milli) {
  const value = Number(milli || 0) / 1000;
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

export function parseQuantity(text) {
  const value = Number(String(text ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(value) ? Math.round(value * 1000) : 0;
}

export const titleCase = value => String(value || '').toLowerCase().replace(/(^|\s|_)([a-z])/g,
  (match, prefix, letter) => prefix.replace('_', ' ') + letter.toUpperCase());

export const statusLabel = status => ({
  DRAFT: 'Draft', SENT: 'Sent', ACCEPTED: 'Accepted', REJECTED: 'Rejected', EXPIRED: 'Expired',
  CANCELLED: 'Cancelled', VOID: 'Void', ISSUED: 'Issued', PAID: 'Paid', UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partially paid', OVERDUE: 'Overdue', OVERPAID: 'Overpaid',
}[status] || titleCase(status));

const TONES = {
  neutral: 'bg-surface-dim text-on-surface-variant border-outline',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warn: 'bg-amber-50 text-amber-900 border-amber-200',
  danger: 'bg-red-50 text-red-800 border-red-200',
  info: 'bg-cyan-50 text-cyan-900 border-cyan-200',
};

export const statusTone = status => ({
  DRAFT: 'neutral', SENT: 'info', ACCEPTED: 'success', REJECTED: 'danger', EXPIRED: 'warn',
  CANCELLED: 'danger', VOID: 'danger', ISSUED: 'info', PAID: 'success', UNPAID: 'warn',
  PARTIALLY_PAID: 'info', OVERDUE: 'danger', OVERPAID: 'warn',
}[status] || 'neutral');

export const badge = (text, tone = 'neutral') =>
  `<span class="inline-flex items-center whitespace-nowrap border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${TONES[tone] || TONES.neutral}">${esc(text)}</span>`;

export const statusBadge = status => badge(statusLabel(status), statusTone(status));

/* -------------------------------------------------------------- primitives */

const SVG_ICONS = {
  space_dashboard: '<rect x="3" y="3" width="8" height="9" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/><rect x="3" y="14" width="8" height="7" rx="1"/>',
  request_quote: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h4"/>',
  receipt_long: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h5"/>',
  groups: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  inventory_2: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  payments: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  point_of_sale: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/><path d="M7 8h4"/><path d="M7 12h2"/><path d="M15 8h2"/><path d="M15 12h2"/>',
  bar_chart: '<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  menu: '<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>',
  manage_accounts: '<circle cx="12" cy="8" r="4"/><path d="M5 20v-1a7 7 0 0 1 14 0v1"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  add: '<line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/>',
  error: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  check_circle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  close: '<line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/>',
  event_available: '<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/><path d="m9 16 2 2 4-4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  person_add: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
  add_column_right: '<rect width="12" height="18" x="3" y="3" rx="1"/><line x1="9" x2="9" y1="3" y2="21"/><line x1="19" x2="19" y1="9" y2="15"/><line x1="16" x2="22" y1="12" y2="12"/>',
  upload_file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" x2="12" y1="18" y2="12"/><polyline points="9 15 12 12 15 15"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  group_off: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="2" x2="22" y1="2" y2="22"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
  backup: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  restore: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
};

export const icon = (name, extra = '') => {
  const path = SVG_ICONS[name];
  if (path) {
    return `<svg class="inline-block shrink-0 select-none ${extra}" style="width:1em;height:1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  }
  return `<span class="material-symbols-outlined ${extra}" aria-hidden="true">${esc(name)}</span>`;
};

export const button = ({
  label, action, variant = 'secondary', icon: iconName, attributes = '', size = 'md', type = 'button',
}) => {
  const variants = {
    primary: 'bg-primary text-on-primary border-primary hover:bg-[#2d2d2d]',
    secondary: 'bg-surface text-primary border-outline hover:bg-surface-dim',
    ghost: 'bg-transparent text-on-surface border-transparent hover:bg-surface-dim',
    accent: 'bg-cyan-accent text-white border-cyan-accent hover:brightness-95',
    danger: 'bg-surface text-red-700 border-red-200 hover:bg-red-50',
  };
  const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-2 text-sm' };
  return `<button type="${type}" ${action ? `data-action="${esc(action)}"` : ''} ${attributes}
    class="inline-flex items-center justify-center gap-2 border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]}">
    ${iconName ? icon(iconName, '!text-[18px]') : ''}<span>${esc(label)}</span></button>`;
};

export const pageHeader = ({ title, subtitle, actions = '', breadcrumb = '' }) => `
  <div class="mb-6 flex flex-col gap-4 border-b border-outline pb-5 md:flex-row md:items-end md:justify-between">
    <div class="min-w-0">
      ${breadcrumb ? `<nav class="mb-2 font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">${breadcrumb}</nav>` : ''}
      <h1 class="font-headline text-2xl font-bold tracking-tight md:text-[28px]">${esc(title)}</h1>
      ${subtitle ? `<p class="mt-1 max-w-3xl text-sm text-on-surface-variant">${esc(subtitle)}</p>` : ''}
    </div>
    ${actions ? `<div class="flex flex-wrap items-center gap-2">${actions}</div>` : ''}
  </div>`;

export const card = ({ title = '', subtitle = '', actions = '', body = '', className = '' }) => `
  <section class="border border-outline bg-surface ${className}">
    ${title || actions ? `<header class="flex flex-wrap items-center justify-between gap-3 border-b border-outline px-5 py-3">
      <div><h2 class="font-headline text-sm font-semibold">${esc(title)}</h2>
      ${subtitle ? `<p class="mt-0.5 text-xs text-on-surface-variant">${esc(subtitle)}</p>` : ''}</div>
      <div class="flex flex-wrap items-center gap-2">${actions}</div></header>` : ''}
    <div>${body}</div>
  </section>`;

export const stat = ({ label, value, hint = '', tone = '' }) => `
  <div class="border border-outline bg-surface p-5">
    <p class="label-technical">${esc(label)}</p>
    <p class="mt-2 font-headline text-2xl font-bold tracking-tight num ${tone}">${value}</p>
    ${hint ? `<p class="mt-1 text-xs text-on-surface-variant">${hint}</p>` : ''}
  </div>`;

export const emptyState = ({ icon: iconName = 'inbox', title, message, actionLabel, action, secondary = '' }) => `
  <div class="flex flex-col items-center justify-center px-6 py-16 text-center">
    ${icon(iconName, '!text-[40px] text-on-surface-variant')}
    <h3 class="mt-3 font-headline text-base font-semibold">${esc(title)}</h3>
    <p class="mt-1 max-w-md text-sm text-on-surface-variant">${esc(message)}</p>
    ${actionLabel ? `<div class="mt-5 flex gap-2">${button({ label: actionLabel, action, variant: 'primary', icon: 'add' })}${secondary}</div>` : ''}
  </div>`;

export const loading = (message = 'Loading…') => `
  <div class="flex items-center justify-center gap-3 px-6 py-16 text-sm text-on-surface-variant">
    <span class="h-4 w-4 animate-spin rounded-full border-2 border-outline border-t-cyan-accent"></span>${esc(message)}
  </div>`;

export const field = ({
  label, name, type = 'text', value = '', hint = '', required = false, placeholder = '',
  options = null, attributes = '', step = '', className = 'sm:col-span-1', min = '', max = '',
  id: idOverride = null,
}) => {
  const id = idOverride || `field-${name}`;
  const control = options
    ? `<select id="${id}" name="${esc(name)}" ${attributes} class="field appearance-none">
        ${options.map(option => `<option value="${esc(option.value)}" ${String(option.value) === String(value) ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}
      </select>`
    : type === 'textarea'
      ? `<textarea id="${id}" name="${esc(name)}" rows="${attributes.includes('rows=') ? '' : '3'}" ${attributes}
          placeholder="${esc(placeholder)}" class="field">${esc(value)}</textarea>`
      : `<input id="${id}" name="${esc(name)}" type="${esc(type)}" value="${esc(value)}"
          ${step ? `step="${esc(step)}"` : ''} ${min !== '' ? `min="${esc(min)}"` : ''} ${max !== '' ? `max="${esc(max)}"` : ''}
          ${attributes} placeholder="${esc(placeholder)}" class="field">`;
  return `<div class="${className}">
    <label for="${id}" class="label-technical mb-1.5 block">${esc(label)}${required ? ' <span class="text-red-600">*</span>' : ''}</label>
    ${control}
    ${hint ? `<p class="mt-1 text-xs text-on-surface-variant">${esc(hint)}</p>` : ''}
  </div>`;
};

export const grid = (content, columns = 4) => `<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-${columns}">${content}</div>`;

export const pagination = ({ page, total, limit }) => {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total === 0) return '';
  return `<div class="flex flex-wrap items-center justify-between gap-3 border-t border-outline px-5 py-3">
    <p class="text-xs text-on-surface-variant">${esc(String(total))} record${total === 1 ? '' : 's'} · page ${esc(String(page))} of ${esc(String(pages))}</p>
    <div class="flex gap-2">
      ${button({ label: 'Previous', action: 'page-prev', size: 'sm', attributes: page <= 1 ? 'disabled' : '' })}
      ${button({ label: 'Next', action: 'page-next', size: 'sm', attributes: page >= pages ? 'disabled' : '' })}
    </div>
  </div>`;
};

export const toolbar = content => `<div class="flex flex-wrap items-end gap-3 border-b border-outline px-5 py-4">${content}</div>`;

export const alertBox = (message, tone = 'info') => {
  if (!message) return '';
  const tones = {
    info: 'border-cyan-200 bg-cyan-50 text-cyan-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    danger: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  };
  return `<div class="border px-4 py-3 text-sm ${tones[tone] || tones.info}">${esc(message)}</div>`;
};

export const warnings = list => (list && list.length
  ? `<div class="space-y-2">${list.map(text => alertBox(text, 'warn')).join('')}</div>` : '');

/* ------------------------------------------------------------------ toasts */

export function toast(message, tone = 'success') {
  const root = document.getElementById('toasts');
  if (!root) return;
  const tones = { success: 'border-emerald-200 bg-white text-emerald-800', danger: 'border-red-200 bg-white text-red-800', info: 'border-outline bg-white text-on-surface' };
  const node = document.createElement('div');
  node.className = `pointer-events-auto flex items-start gap-3 border px-4 py-3 text-sm shadow-[0_4px_20px_rgba(0,0,0,0.08)] ${tones[tone] || tones.success}`;
  node.innerHTML = `${icon(tone === 'danger' ? 'error' : 'check_circle', '!text-[18px]')}<span>${esc(message)}</span>`;
  root.appendChild(node);
  setTimeout(() => node.remove(), 5200);
}

/* ------------------------------------------------------------------- modal */

export function modal({ title, body, footer = '', size = 'md', onMount }) {
  const root = document.getElementById('modal-root');
  const maxWidth = size === 'wide' ? 'max-w-4xl' : 'max-w-2xl';
  root.innerHTML = `
    <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <div role="dialog" aria-modal="true" class="w-full ${maxWidth} border border-outline bg-surface shadow-[0_4px_20px_rgba(0,0,0,0.12)]">
        <header class="flex items-center justify-between border-b border-outline px-5 py-3">
          <h2 class="font-headline text-base font-semibold">${esc(title)}</h2>
          <button type="button" data-action="close-modal" class="text-on-surface-variant hover:text-on-surface" aria-label="Close">
            ${icon('close')}
          </button>
        </header>
        <div class="max-h-[70vh] overflow-y-auto px-5 py-4">${body}</div>
        ${footer ? `<footer class="flex flex-wrap justify-end gap-2 border-t border-outline px-5 py-3">${footer}</footer>` : ''}
      </div>
    </div>`;
  root.querySelector('[data-action="close-modal"]')?.focus();
  onMount?.(root.firstElementChild);
  return root.firstElementChild;
}

export const closeModal = () => { document.getElementById('modal-root').innerHTML = ''; };

export const confirmModal = ({ title, message, confirmLabel = 'Confirm', action, tone = 'primary' }) => modal({
  title,
  body: `<p class="text-sm text-on-surface">${esc(message)}</p>`,
  footer: `${button({ label: 'Cancel', action: 'close-modal' })}${button({ label: confirmLabel, action, variant: tone })}`,
});
