import { api, query } from '../lib/api.js';
import {
  esc, money, date, button, card, emptyState, loading, pageHeader, pagination, field, alertBox, titleCase,
} from '../lib/ui.js';

export const render = async (container, params, ctx) => {
  const filters = ctx.filters || {};
  container.innerHTML = pageHeader({ title: 'Payments' }) + loading();

  let data;
  try {
    data = await api.get(`/api/payments${query({ search: filters.search, from: filters.from, to: filters.to, page: ctx.page })}`);
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Payments' }) + alertBox(error.message, 'danger');
    return;
  }

  container.innerHTML = `
    ${pageHeader({
    title: 'Payments',
    subtitle: 'Every payment is recorded against an invoice and issued a numbered receipt. Recorded payments cannot be edited or deleted.',
  })}
    ${card({
    body: `
      <form id="payment-filters" class="flex flex-wrap items-end gap-3 border-b border-outline px-5 py-4">
        ${field({ label: 'Search', name: 'search', value: filters.search || '', placeholder: 'Receipt, invoice, client or reference', className: '' })}
        ${field({ label: 'From', name: 'from', type: 'date', value: filters.from || '', className: '' })}
        ${field({ label: 'To', name: 'to', type: 'date', value: filters.to || '', className: '' })}
        <div class="flex gap-2 pb-0.5">${button({ label: 'Filter', type: 'submit', variant: 'primary' })}</div>
      </form>
      <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-outline bg-surface-dim px-5 py-3">
        <p class="label-technical">Collected in this view</p>
        <p class="num font-headline text-lg font-bold">${money(data.collected_minor)}</p>
      </div>
      ${data.payments.length ? `
      <div class="overflow-x-auto">
        <table class="data-table w-full min-w-[880px]">
          <thead><tr>
            <th>Receipt</th><th>Paid on</th><th>Client</th><th>Invoice</th><th>Method</th>
            <th>Reference</th><th class="text-right">Amount</th><th></th>
          </tr></thead>
          <tbody>
            ${data.payments.map(row => `<tr>
              <td class="font-mono text-xs">${esc(row.receipt_number)}</td>
              <td class="whitespace-nowrap">${date(row.paid_on)}</td>
              <td>${esc(row.client_name)}${row.client_company && row.client_company !== row.client_name ? `<div class="text-xs text-on-surface-variant">${esc(row.client_company)}</div>` : ''}</td>
              <td><a class="font-mono text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent" href="#/invoices/${esc(row.invoice_id)}">${esc(row.invoice_number || 'Draft')}</a></td>
              <td class="text-xs">${esc(titleCase(row.method))}</td>
              <td class="text-xs">${esc(row.reference || '—')}</td>
              <td class="num text-right">${money(row.amount_minor)}</td>
              <td class="whitespace-nowrap text-right">
                <button type="button" data-action="receipt-view" data-id="${esc(row.id)}" class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Receipt</button>
                <button type="button" data-action="receipt-download" data-id="${esc(row.id)}" class="ml-3 text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Download</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${pagination({ page: data.page, total: data.total, limit: data.limit })}`
      : emptyState({
        icon: 'payments', title: 'No payments recorded',
        message: 'Open an issued invoice to record a full or partial payment and generate its receipt.',
      })}
    `,
  })}`;

  ctx.on('receipt-view', trigger => api.openDocument(`/api/payments/${trigger.dataset.id}/receipt?view=1`));
  ctx.on('receipt-download', trigger => api.openDocument(`/api/payments/${trigger.dataset.id}/receipt`, { download: true }));
  ctx.on('page-prev', () => { ctx.setPage(Math.max(1, ctx.page - 1)); ctx.rerender(); });
  ctx.on('page-next', () => { ctx.setPage(ctx.page + 1); ctx.rerender(); });

  container.querySelector('#payment-filters').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.target);
    ctx.setFilters({
      search: String(form.get('search') || ''), from: String(form.get('from') || ''), to: String(form.get('to') || ''),
    });
    ctx.setPage(1);
    ctx.rerender();
  });
};
