import { api, query } from '../lib/api.js';
import {
  esc, money, date, button, card, emptyState, loading, pageHeader, pagination, field, alertBox,
  statusBadge, modal, closeModal, toast, statusLabel, badge,
} from '../lib/ui.js';
import { toMajor, parseAmount } from '../lib/ui.js';

const STATE_OPTIONS = reference => [{ value: '', label: 'Not selected' },
  ...reference.states.map(state => ({ value: state.code, label: `${state.code} · ${state.name}` }))];

async function clientForm(ctx, existing = null, suggestedWarnings = []) {
  const reference = ctx.reference;
  const client = existing || {
    kind: 'BUSINESS', name: '', company_name: '', contact_person: '', email: '', phone: '',
    billing_address: '', service_address: '', gstin: '', state_code: '', country: 'India', notes: '',
    payment_terms_days: reference.business.default_payment_terms_days, gst_registered: false,
  };
  const node = modal({
    title: existing ? 'Edit client' : 'New client',
    body: `
      <div id="client-warnings" class="mb-4 space-y-2">${suggestedWarnings.map(text => alertBox(text, 'warn')).join('')}</div>
      <form id="client-form" class="grid grid-cols-1 gap-4 sm:grid-cols-2" novalidate>
        ${field({ label: 'Record type', name: 'kind', options: [
    { value: 'BUSINESS', label: 'Business' }, { value: 'INDIVIDUAL', label: 'Individual' },
  ], value: client.kind })}
        ${field({ label: 'Client name', name: 'name', required: true, value: client.name, hint: 'The name that appears on documents.' })}
        ${field({ label: 'Company name', name: 'company_name', value: client.company_name })}
        ${field({ label: 'Contact person', name: 'contact_person', value: client.contact_person })}
        ${field({ label: 'Email', name: 'email', type: 'email', value: client.email })}
        ${field({ label: 'Phone', name: 'phone', value: client.phone })}
        ${field({ label: 'GST registered', name: 'gst_registered', options: [
    { value: 'false', label: 'No' }, { value: 'true', label: 'Yes' },
  ], value: String(client.gst_registered) })}
        ${field({ label: 'GSTIN', name: 'gstin', value: client.gstin, placeholder: '27AAPFU0939F1ZV',
    hint: 'Format and check digit are verified as a warning only; this is not proof of registration.' })}
        ${field({ label: 'State (place of supply)', name: 'state_code', options: STATE_OPTIONS(reference), value: client.state_code })}
        ${field({ label: 'Country', name: 'country', value: client.country })}
        ${field({ label: 'Default payment terms (days)', name: 'payment_terms_days', type: 'number', min: '0', max: '365',
    value: String(client.payment_terms_days) })}
        ${field({ label: 'Billing address', name: 'billing_address', type: 'textarea', value: client.billing_address, className: 'sm:col-span-1' })}
        ${field({ label: 'Service / shipping address', name: 'service_address', type: 'textarea', value: client.service_address })}
        ${field({ label: 'Customer notes', name: 'notes', type: 'textarea', value: client.notes, className: 'sm:col-span-2' })}
      </form>`,
    footer: `${button({ label: 'Cancel', action: 'close-modal' })}${button({ label: existing ? 'Save client' : 'Create client', action: 'save-client', variant: 'primary' })}`,
  });

  node.querySelector('#gstin')?.addEventListener('blur', async event => {
    const form = new FormData(node.querySelector('#client-form'));
    try {
      const result = await api.post('/api/clients/check-duplicates', {
        name: String(form.get('name') || ''), company_name: String(form.get('company_name') || ''),
        email: String(form.get('email') || ''), gstin: String(form.get('gstin') || '').toUpperCase(),
        state_code: String(form.get('state_code') || ''), exclude_id: existing?.id || null,
      });
      node.querySelector('#client-warnings').innerHTML = result.warnings.map(text => alertBox(text, 'warn')).join('');
    } catch { /* a duplicate check must never block data entry */ }
  });

  ctx.on('save-client', async () => {
    const form = new FormData(node.querySelector('#client-form'));
    const payload = {
      kind: String(form.get('kind')),
      name: String(form.get('name') || '').trim(),
      company_name: String(form.get('company_name') || '').trim(),
      contact_person: String(form.get('contact_person') || '').trim(),
      email: String(form.get('email') || '').trim(),
      phone: String(form.get('phone') || '').trim(),
      billing_address: String(form.get('billing_address') || ''),
      service_address: String(form.get('service_address') || ''),
      gstin: String(form.get('gstin') || '').trim().toUpperCase(),
      state_code: String(form.get('state_code') || ''),
      country: String(form.get('country') || 'India').trim(),
      notes: String(form.get('notes') || ''),
      payment_terms_days: Number(form.get('payment_terms_days') || 15),
      gst_registered: String(form.get('gst_registered')) === 'true',
    };
    try {
      const result = existing
        ? await api.patch(`/api/clients/${existing.id}`, payload)
        : await api.post('/api/clients', payload);
      closeModal();
      const warnings = existing ? [] : result.warnings || [];
      toast(existing ? 'Client updated.' : 'Client created.');
      if (warnings.length) toast(warnings[0], 'info');
      ctx.rerender();
    } catch (error) {
      const node = document.querySelector('#client-warnings');
      const details = error.fields?.length
        ? error.fields.map(item => `${item.field}: ${item.message}`).join(' · ')
        : error.message;
      node.innerHTML = alertBox(details, 'danger');
    }
  });
}

