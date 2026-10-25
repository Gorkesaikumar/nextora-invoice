import { api, query } from '../lib/api.js';
import {
  esc, money, date, button, card, emptyState, loading, pageHeader, pagination, field, alertBox,
  statusBadge, modal, closeModal, toast, confirmModal,
} from '../lib/ui.js';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SENT', label: 'Sent' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function transitionModal(ctx, row, target) {
  const needsReason = ['REJECTED', 'CANCELLED'].includes(target);
  const labels = { ACCEPTED: 'Record acceptance', REJECTED: 'Record rejection', CANCELLED: 'Cancel quotation', EXPIRED: 'Mark as expired', SENT: 'Reopen as sent' };
  const node = modal({
    title: labels[target],
    body: `<form id="transition-form" class="space-y-4">
        <p class="text-sm text-on-surface-variant">${esc(row.quotation_number || 'Draft')} · ${esc(row.client_name)}</p>
        ${needsReason
    ? field({ label: 'Reason', name: 'note', type: 'textarea', required: true, hint: 'Recorded in the audit trail.', className: '' })
    : ''}
        ${target === 'ACCEPTED' ? '<p class="text-sm">Acceptance is recorded for audit purposes. It is not proof that payment has been received.</p>' : ''}
      </form>`,
    footer: `${button({ label: 'Cancel', action: 'close-modal' })}${button({ label: labels[target], action: 'confirm-transition', variant: target === 'CANCELLED' || target === 'REJECTED' ? 'danger' : 'primary' })}`,
  });
  ctx.on('confirm-transition', async () => {
    const note = node.querySelector('[name="note"]')?.value || '';
    await api.post(`/api/quotations/${row.id}/transition`, { status: target, note });
    closeModal();
    toast(`Quotation marked ${target.toLowerCase()}.`);
    ctx.rerender();
  });
}

