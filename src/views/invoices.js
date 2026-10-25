import { api, query } from '../lib/api.js';
import {
  esc, money, date, button, card, emptyState, loading, pageHeader, pagination, field, alertBox,
  statusBadge, modal, closeModal, toast, confirmModal, titleCase, toMajor, parseAmount,
} from '../lib/ui.js';
import { formatDate } from '../lib/money.js';

const PAYMENT_STATUS = [
  { value: '', label: 'All payment states' },
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'PARTIALLY_PAID', label: 'Partially paid' },
  { value: 'PAID', label: 'Paid' },
  { value: 'OVERDUE', label: 'Overdue' },
];

function paymentModal(ctx, invoice) {
  const balance = invoice.balance_due_minor;
  const node = modal({
    title: `Record payment · ${invoice.invoice.invoice_number}`,
    body: `
      <form id="payment-form" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="sm:col-span-2 border border-outline bg-surface-dim px-4 py-3 text-sm">
          <div class="flex justify-between"><span class="text-on-surface-variant">Invoice total</span><span class="num">${money(invoice.invoice.totals.grand_total_minor)}</span></div>
          <div class="flex justify-between"><span class="text-on-surface-variant">Already received</span><span class="num">${money(invoice.amount_paid_minor)}</span></div>
          <div class="mt-1 flex justify-between font-semibold"><span>Balance due</span><span class="num">${money(balance)}</span></div>
        </div>
        ${field({ label: 'Amount received (₹)', name: 'amount', type: 'number', step: '0.01', min: '0.01', required: true,
    value: toMajor(balance), hint: 'Overpayment is not recorded here; refund a surplus with a credit note.' })}
        ${field({ label: 'Payment date', name: 'paid_on', type: 'date', required: true, value: new Date().toISOString().slice(0, 10) })}
        ${field({ label: 'Method', name: 'method', options: ctx.reference.payment_methods.map(method => ({ value: method, label: titleCase(method) })), value: 'BANK_TRANSFER' })}
        ${field({ label: 'Transaction reference', name: 'reference', placeholder: 'UTR, UPI reference or cheque number' })}
        ${field({ label: 'Notes', name: 'notes', type: 'textarea', className: 'sm:col-span-2' })}
      </form>
      <p class="mt-4 text-xs text-on-surface-variant">Recording a payment issues a numbered receipt and cannot be undone or edited afterwards.</p>`,
    footer: `${button({ label: 'Cancel', action: 'close-modal' })}${button({ label: 'Record payment', action: 'save-payment', variant: 'primary' })}`,
  });

  ctx.on('save-payment', async () => {
    const form = new FormData(node.querySelector('#payment-form'));
    try {
      const result = await api.post(`/api/invoices/${invoice.invoice.id}/payments`, {
        amount_minor: parseAmount(form.get('amount')),
        paid_on: String(form.get('paid_on')),
        method: String(form.get('method')),
        reference: String(form.get('reference') || '').trim(),
        notes: String(form.get('notes') || ''),
      });
      closeModal();
      toast(`Receipt ${result.receipt.number} issued. Payment is ${titleCase(result.payment_status).toLowerCase()}.`);
      ctx.rerender();
    } catch (error) {
      toast(error.message, 'danger');
    }
  });
}

function cancelModal(ctx, invoice) {
  const node = modal({
    title: `Cancel ${invoice.invoice.invoice_number || 'draft'}`,
    body: `<form id="cancel-form" class="space-y-4">
        <p class="text-sm text-on-surface-variant">The document number is retained for the audit trail. Cancelling is only possible while no payment has been recorded.</p>
        ${field({ label: 'Reason', name: 'reason', type: 'textarea', required: true, className: '' })}
        ${invoice.invoice.status === 'ISSUED' ? field({
    label: 'Treatment', name: 'void', className: '',
    options: [{ value: 'false', label: 'Cancel (issued in error, no payment)' }, { value: 'true', label: 'Void (retain number as void)' }],
  }) : ''}
      </form>`,
    footer: `${button({ label: 'Keep invoice', action: 'close-modal' })}${button({ label: 'Confirm cancellation', action: 'confirm-cancel', variant: 'danger' })}`,
  });
  ctx.on('confirm-cancel', async () => {
    const form = new FormData(node.querySelector('#cancel-form'));
    try {
      await api.post(`/api/invoices/${invoice.invoice.id}/cancel`, {
        reason: String(form.get('reason') || ''), void: String(form.get('void') || 'false') === 'true',
      });
      closeModal();
      toast('Invoice cancelled. It no longer counts towards receivables.');
      ctx.rerender();
    } catch (error) {
      toast(error.message, 'danger');
    }
  });
}