export const render = async (container, params, ctx) => {
  if (params.segments?.[1]) return renderDetail(container, params.segments[1], ctx);
  const filters = ctx.filters || {};
  container.innerHTML = pageHeader({ title: 'Clients' }) + loading();

  let data;
  try {
    data = await api.get(`/api/clients${query({
      search: filters.search, status: filters.status, page: ctx.page,
    })}`);
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Clients' }) + alertBox(error.message, 'danger');
    return;
  }

  container.innerHTML = `
    ${pageHeader({
    title: 'Clients',
    subtitle: 'Reusable customer records. Documents keep their own copy of client details, so later edits never change an issued document.',
    actions: button({ label: 'New client', action: 'new-client', variant: 'primary', icon: 'add' }),
  })}
    ${card({
    className: 'mt-0',
    body: `
      <form id="client-filters" class="flex flex-wrap items-end gap-3 border-b border-outline px-5 py-4">
        ${field({ label: 'Search', name: 'search', value: filters.search || '', placeholder: 'Name, company, contact or GSTIN', className: '' })}
        ${field({ label: 'Status', name: 'status', options: [
      { value: '', label: 'All' }, { value: 'ACTIVE', label: 'Active' }, { value: 'ARCHIVED', label: 'Archived' },
    ], value: filters.status || '', className: '' })}
        <div class="flex gap-2 pb-0.5">${button({ label: 'Search', type: 'submit', variant: 'primary' })}</div>
      </form>
      ${data.clients.length ? `
      <div class="overflow-x-auto">
        <table class="data-table w-full min-w-[900px]">
          <thead><tr>
            <th>Client</th><th>Contact</th><th>GSTIN</th><th>State</th>
            <th class="text-right">Quotations</th><th class="text-right">Invoices</th>
            <th class="text-right">Invoiced</th><th class="text-right">Collected</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            ${data.clients.map(row => `<tr>
              <td><a class="font-medium underline decoration-outline underline-offset-2 hover:decoration-cyan-accent" href="#/clients/${esc(row.id)}">${esc(row.name)}</a>
                ${row.company_name && row.company_name !== row.name ? `<div class="text-xs text-on-surface-variant">${esc(row.company_name)}</div>` : ''}</td>
              <td class="text-xs">${esc(row.contact_person || '—')}<div class="text-on-surface-variant">${esc(row.email || '')}</div></td>
              <td class="font-mono text-xs">${esc(row.gstin || '—')}</td>
              <td class="font-mono text-xs">${esc(row.state_code || '—')}</td>
              <td class="num text-right">${row.quotation_count}</td>
              <td class="num text-right">${row.invoice_count}</td>
              <td class="num text-right">${money(row.invoiced_minor)}</td>
              <td class="num text-right">${money(row.collected_minor)}</td>
              <td>${statusBadge(row.status)}</td>
              <td class="text-right whitespace-nowrap">
                <button type="button" data-action="edit-client" data-id="${esc(row.id)}" class="text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent">Edit</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${pagination({ page: data.page, total: data.total, limit: data.limit })}`
      : emptyState({
        icon: 'groups', title: 'No clients yet',
        message: 'Add a client before creating a quotation or invoice.',
        actionLabel: 'New client', action: 'new-client',
      })}
    `,
  })}`;

  const rows = new Map(data.clients.map(row => [row.id, row]));

  ctx.on('new-client', () => clientForm(ctx));
  ctx.on('edit-client', trigger => clientForm(ctx, rows.get(trigger.dataset.id)));
  ctx.on('page-prev', () => { ctx.setPage(Math.max(1, ctx.page - 1)); ctx.rerender(); });
  ctx.on('page-next', () => { ctx.setPage(ctx.page + 1); ctx.rerender(); });

  container.querySelector('#client-filters').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.target);
    ctx.setFilters({ ...ctx.filters, search: String(form.get('search') || ''), status: String(form.get('status') || '') });
    ctx.setPage(1);
    ctx.rerender();
  });
};

/* --------------------------------------------------------------- client page */

const renderDetail = async (container, id, ctx) => {
  container.innerHTML = pageHeader({ title: 'Client' }) + loading();
  let data;
  try {
    data = await api.get(`/api/clients/${id}`);
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Client' }) + alertBox(error.message, 'danger');
    return;
  }
  const { client, quotations, invoices } = data;
  const outstanding = invoices.filter(row => row.status === 'ISSUED').reduce((total, row) => total + row.balance_due_minor, 0);

  container.innerHTML = `
    ${pageHeader({
    title: client.name,
    breadcrumb: `<a class="hover:text-on-surface" href="#/clients">Clients</a> / ${esc(client.name)}`,
    subtitle: client.company_name && client.company_name !== client.name ? client.company_name : undefined,
    actions: `${button({ label: 'Edit', action: 'edit-client', attributes: `data-id="${esc(client.id)}"` })}
      ${button({ label: client.status === 'ACTIVE' ? 'Archive' : 'Restore', action: 'toggle-client', attributes: `data-id="${esc(client.id)}" data-status="${client.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE'}"` })}
      ${button({ label: 'New quotation', action: 'quotation-for-client', attributes: `data-id="${esc(client.id)}"`, variant: 'primary' })}`,
  })}

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      ${card({
    title: 'Client details',
    body: `<dl class="divide-y divide-outline">
        ${[['Status', statusLabel(client.status)], ['Contact person', client.contact_person], ['Email', client.email],
    ['Phone', client.phone], ['Billing address', client.billing_address], ['Service address', client.service_address],
    ['GSTIN', client.gstin], ['State code', client.state_code], ['Country', client.country],
    ['Payment terms', `${client.payment_terms_days} days`], ['Notes', client.notes]]
    .map(([label, value]) => `<div class="flex gap-4 px-5 py-2.5">
          <dt class="label-technical w-32 shrink-0">${esc(label)}</dt>
          <dd class="min-w-0 whitespace-pre-wrap text-sm">${esc(value || '—')}</dd></div>`).join('')}
      </dl>`,
  })}
      <div class="lg:col-span-2 space-y-4">
        ${card({
    title: 'Invoices',
    body: invoices.length
      ? `<div class="overflow-x-auto"><table class="data-table w-full min-w-[640px]"><thead><tr>
            <th>Number</th><th>Issued</th><th>Due</th><th class="text-right">Total</th><th class="text-right">Balance</th><th>Status</th></tr></thead>
            <tbody>${invoices.map(row => `<tr>
              <td><a class="font-mono text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent" href="#/invoices/${esc(row.id)}">${esc(row.invoice_number || 'Draft')}</a></td>
              <td class="whitespace-nowrap">${date(row.issue_date)}</td>
              <td class="whitespace-nowrap">${row.due_date ? date(row.due_date) : '—'}</td>
              <td class="num text-right">${money(row.totals.grand_total_minor)}</td>
              <td class="num text-right">${money(row.balance_due_minor)}</td>
              <td>${statusBadge(row.payment_status)}</td></tr>`).join('')}</tbody></table></div>`
      : emptyState({ icon: 'receipt_long', title: 'No invoices', message: 'This client has no invoices yet.' }),
  })}
        ${card({
    title: 'Quotations',
    body: quotations.length
      ? `<div class="overflow-x-auto"><table class="data-table w-full min-w-[560px]"><thead><tr>
            <th>Number</th><th>Title</th><th>Issued</th><th class="text-right">Value</th><th>Status</th></tr></thead>
            <tbody>${quotations.map(row => `<tr>
              <td><a class="font-mono text-xs underline decoration-outline underline-offset-2 hover:decoration-cyan-accent" href="#/quotations/${esc(row.id)}">${esc(row.quotation_number || 'Draft')}</a></td>
              <td class="max-w-[220px] truncate">${esc(row.title)}</td>
              <td class="whitespace-nowrap">${date(row.issue_date)}</td>
              <td class="num text-right">${money(row.totals.grand_total_minor)}</td>
              <td>${statusBadge(row.effective_status)}</td></tr>`).join('')}</tbody></table></div>`
      : emptyState({ icon: 'request_quote', title: 'No quotations', message: 'This client has no quotations yet.' }),
  })}
      </div>
    </div>

    <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
      ${card({ body: `<div class="p-5"><p class="label-technical">Invoiced to date</p><p class="num mt-2 font-headline text-xl font-bold">${money(invoices.reduce((total, row) => total + row.totals.grand_total_minor, 0))}</p></div>` })}
      ${card({ body: `<div class="p-5"><p class="label-technical">Outstanding</p><p class="num mt-2 font-headline text-xl font-bold">${money(outstanding)}</p></div>` })}
      ${card({ body: `<div class="p-5"><p class="label-technical">Badges</p><div class="mt-2 flex flex-wrap gap-2">${client.gst_registered ? badge('GST registered', 'info') : badge('Unregistered', 'neutral')}${client.state_code ? badge(`State ${esc(client.state_code)}`, 'neutral') : ''}</div></div>` })}
    </div>`;

  ctx.on('edit-client', trigger => clientForm(ctx, client));
  ctx.on('toggle-client', async trigger => {
    await api.post(`/api/clients/${client.id}/status`, { status: trigger.dataset.status });
    toast('Client updated.');
    ctx.rerender();
  });
  ctx.on('quotation-for-client', () => ctx.navigate(`#/quotations/new?client_id=${client.id}`));
};