export const render = async (container, params, ctx) => {
  const filters = ctx.filters || {};
  container.innerHTML = pageHeader({ title: 'Quotations' }) + loading();

  let data;
  let clients = [];
  try {
    [data, clients] = await Promise.all([
      api.get(`/api/quotations${query({ search: filters.search, status: filters.status, from: filters.from, to: filters.to, page: ctx.page })}`),
      api.get('/api/clients?limit=100'),
    ]);
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Quotations' }) + alertBox(error.message, 'danger');
    return;
  }

  container.innerHTML = `
    ${pageHeader({
    title: 'Quotations',
    subtitle: 'Priced offers. A quotation becomes an invoice only after the client accepts it, and converting it never marks anything as paid.',
    actions: button({ label: 'New quotation', action: 'new-quotation', variant: 'primary', icon: 'add' }),
  })}
    ${card({
    body: `
      <form id="quotation-filters" class="flex flex-wrap items-end gap-3 border-b border-outline px-5 py-4">
        ${field({ label: 'Search', name: 'search', value: filters.search || '', placeholder: 'Number, title or client', className: '' })}
        ${field({ label: 'Status', name: 'status', value: filters.status || '', options: STATUS_OPTIONS, className: '' })}
        ${field({ label: 'From', name: 'from', type: 'date', value: filters.from || '', className: '' })}
        ${field({ label: 'To', name: 'to', type: 'date', value: filters.to || '', className: '' })}
        <div class="flex gap-2 pb-0.5">${button({ label: 'Filter', type: 'submit', variant: 'primary' })}</div>
      </form>
      ${data.quotations.length ? `
      <div class="overflow-x-auto">
        <table class="data-table w-full min-w-[1040px]">
          <thead><tr>
            <th>Number</th><th>Client</th><th>Title</th><th>Issued</th><th>Valid until</th>
            <th class="text-right">Value</th><th>Status</th><th class="text-right">Actions</th>
          </tr></thead>
          <tbody>
            ${data.quotations.map(row => `<tr>
              <td><a class="font-mono text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent" href="#/quotations/${esc(row.id)}">${esc(row.quotation_number || 'Draft')}</a></td>
              <td>${esc(row.client_name)}${row.client_company && row.client_company !== row.client_name ? `<div class="text-xs text-on-surface-variant">${esc(row.client_company)}</div>` : ''}</td>
              <td class="max-w-[240px] truncate">${esc(row.title)}</td>
              <td class="whitespace-nowrap">${date(row.issue_date)}</td>
              <td class="whitespace-nowrap">${row.expiry_date ? date(row.expiry_date) : '—'}</td>
              <td class="num text-right">${money(row.totals.grand_total_minor)}</td>
              <td>${statusBadge(row.effective_status)}${row.converted_invoice_id ? ' ' + statusBadge('CONVERTED') : ''}</td>
              <td class="whitespace-nowrap text-right">
                ${row.status === 'DRAFT' ? `<button type="button" data-action="edit" data-id="${esc(row.id)}" class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Edit</button>` : ''}
                ${row.status === 'DRAFT' ? `<button type="button" data-action="send" data-id="${esc(row.id)}" class="ml-3 text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Send</button>` : ''}
                ${row.status === 'DRAFT' && !row.quotation_number ? `<button type="button" data-action="delete-draft" data-id="${esc(row.id)}" class="ml-3 text-xs text-red-600 hover:text-red-800">Delete</button>` : ''}
                ${row.status === 'SENT' ? `<button type="button" data-action="transition" data-target="ACCEPTED" data-id="${esc(row.id)}" class="ml-3 text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Accept</button>` : ''}
                ${row.status === 'SENT' ? `<button type="button" data-action="transition" data-target="REJECTED" data-id="${esc(row.id)}" class="ml-3 text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Reject</button>` : ''}
                ${row.status === 'ACCEPTED' && !row.converted_invoice_id ? `<button type="button" data-action="convert" data-id="${esc(row.id)}" class="ml-3 text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Convert</button>` : ''}
                <button type="button" data-action="pdf" data-id="${esc(row.id)}" class="ml-3 text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">PDF</button>
                <button type="button" data-action="duplicate" data-id="${esc(row.id)}" class="ml-3 text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Duplicate</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${pagination({ page: data.page, total: data.total, limit: data.limit })}`
      : emptyState({
        icon: 'request_quote', title: 'No quotations found',
        message: 'Create a quotation to send a priced offer, with optional milestones for project work.',
        actionLabel: 'New quotation', action: 'new-quotation',
      })}
    `,
  })}`;

  const rows = new Map(data.quotations.map(row => [row.id, row]));
  const rowFor = trigger => rows.get(trigger.dataset.id);
  // Remembered between opening a confirmation and confirming it.
  let pendingId = null;

  ctx.on('new-quotation', () => ctx.navigate('#/quotations/new'));
  ctx.on('edit', trigger => ctx.navigate(`#/quotations/${trigger.dataset.id}/edit`));
  ctx.on('pdf', trigger => api.openDocument(`/api/quotations/${trigger.dataset.id}/pdf?view=1`));
  ctx.on('duplicate', async trigger => {
    const result = await api.post(`/api/quotations/${trigger.dataset.id}/duplicate`);
    toast('Quotation duplicated as a new draft.');
    ctx.navigate(`#/quotations/${result.quotation.id}/edit`);
  });
  ctx.on('send', trigger => {
    pendingId = trigger.dataset.id;
    confirmModal({
      title: 'Send quotation',
      message: 'Sending allocates the document number and freezes the commercial terms. The quotation can no longer be edited afterwards.',
      confirmLabel: 'Send quotation', action: 'confirm-send',
    });
  });
  ctx.on('confirm-send', async () => {
    await api.post(`/api/quotations/${pendingId}/send`);
    closeModal();
    toast('Quotation sent and numbered.');
    ctx.rerender();
  });
  ctx.on('delete-draft', trigger => {
    pendingId = trigger.dataset.id;
    confirmModal({
      title: 'Delete draft quotation',
      message: 'Are you sure you want to delete this draft quotation? Only unsent drafts can be deleted. Cancel an issued quotation instead.',
      confirmLabel: 'Delete draft',
      action: 'confirm-delete-draft',
      tone: 'danger',
    });
  });
  ctx.on('confirm-delete-draft', async () => {
    try {
      await api.del(`/api/quotations/${pendingId}`);
      closeModal();
      toast('Draft quotation deleted.');
      ctx.rerender();
    } catch (err) {
      toast(err.message, 'danger');
    }
  });
  ctx.on('transition', trigger => transitionModal(ctx, rowFor(trigger), trigger.dataset.target));
  ctx.on('convert', trigger => {
    pendingId = trigger.dataset.id;
    confirmModal({
      title: 'Convert to invoice',
      message: 'A new invoice draft is created from the accepted quotation. The quotation is locked to this invoice so it can never be converted twice.',
      confirmLabel: 'Create invoice draft', action: 'confirm-convert', tone: 'primary',
    });
  });
  ctx.on('confirm-convert', async () => {
    const result = await api.post(`/api/quotations/${pendingId}/convert`, {
      issue_date: new Date().toISOString().slice(0, 10), due_date: null,
    });
    closeModal();
    toast('Invoice draft created from the accepted quotation.');
    ctx.navigate(`#/invoices/${result.invoice.id}/edit`);
  });
  ctx.on('page-prev', () => { ctx.setPage(Math.max(1, ctx.page - 1)); ctx.rerender(); });
  ctx.on('page-next', () => { ctx.setPage(ctx.page + 1); ctx.rerender(); });

  container.querySelector('#quotation-filters').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.target);
    ctx.setFilters({
      search: String(form.get('search') || ''), status: String(form.get('status') || ''),
      from: String(form.get('from') || ''), to: String(form.get('to') || ''),
    });
    ctx.setPage(1);
    ctx.rerender();
  });
};