export const render = async (container, params, ctx) => {
  const filters = ctx.filters || {};
  container.innerHTML = pageHeader({ title: 'Invoices' }) + loading();

  let data;
  try {
    data = await api.get(`/api/invoices${query({
      search: filters.search, status: filters.status, payment_status: filters.payment_status,
      from: filters.from, to: filters.to, page: ctx.page,
    })}`);
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Invoices' }) + alertBox(error.message, 'danger');
    return;
  }

  const outstanding = data.invoices.reduce((total, row) => total + Math.max(row.balance_due_minor, 0), 0);

  container.innerHTML = `
    ${pageHeader({
    title: 'Invoices',
    subtitle: 'Issued documents are immutable. Correct an issued invoice with a credit note rather than by editing it.',
    actions: button({ label: 'New invoice', action: 'new-invoice', variant: 'primary', icon: 'add' }),
  })}
    ${card({
    body: `
      <form id="invoice-filters" class="flex flex-wrap items-end gap-3 border-b border-outline px-5 py-4">
        ${field({ label: 'Search', name: 'search', value: filters.search || '', placeholder: 'Number, title or client', className: '' })}
        ${field({ label: 'Document status', name: 'status', value: filters.status || '',
      options: [{ value: '', label: 'All' }, { value: 'DRAFT', label: 'Draft' }, { value: 'ISSUED', label: 'Issued' },
        { value: 'CANCELLED', label: 'Cancelled' }, { value: 'VOID', label: 'Void' }], className: '' })}
        ${field({ label: 'Payment state', name: 'payment_status', value: filters.payment_status || '', options: PAYMENT_STATUS, className: '' })}
        ${field({ label: 'From', name: 'from', type: 'date', value: filters.from || '', className: '' })}
        ${field({ label: 'To', name: 'to', type: 'date', value: filters.to || '', className: '' })}
        <div class="flex gap-2 pb-0.5">${button({ label: 'Filter', type: 'submit', variant: 'primary' })}</div>
      </form>
      <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-outline bg-surface-dim px-5 py-3">
        <p class="label-technical">Outstanding in this view</p>
        <p class="num font-headline text-lg font-bold">${money(outstanding)}</p>
      </div>
      ${data.invoices.length ? `
      <div class="overflow-x-auto">
        <table class="data-table w-full min-w-[1120px]">
          <thead><tr>
            <th>Number</th><th>Client</th><th>Issued</th><th>Due</th>
            <th class="text-right">Total</th><th class="text-right">Paid</th><th class="text-right">Balance</th>
            <th>Payment</th><th class="text-right">Actions</th>
          </tr></thead>
          <tbody>
            ${data.invoices.map(row => `<tr>
              <td><a class="font-mono text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent" href="#/invoices/${esc(row.id)}">${esc(row.invoice_number || 'Draft')}</a>
                ${row.quotation_id ? '<div class="font-mono text-[10px] uppercase text-on-surface-variant">from quotation</div>' : ''}</td>
              <td>${esc(row.client_name)}${row.client_company && row.client_company !== row.client_name ? `<div class="text-xs text-on-surface-variant">${esc(row.client_company)}</div>` : ''}</td>
              <td class="whitespace-nowrap">${date(row.issue_date)}</td>
              <td class="whitespace-nowrap">${row.due_date ? date(row.due_date) : '—'}</td>
              <td class="num text-right">${money(row.totals.grand_total_minor)}</td>
              <td class="num text-right">${money(row.paid_minor)}</td>
              <td class="num text-right">${money(row.balance_due_minor)}</td>
              <td>${statusBadge(row.payment_status)}</td>
              <td class="whitespace-nowrap text-right">
                ${row.status === 'DRAFT' ? `<button type="button" data-action="edit" data-id="${esc(row.id)}" class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Edit</button>` : ''}
                ${row.status === 'DRAFT' ? `<button type="button" data-action="issue" data-id="${esc(row.id)}" class="ml-3 text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Issue</button>` : ''}
                ${row.status === 'ISSUED' && row.balance_due_minor > 0 ? `<button type="button" data-action="pay" data-id="${esc(row.id)}" class="ml-3 text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Payment</button>` : ''}
                <button type="button" data-action="pdf" data-id="${esc(row.id)}" class="ml-3 text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">PDF</button>
                ${row.status === 'ISSUED' && row.paid_minor === 0 ? `<button type="button" data-action="cancel" data-id="${esc(row.id)}" class="ml-3 text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Cancel</button>` : ''}
                ${row.status === 'ISSUED' ? `<button type="button" data-action="credit" data-id="${esc(row.id)}" class="ml-3 text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Credit note</button>` : ''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${pagination({ page: data.page, total: data.total, limit: data.limit })}`
      : emptyState({
        icon: 'receipt_long', title: 'No invoices found',
        message: 'Issue an invoice directly, or convert an accepted quotation into one.',
        actionLabel: 'New invoice', action: 'new-invoice',
      })}
    `,
  })}`;

  const load = async id => api.get(`/api/invoices/${id}`);
  let pendingId = null;

  ctx.on('new-invoice', () => ctx.navigate('#/invoices/new'));
  ctx.on('edit', trigger => ctx.navigate(`#/invoices/${trigger.dataset.id}/edit`));
  ctx.on('pdf', trigger => api.openDocument(`/api/invoices/${trigger.dataset.id}/pdf?view=1`));
  ctx.on('pay', async trigger => paymentModal(ctx, await load(trigger.dataset.id)));
  ctx.on('cancel', async trigger => cancelModal(ctx, await load(trigger.dataset.id)));
  ctx.on('credit', trigger => {
    pendingId = trigger.dataset.id;
    confirmModal({
      title: 'Issue credit note',
      message: 'A credit note reduces the invoice value and its tax. Enter the scope reduction on the invoice page after the draft is created.',
      confirmLabel: 'Continue', action: 'confirm-credit',
    });
  });
  ctx.on('issue', trigger => {
    pendingId = trigger.dataset.id;
    confirmModal({
      title: 'Issue invoice',
      message: 'Issuing allocates the sequential invoice number and freezes the amounts, taxes and customer details. It cannot be edited afterwards.',
      confirmLabel: 'Issue invoice', action: 'confirm-issue',
    });
  });
  ctx.on('confirm-issue', async () => {
    const result = await api.post(`/api/invoices/${pendingId}/issue`);
    closeModal();
    toast(`Invoice ${result.invoice.invoice_number} issued.`);
    ctx.rerender();
  });
  ctx.on('confirm-credit', () => { closeModal(); ctx.navigate(`#/invoices/${pendingId}`); });
  ctx.on('page-prev', () => { ctx.setPage(Math.max(1, ctx.page - 1)); ctx.rerender(); });
  ctx.on('page-next', () => { ctx.setPage(ctx.page + 1); ctx.rerender(); });

  container.querySelector('#invoice-filters').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.target);
    ctx.setFilters({
      search: String(form.get('search') || ''), status: String(form.get('status') || ''),
      payment_status: String(form.get('payment_status') || ''),
      from: String(form.get('from') || ''), to: String(form.get('to') || ''),
    });
    ctx.setPage(1);
    ctx.rerender();
  });
};

export { formatDate };
