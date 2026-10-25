import { api } from '../lib/api.js';
import { computeDocument } from '../lib/money.js';
import { printDocument } from '../lib/print.js';
import {
  esc, money, date, words, percent, button, card, field, loading, pageHeader, alertBox, statusBadge,
  toast, modal, closeModal, confirmModal, emptyState, toMajor, parseAmount, toQuantity, parseQuantity,
  titleCase, badge, grid,
} from '../lib/ui.js';

const today = () => new Date().toISOString().slice(0, 10);
const isQuotation = kind => kind === 'QUOTATION';
const endpoint = kind => (isQuotation(kind) ? 'quotations' : 'invoices');

const blankItem = (reference, business = {}) => ({
  product_id: null, description: '', category: '', hsn_sac: '', unit: 'NOS', quantity_milli: 1000,
  unit_price_minor: 0, discount_bp: 0, discount_minor: 0,
  tax_rate_bp: reference?.business?.default_tax_rate_bp ?? 1800, tax_treatment: 'TAXABLE',
});

const blankDocument = (kind, reference) => ({
  client_id: '', title: '', description: '', scope_of_work: '', inclusions: '', exclusions: '',
  assumptions: '', warranty_terms: '', delivery_timeline: '', notes: '',
  terms: isQuotation(kind) ? reference?.business?.quotation_terms || '' : reference?.business?.terms || '',
  issue_date: today(), expiry_date: null, due_date: null, place_of_supply_state_code: '',
  payment_terms_days: reference?.business?.default_payment_terms_days ?? 15,
  payment_terms: isQuotation(kind) ? '' : 'Payment due within the stated terms.',
  po_reference: '', project_reference: '', invoice_discount_bp: 0, invoice_discount_minor: 0,
  round_off_enabled: reference?.business?.rounding_mode !== 'NONE',
  items: [blankItem(reference)], additional_charges: [], milestones: [],
});

const fromRecord = (kind, record, items, milestones = []) => ({
  ...blankDocument(kind, null),
  ...record,
  expiry_date: record.expiry_date || null,
  due_date: record.due_date || null,
  items: items.map(item => ({
    product_id: item.product_id, description: item.description, category: item.category, hsn_sac: item.hsn_sac,
    unit: item.unit, quantity_milli: item.quantity_milli, unit_price_minor: item.unit_price_minor,
    discount_bp: item.discount_bp, discount_minor: item.discount_minor, tax_rate_bp: item.tax_rate_bp,
    tax_treatment: item.tax_treatment,
  })),
  additional_charges: (record.additional_charges || []).map(charge => ({ ...charge })),
  milestones: milestones.map(milestone => ({ ...milestone })),
});

/* ------------------------------------------------------------------- editor */

async function renderEditor(container, params, ctx) {
  const kind = params.kind;
  const list = endpoint(kind);
  container.innerHTML = pageHeader({ title: params.id ? 'Edit document' : 'New document' }) + loading();

  const [clientsResult, productsResult] = await Promise.all([
    api.get('/api/clients?limit=100&status=ACTIVE'),
    api.get('/api/products?limit=100&status=ACTIVE'),
  ]);

  let state;
  let documentId = params.id;
  let record = null;
  if (params.id) {
    const data = await api.get(`/api/${list}/${params.id}`);
    record = isQuotation(kind) ? data.quotation : data.invoice;
    if (record.status !== 'DRAFT') { ctx.navigate(`#/${list}/${params.id}`); return; }
    state = fromRecord(kind, record, data.items, data.milestones);
  } else {
    state = blankDocument(kind, ctx.reference);
    const preselect = params.search?.get('client_id');
    if (preselect) {
      state.client_id = preselect;
      const client = clientsResult.clients.find(row => row.id === preselect);
      if (client?.state_code) state.place_of_supply_state_code = client.state_code;
    }
  }

  const clients = clientsResult.clients;
  const products = productsResult.products;
  const currentClient = () => clients.find(row => row.id === state.client_id);

  const resolveSupply = () => {
    const supplier = ctx.reference.business.state_code;
    const place = state.place_of_supply_state_code || currentClient()?.state_code || '';
    if (supplier && place) return place === supplier ? 'INTRA' : 'INTER';
    return 'INTRA';
  };

  let computed = null;
  const recompute = () => {
    try {
      computed = computeDocument({
        items: state.items,
        additional_charges: state.additional_charges,
        invoice_discount_bp: state.invoice_discount_bp,
        invoice_discount_minor: state.invoice_discount_minor,
        supply_type: resolveSupply(),
        round_off_enabled: state.round_off_enabled,
      });
      return '';
    } catch (error) {
      return error.message;
    }
  };

  const taxOptions = (selected) => ctx.reference.gst_rate_slabs
    .map(slab => `<option value="${slab.bp}" ${Number(selected) === slab.bp ? 'selected' : ''}>${esc(slab.label)}</option>`).join('');
  const clientOptions = () => `<option value="">Select a client…</option>${clients.map(client =>
    `<option value="${esc(client.id)}" ${client.id === state.client_id ? 'selected' : ''}>${esc(client.name)}${client.company_name ? ` · ${esc(client.company_name)}` : ''}</option>`).join('')}`;
  const stateOptions = () => `<option value="">Not selected</option>${ctx.reference.states
    .map(s => `<option value="${esc(s.code)}" ${s.code === state.place_of_supply_state_code ? 'selected' : ''}>${esc(s.code)} · ${esc(s.name)}</option>`).join('')}`;

  const itemsTable = () => `
    <div class="overflow-x-auto">
      <table class="w-full min-w-[1180px] text-sm">
        <thead>
          <tr class="label-technical border-b border-outline">
            <th class="w-8 py-2 text-left">#</th>
            <th class="py-2 text-left">Description</th>
            <th class="w-24 py-2 text-left">HSN/SAC</th>
            <th class="w-20 py-2 text-right">Qty</th>
            <th class="w-16 py-2 text-left">Unit</th>
            <th class="w-28 py-2 text-right">Rate ₹</th>
            <th class="w-20 py-2 text-right">Disc %</th>
            <th class="w-24 py-2 text-right">Disc ₹</th>
            <th class="w-32 py-2 text-left">Tax</th>
            <th class="w-28 py-2 text-left">GST</th>
            <th class="w-28 py-2 text-right">Taxable</th>
            <th class="w-28 py-2 text-right">GST ₹</th>
            <th class="w-28 py-2 text-right">Amount</th>
            <th class="w-24 py-2"></th>
          </tr>
        </thead>
        <tbody id="items-body">
          ${state.items.map((item, index) => `
            <tr class="border-b border-outline align-top" data-row="${index}">
              <td class="py-2 text-xs text-on-surface-variant">${index + 1}</td>
              <td class="py-2"><textarea rows="2" data-item="${index}" data-field="description" placeholder="What is being delivered"
                  class="field min-w-[200px] text-sm">${esc(item.description)}</textarea></td>
              <td class="py-2"><input data-item="${index}" data-field="hsn_sac" value="${esc(item.hsn_sac)}" class="field text-xs" placeholder="998314"></td>
              <td class="py-2"><input data-item="${index}" data-field="quantity_milli" value="${esc(toQuantity(item.quantity_milli))}"
                  inputmode="decimal" class="field text-right text-sm"></td>
              <td class="py-2"><input data-item="${index}" data-field="unit" value="${esc(item.unit)}" class="field text-xs"></td>
              <td class="py-2"><input data-item="${index}" data-field="unit_price_minor" value="${esc(toMajor(item.unit_price_minor))}"
                  inputmode="decimal" class="field text-right text-sm"></td>
              <td class="py-2"><input data-item="${index}" data-field="discount_bp" value="${esc(item.discount_bp ? item.discount_bp / 100 : '')}"
                  inputmode="decimal" class="field text-right text-sm" placeholder="0"></td>
              <td class="py-2"><input data-item="${index}" data-field="discount_minor" value="${item.discount_minor ? esc(toMajor(item.discount_minor)) : ''}"
                  inputmode="decimal" class="field text-right text-sm" placeholder="0.00"></td>
              <td class="py-2"><select data-item="${index}" data-field="tax_treatment" class="field text-xs">
                  ${ctx.reference.tax_treatments.map(treatment =>
    `<option value="${treatment}" ${item.tax_treatment === treatment ? 'selected' : ''}>${esc(titleCase(treatment))}</option>`).join('')}
                </select></td>
              <td class="py-2"><select data-item="${index}" data-field="tax_rate_bp" class="field text-xs"
                  ${item.tax_treatment !== 'TAXABLE' ? 'disabled' : ''}>${taxOptions(item.tax_rate_bp)}</select></td>
              <td class="num py-3 text-right" id="row-taxable-${index}">—</td>
              <td class="num py-3 text-right" id="row-tax-${index}">—</td>
              <td class="num py-3 text-right font-medium" id="row-total-${index}">—</td>
              <td class="py-2 text-right whitespace-nowrap">
                <button type="button" data-action="item-up" data-index="${index}" class="text-on-surface-variant hover:text-on-surface" title="Move up">${'↑'}</button>
                <button type="button" data-action="item-down" data-index="${index}" class="ml-1 text-on-surface-variant hover:text-on-surface" title="Move down">${'↓'}</button>
                <button type="button" data-action="item-duplicate" data-index="${index}" class="ml-1 text-xs underline decoration-outline underline-offset-2">Copy</button>
                <button type="button" data-action="item-remove" data-index="${index}" class="ml-1 text-xs text-red-700 underline underline-offset-2">Remove</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  const chargesTable = () => (state.additional_charges.length ? `
    <div class="overflow-x-auto">
      <table class="w-full min-w-[720px] text-sm">
        <tbody>
          ${state.additional_charges.map((charge, index) => `<tr class="border-b border-outline">
            <td class="w-64 py-2"><input data-charge="${index}" data-field="label" value="${esc(charge.label)}" placeholder="Delivery, handling…" class="field text-sm"></td>
            <td class="w-32 py-2"><input data-charge="${index}" data-field="amount_minor" value="${esc(toMajor(charge.amount_minor))}" inputmode="decimal" class="field text-right text-sm"></td>
            <td class="w-40 py-2"><select data-charge="${index}" data-field="tax_treatment" class="field text-xs">
              ${ctx.reference.tax_treatments.map(treatment => `<option value="${treatment}" ${charge.tax_treatment === treatment ? 'selected' : ''}>${esc(titleCase(treatment))}</option>`).join('')}
            </select></td>
            <td class="w-32 py-2"><select data-charge="${index}" data-field="tax_rate_bp" class="field text-xs"
              ${charge.tax_treatment !== 'TAXABLE' ? 'disabled' : ''}>${taxOptions(charge.tax_rate_bp)}</select></td>
            <td class="py-2 text-right"><button type="button" data-action="charge-remove" data-index="${index}"
              class="text-xs text-red-700 underline underline-offset-2">Remove</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '<p class="px-5 py-4 text-sm text-on-surface-variant">No additional charges.</p>');

  const milestonesTable = () => (state.milestones.length ? `
    <div class="overflow-x-auto">
      <table class="w-full min-w-[820px] text-sm">
        <thead><tr class="label-technical border-b border-outline">
          <th class="py-2 text-left">Milestone</th><th class="w-32 py-2 text-right">Share %</th>
          <th class="w-32 py-2 text-right">Amount ₹</th><th class="w-28 py-2 text-right">Due in days</th><th class="w-20 py-2"></th>
        </tr></thead>
        <tbody>
          ${state.milestones.map((milestone, index) => `<tr class="border-b border-outline">
            <td class="py-2"><input data-milestone="${index}" data-field="title" value="${esc(milestone.title)}"
              placeholder="Advance payment, development milestone…" class="field text-sm"></td>
            <td class="py-2"><input data-milestone="${index}" data-field="share_bp" value="${esc(milestone.share_bp ? milestone.share_bp / 100 : '')}"
              inputmode="decimal" class="field text-right text-sm"></td>
            <td class="py-2"><input data-milestone="${index}" data-field="amount_minor" value="${esc(toMajor(milestone.amount_minor))}"
              inputmode="decimal" class="field text-right text-sm" ${milestone.share_bp ? 'disabled' : ''}></td>
            <td class="py-2"><input data-milestone="${index}" data-field="due_offset_days" value="${esc(String(milestone.due_offset_days || 0))}"
              inputmode="numeric" class="field text-right text-sm"></td>
            <td class="py-2 text-right"><button type="button" data-action="milestone-remove" data-index="${index}"
              class="text-xs text-red-700 underline underline-offset-2">Remove</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '<p class="px-5 py-4 text-sm text-on-surface-variant">No milestones. Add them for milestone-billed project work.</p>');

  const totalsPanel = () => {
    const totals = computed?.totals || {};
    const problem = recompute();
    return `
    <div class="border-t border-outline px-5 py-4">
      ${problem ? alertBox(problem, 'warn') : ''}
      <dl class="ml-auto max-w-md text-sm">
        ${[
    ['Subtotal', totals.gross_total_minor],
    ['Discount', (totals.item_discount_total_minor || 0) + (totals.invoice_discount_total_minor || 0) ? -((totals.item_discount_total_minor || 0) + (totals.invoice_discount_total_minor || 0)) : 0],
    ['Taxable value', totals.taxable_total_minor],
    ...(totals.cgst_total_minor ? [['CGST', totals.cgst_total_minor]] : []),
    ...(totals.sgst_total_minor ? [['SGST', totals.sgst_total_minor]] : []),
    ...(totals.igst_total_minor ? [['IGST', totals.igst_total_minor]] : []),
    ['Additional charges', (state.additional_charges || []).reduce((total, charge) => total + charge.amount_minor, 0)],
    ['Round off', totals.round_off_minor],
  ].filter(([, value]) => value !== 0 && value !== undefined).map(([label, value]) =>
    `<div class="flex justify-between border-b border-outline py-1.5"><dt class="text-on-surface-variant">${esc(label)}</dt><dd class="num">${money(value)}</dd></div>`).join('')}
        <div class="flex justify-between py-2 font-semibold"><dt>Grand total</dt><dd class="num">${money(totals.grand_total_minor || 0)}</dd></div>
      </dl>
      <p class="mt-3 text-xs text-on-surface-variant">Amount in words: <span class="font-medium">${esc(words(totals.grand_total_minor || 0))}</span></p>
      <p class="mt-2 text-xs text-on-surface-variant">Live preview only. The server recalculates every total on save, and the stored values are what the PDF and reports use.</p>
    </div>`;
  };

  const itemComputedCells = () => {
    state.items.forEach((item, index) => {
      const line = computed?.lines?.[index];
      const set = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
      set(`row-taxable-${index}`, line ? money(line.taxable_minor) : '—');
      set(`row-tax-${index}`, line ? (line.tax_minor ? money(line.tax_minor) : '—') : '—');
      set(`row-total-${index}`, line ? money(line.total_minor) : '—');
    });
  };

  const refresh = () => {
    itemComputedCells();
    const panel = container.querySelector('#totals-panel');
    if (panel) panel.innerHTML = totalsPanel();
  };

  container.innerHTML = `
    ${pageHeader({
    title: params.id ? `Edit ${isQuotation(kind) ? 'quotation' : 'invoice'}` : `New ${isQuotation(kind) ? 'quotation' : 'invoice'}`,
    breadcrumb: `<a class="hover:text-on-surface" href="#/${list}">${isQuotation(kind) ? 'Quotations' : 'Invoices'}</a> / ${record ? esc(record.quotation_number || record.invoice_number || 'Draft') : 'New'}`,
    subtitle: 'Totals and taxes are calculated exactly as the server will store them.',
    actions: `${button({ label: 'Cancel', action: 'back-to-list' })}
      ${documentId ? button({ label: 'Preview PDF', action: 'preview-pdf', attributes: `data-id="${esc(documentId)}"` }) : ''}
      ${button({ label: 'Save draft', action: 'save-draft', variant: 'primary' })}
      ${button({ label: isQuotation(kind) ? 'Save and send' : 'Save and issue', action: 'save-submit', variant: 'accent' })}`,
  })}
    <div id="editor-errors" class="mb-4 space-y-2"></div>

    <form id="document-form" class="space-y-4">
      ${card({
    title: 'Client and dates',
    body: `<div class="px-5 py-4">${grid(`
        ${field({ label: 'Client', name: 'client_id', options: [], className: 'sm:col-span-2', id: 'client-select' })}
        ${field({ label: isQuotation(kind) ? 'Quotation title' : 'Invoice title', name: 'title', value: state.title, required: isQuotation(kind), hint: isQuotation(kind) ? 'Shown on the document.' : 'Optional internal label.' })}
        ${field({ label: 'Issue date', name: 'issue_date', type: 'date', value: state.issue_date, required: true })}
        ${isQuotation(kind)
    ? field({ label: 'Valid until', name: 'expiry_date', type: 'date', value: state.expiry_date || '' })
    : field({ label: 'Due date', name: 'due_date', type: 'date', value: state.due_date || '', hint: 'Leave empty to use the payment terms below.' })}
        ${field({ label: 'Place of supply', name: 'place_of_supply_state_code', options: [], id: 'place-of-supply', hint: 'Required whenever a line is taxable. It decides CGST/SGST or IGST.' })}
        ${field({ label: 'Payment terms (days)', name: 'payment_terms_days', type: 'number', min: '0', max: '365', value: String(state.payment_terms_days) })}
        ${isQuotation(kind)
    ? ''
    : field({ label: 'Purchase order reference', name: 'po_reference', value: state.po_reference })}
        ${field({ label: 'Project reference', name: 'project_reference', value: state.project_reference })}
      `, 4)}</div>`,
  })}

      ${card({
    title: 'Line items',
    subtitle: 'Select a catalog entry to add a prefilled line, or add a blank line.',
    actions: `
        <select id="catalog-picker" class="field w-64 text-sm"><option value="">Add from catalog…</option>
          ${products.map(product => `<option value="${esc(product.id)}">${esc(product.name)} · ${money(product.unit_price_minor)}</option>`).join('')}
        </select>
        ${button({ label: 'Add blank line', action: 'item-add', icon: 'add' })}`,
    body: itemsTable(),
  })}

      ${card({ title: 'Totals', body: `<div id="totals-panel">${totalsPanel()}</div>` })}

      ${card({
    title: 'Additional charges',
    subtitle: 'Delivery, handling or reimbursements billed on top of the line items.',
    actions: button({ label: 'Add charge', action: 'charge-add' }),
    body: `<div id="charge-host">${chargesTable()}</div>`,
  })}

      ${card({
    title: 'Invoice-level discount and rounding',
    body: `<div class="px-5 py-4">${grid(`
        ${field({ label: 'Discount %', name: 'invoice_discount_bp', type: 'number', step: '0.01', min: '0', max: '100', value: state.invoice_discount_bp ? String(state.invoice_discount_bp / 100) : '' })}
        ${field({ label: 'or fixed discount ₹', name: 'invoice_discount_minor', type: 'number', step: '0.01', min: '0', value: state.invoice_discount_minor ? toMajor(state.invoice_discount_minor) : '' })}
        ${field({ label: 'Round off', name: 'round_off_enabled', options: [
    { value: 'true', label: 'Round the total to the nearest rupee' }, { value: 'false', label: 'Keep the exact total' },
  ], value: String(state.round_off_enabled) })}
      `, 3)}
      <p class="mt-2 text-xs text-on-surface-variant">A full-amount invoice discount is allocated across lines proportionally so the tax split stays correct and no paisa is lost.</p></div>`,
  })}

      ${card({
    title: isQuotation(kind) ? 'Project details, scope and terms' : 'Notes and terms',
    body: `<div class="px-5 py-4">${grid(`
        ${field({ label: 'Description', name: 'description', type: 'textarea', value: state.description, className: 'sm:col-span-2' })}
        ${field({ label: 'Scope of work', name: 'scope_of_work', type: 'textarea', value: state.scope_of_work })}
        ${field({ label: 'Delivery timeline', name: 'delivery_timeline', type: 'textarea', value: state.delivery_timeline })}
        ${field({ label: 'Inclusions', name: 'inclusions', type: 'textarea', value: state.inclusions })}
        ${field({ label: 'Exclusions', name: 'exclusions', type: 'textarea', value: state.exclusions })}
        ${field({ label: 'Assumptions', name: 'assumptions', type: 'textarea', value: state.assumptions })}
        ${field({ label: 'Warranty and support', name: 'warranty_terms', type: 'textarea', value: state.warranty_terms })}
        ${field({ label: 'Payment terms', name: 'payment_terms', type: 'textarea', value: state.payment_terms })}
        ${field({ label: 'Notes and instructions', name: 'notes', type: 'textarea', value: state.notes })}
        ${field({ label: 'Terms and conditions', name: 'terms', type: 'textarea', value: state.terms, className: 'sm:col-span-2' })}
      `, 2)}</div>`,
  })}

      ${isQuotation(kind) ? card({
    title: 'Payment milestones',
    subtitle: 'Use shares for percentage billing, or fixed amounts when the schedule is already agreed.',
    actions: button({ label: 'Add milestone', action: 'milestone-add' }),
    body: `<div id="milestone-host">${milestonesTable()}</div>
      <div class="border-t border-outline px-5 py-3 text-xs text-on-surface-variant">
        Shares must add up to 100% or less. Amounts are derived from the grand total whenever shares are used.</div>`,
  }) : ''}
    </form>`;

  // Client and place-of-supply selects are filled after mount so their change
  // handlers can update the preview without re-rendering the form.
  container.querySelector('#client-select').innerHTML = clientOptions();
  container.querySelector('#place-of-supply').innerHTML = stateOptions();

  ctx.on('back-to-list', () => ctx.navigate(`#/${list}`));
  ctx.on('item-add', () => { state.items.push(blankItem(ctx.reference)); rerenderItems(); });
  ctx.on('item-remove', trigger => {
    if (state.items.length === 1) { toast('A document needs at least one line item.', 'danger'); return; }
    state.items.splice(Number(trigger.dataset.index), 1); rerenderItems();
  });
  ctx.on('item-duplicate', trigger => {
    state.items.splice(Number(trigger.dataset.index) + 1, 0, { ...state.items[Number(trigger.dataset.index)] });
    rerenderItems();
  });
  ctx.on('item-up', trigger => {
    const index = Number(trigger.dataset.index);
    if (index === 0) return;
    [state.items[index - 1], state.items[index]] = [state.items[index], state.items[index - 1]];
    rerenderItems();
  });
  ctx.on('item-down', trigger => {
    const index = Number(trigger.dataset.index);
    if (index >= state.items.length - 1) return;
    [state.items[index + 1], state.items[index]] = [state.items[index], state.items[index + 1]];
    rerenderItems();
  });
  ctx.on('charge-add', () => {
    state.additional_charges.push({ label: '', amount_minor: 0, tax_rate_bp: 0, tax_treatment: 'TAXABLE' });
    rerenderCharges();
  });
  ctx.on('charge-remove', trigger => { state.additional_charges.splice(Number(trigger.dataset.index), 1); rerenderCharges(); });
  ctx.on('milestone-add', () => {
    state.milestones.push({ title: '', description: '', share_bp: 0, amount_minor: 0, due_offset_days: 0 });
    rerenderMilestones();
  });
  ctx.on('milestone-remove', trigger => { state.milestones.splice(Number(trigger.dataset.index), 1); rerenderMilestones(); });
  ctx.on('save-draft', () => save(false));
  ctx.on('save-submit', () => save(true));
  ctx.on('preview-pdf', trigger => api.openDocument(`/api/${list}/${trigger.dataset.id || documentId}/pdf?view=1`));

  // The desktop shell asks before closing a window that has unsaved edits.
  const markChanged = () => { globalThis.window?.electronAPI?.setUnsavedChanges?.(true); };
  const markSaved = () => { globalThis.window?.electronAPI?.setUnsavedChanges?.(false); };
  container.addEventListener('change', markChanged);

  const replaceTable = (selector, markup) => {
    const node = container.querySelector(selector);
    if (!node) return;
    (node.closest('div') || node).outerHTML = markup;
  };
  function rerenderItems() {
    replaceTable('#items-body', itemsTable());
    recompute();
    refresh();
  }
  function rerenderCharges() {
    const host = container.querySelector('#charge-host');
    if (host) host.innerHTML = chargesTable();
    refresh();
  }
  function rerenderMilestones() {
    const host = container.querySelector('#milestone-host');
    if (host) host.innerHTML = milestonesTable();
    refresh();
  }

  function collectForm() {
    const form = new FormData(container.querySelector('#document-form'));
    const text = name => String(form.get(name) || '').trim();
    return {
      client_id: String(form.get('client_id') || ''),
      title: text('title'),
      description: String(form.get('description') || ''),
      scope_of_work: String(form.get('scope_of_work') || ''),
      inclusions: String(form.get('inclusions') || ''),
      exclusions: String(form.get('exclusions') || ''),
      assumptions: String(form.get('assumptions') || ''),
      warranty_terms: String(form.get('warranty_terms') || ''),
      delivery_timeline: String(form.get('delivery_timeline') || ''),
      notes: String(form.get('notes') || ''),
      terms: String(form.get('terms') || ''),
      issue_date: text('issue_date'),
      expiry_date: isQuotation(kind) ? (text('expiry_date') || null) : null,
      due_date: isQuotation(kind) ? null : (text('due_date') || null),
      place_of_supply_state_code: text('place_of_supply_state_code'),
      payment_terms_days: Number(form.get('payment_terms_days') || 0),
      payment_terms: String(form.get('payment_terms') || ''),
      po_reference: text('po_reference'),
      project_reference: text('project_reference'),
      invoice_discount_bp: Math.round((Number(form.get('invoice_discount_bp') || 0) || 0) * 100),
      invoice_discount_minor: parseAmount(form.get('invoice_discount_minor')),
      round_off_enabled: String(form.get('round_off_enabled')) === 'true',
      items: state.items,
      // Empty helper rows are dropped so the server only sees real charges and milestones.
      additional_charges: state.additional_charges.filter(charge => charge.label.trim() && charge.amount_minor > 0),
      milestones: state.milestones.filter(milestone => milestone.title.trim()),
    };
  }

  async function save(thenSubmit) {
    recompute();
    const payload = collectForm();
    const errors = [];
    if (!payload.client_id) errors.push('Select a client.');
    if (isQuotation(kind) && !payload.title) errors.push('Give the quotation a title.');
    if (!payload.items.some(item => item.description.trim())) errors.push('Add at least one line item with a description.');
    if (payload.items.some(item => !item.quantity_milli)) errors.push('Every line item needs a quantity greater than zero.');
    const errorHost = container.querySelector('#editor-errors');
    if (errors.length) {
      errorHost.innerHTML = alertBox(errors.join(' '), 'danger');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    errorHost.innerHTML = '';
    try {
      const result = documentId
        ? await api.patch(`/api/${list}/${documentId}`, payload)
        : await api.post(`/api/${list}`, payload);
      const created = result.quotation || result.invoice;
      documentId = created.id;
      markSaved();
      if (!thenSubmit) {
        toast('Draft saved.');
        ctx.navigate(`#/${list}/${documentId}/edit`);
        return;
      }
      if (isQuotation(kind)) {
        const sent = await api.post(`/api/quotations/${documentId}/send`);
        toast(`Quotation ${sent.quotation.quotation_number} sent.`);
        ctx.navigate(`#/quotations/${documentId}`);
      } else {
        const issued = await api.post(`/api/invoices/${documentId}/issue`);
        toast(`Invoice ${issued.invoice.invoice_number} issued.`);
        ctx.navigate(`#/invoices/${documentId}`);
      }
    } catch (error) {
      const details = error.fields?.length
        ? error.fields.map(item => `${item.field || 'form'}: ${item.message}`).join(' · ')
        : error.message;
      errorHost.innerHTML = alertBox(details, 'danger');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // Keep the catalog picker working after the items table is re-rendered.
  container.addEventListener('change', event => {
    const picker = event.target.closest('#catalog-picker');
    if (picker && picker.value) {
      const product = products.find(row => row.id === picker.value);
      if (product) {
        const last = state.items[state.items.length - 1];
        const reuseBlank = last && !last.description && !last.unit_price_minor;
        const item = {
          product_id: product.id, description: product.name, category: product.category, hsn_sac: product.hsn_sac,
          unit: product.unit, quantity_milli: 1000, unit_price_minor: product.unit_price_minor,
          discount_bp: 0, discount_minor: 0, tax_rate_bp: product.tax_rate_bp, tax_treatment: product.tax_treatment,
        };
        if (reuseBlank) state.items[state.items.length - 1] = item;
        else state.items.push(item);
        picker.value = '';
        rerenderItems();
      }
      return;
    }
    const client = event.target.closest('#client-select');
    if (client) {
      state.client_id = client.value;
      const chosen = clients.find(row => row.id === client.value);
      if (chosen?.state_code) {
        state.place_of_supply_state_code = chosen.state_code;
        container.querySelector('#place-of-supply').innerHTML = stateOptions();
      }
      recompute();
      refresh();
      return;
    }
    const place = event.target.closest('#place-of-supply');
    if (place) {
      state.place_of_supply_state_code = place.value;
      recompute();
      refresh();
    }
  });

  container.addEventListener('input', event => {
    markChanged();
    const itemTarget = event.target.closest('[data-item]');
    if (itemTarget) {
      const index = Number(itemTarget.dataset.item);
      const field = itemTarget.dataset.field;
      const item = state.items[index];
      if (field === 'description' || field === 'unit' || field === 'hsn_sac') item[field] = itemTarget.value;
      else if (field === 'quantity_milli') item.quantity_milli = parseQuantity(itemTarget.value);
      else if (field === 'unit_price_minor') item.unit_price_minor = parseAmount(itemTarget.value);
      else if (field === 'discount_bp') item.discount_bp = Math.round((Number(itemTarget.value) || 0) * 100);
      else if (field === 'discount_minor') item.discount_minor = parseAmount(itemTarget.value);
      recompute();
      refresh();
      return;
    }
    const chargeTarget = event.target.closest('[data-charge]');
    if (chargeTarget) {
      const index = Number(chargeTarget.dataset.charge);
      const field = chargeTarget.dataset.field;
      const charge = state.additional_charges[index];
      if (field === 'label') charge.label = chargeTarget.value;
      else if (field === 'amount_minor') charge.amount_minor = parseAmount(chargeTarget.value);
      recompute();
      refresh();
      return;
    }
    const milestoneTarget = event.target.closest('[data-milestone]');
    if (milestoneTarget) {
      const index = Number(milestoneTarget.dataset.milestone);
      const field = milestoneTarget.dataset.field;
      const milestone = state.milestones[index];
      if (field === 'title') milestone.title = milestoneTarget.value;
      else if (field === 'share_bp') milestone.share_bp = Math.round((Number(milestoneTarget.value) || 0) * 100);
      else if (field === 'amount_minor') milestone.amount_minor = parseAmount(milestoneTarget.value);
      else if (field === 'due_offset_days') milestone.due_offset_days = Number(milestoneTarget.value) || 0;
      return;
    }
    if (['invoice_discount_bp', 'invoice_discount_minor', 'round_off_enabled'].includes(event.target.name)) {
      const form = new FormData(container.querySelector('#document-form'));
      state.invoice_discount_bp = Math.round((Number(form.get('invoice_discount_bp')) || 0) * 100);
      state.invoice_discount_minor = parseAmount(form.get('invoice_discount_minor'));
      state.round_off_enabled = String(form.get('round_off_enabled')) === 'true';
      recompute();
      refresh();
    }
  });

  container.addEventListener('change', event => {
    const itemTarget = event.target.closest('[data-item]');
    if (itemTarget && ['tax_treatment', 'tax_rate_bp'].includes(itemTarget.dataset.field)) {
      const index = Number(itemTarget.dataset.item);
      const item = state.items[index];
      if (itemTarget.dataset.field === 'tax_treatment') {
        item.tax_treatment = itemTarget.value;
        if (item.tax_treatment !== 'TAXABLE') item.tax_rate_bp = 0;
      } else {
        item.tax_rate_bp = Number(itemTarget.value);
      }
      rerenderItems();
      return;
    }
    const chargeTarget = event.target.closest('[data-charge]');
    if (chargeTarget && ['tax_treatment', 'tax_rate_bp'].includes(chargeTarget.dataset.field)) {
      const index = Number(chargeTarget.dataset.charge);
      const charge = state.additional_charges[index];
      if (chargeTarget.dataset.field === 'tax_treatment') {
        charge.tax_treatment = chargeTarget.value;
        if (charge.tax_treatment !== 'TAXABLE') charge.tax_rate_bp = 0;
      } else charge.tax_rate_bp = Number(chargeTarget.value);
      rerenderCharges();
      return;
    }
    if (['invoice_discount_bp', 'invoice_discount_minor', 'round_off_enabled'].includes(event.target.name)) {
      const form = new FormData(container.querySelector('#document-form'));
      state.invoice_discount_bp = Math.round((Number(form.get('invoice_discount_bp')) || 0) * 100);
      state.invoice_discount_minor = parseAmount(form.get('invoice_discount_minor'));
      state.round_off_enabled = String(form.get('round_off_enabled')) === 'true';
      recompute();
      refresh();
    }
  });

  recompute();
  refresh();
}

/* ------------------------------------------------------------------- detail */

async function renderDetail(container, params, ctx) {
  const kind = params.kind;
  const list = endpoint(kind);
  container.innerHTML = pageHeader({ title: 'Document' }) + loading();

  let data;
  try {
    data = await api.get(`/api/${list}/${params.id}`);
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Document' }) + alertBox(error.message, 'danger');
    return;
  }

  const record = isQuotation(kind) ? data.quotation : data.invoice;
  const items = data.items;
  const totals = record.totals || {};
  const status = isQuotation(kind) ? record.status : data.payment_status;
  const number = isQuotation(kind) ? record.quotation_number : record.invoice_number;
  let pendingId = null;

  const itemsRows = items.map((item, index) => `<tr class="border-b border-outline">
      <td class="py-2 text-xs text-on-surface-variant">${index + 1}</td>
      <td class="py-2">${esc(item.description)}
        ${item.hsn_sac ? `<div class="font-mono text-[10px] text-on-surface-variant">HSN/SAC ${esc(item.hsn_sac)}</div>` : ''}
        ${item.tax_treatment !== 'TAXABLE' ? `<div class="text-[10px] uppercase text-on-surface-variant">${esc(titleCase(item.tax_treatment))}</div>` : ''}</td>
      <td class="num py-2 text-right">${esc(toQuantity(item.quantity_milli))} ${esc(item.unit)}</td>
      <td class="num py-2 text-right">${money(item.unit_price_minor)}</td>
      <td class="num py-2 text-right">${item.item_discount_minor + item.invoice_discount_minor ? money(item.item_discount_minor + item.invoice_discount_minor) : '—'}</td>
      <td class="num py-2 text-right">${money(item.taxable_minor)}</td>
      <td class="num py-2 text-right">${item.tax_minor ? `${percent(item.tax_rate_bp)} · ${money(item.tax_minor)}` : '—'}</td>
      <td class="num py-2 text-right font-medium">${money(item.total_minor)}</td>
    </tr>`).join('');

  const totalsRows = [
    ['Subtotal', totals.gross_total_minor],
    ['Discount', -((totals.item_discount_total_minor || 0) + (totals.invoice_discount_total_minor || 0))],
    ['Taxable value', totals.taxable_total_minor],
    ['CGST', totals.cgst_total_minor], ['SGST', totals.sgst_total_minor], ['IGST', totals.igst_total_minor],
    ['Round off', totals.round_off_minor],
  ].filter(([, value]) => value);

  const paymentsPanel = isQuotation(kind) ? '' : card({
    title: 'Payments and receipts',
    subtitle: 'Payments are append-only. Correct a mistake with a credit note.',
    actions: record.status === 'ISSUED' && data.balance_due_minor > 0
      ? button({ label: 'Record payment', action: 'record-payment', variant: 'primary' }) : '',
    body: data.payments.length
      ? `<div class="overflow-x-auto"><table class="data-table w-full min-w-[680px]">
          <thead><tr><th>Receipt</th><th>Paid on</th><th>Method</th><th>Reference</th><th class="text-right">Amount</th><th></th></tr></thead>
          <tbody>${data.payments.map(payment => `<tr>
            <td class="font-mono text-xs">${esc(payment.receipt_number)}</td>
            <td>${date(payment.paid_on)}</td>
            <td class="text-xs">${esc(titleCase(payment.method))}</td>
            <td class="text-xs">${esc(payment.reference || '—')}</td>
            <td class="num text-right">${money(payment.amount_minor)}</td>
            <td class="whitespace-nowrap text-right">
              <button type="button" data-action="receipt-view" data-id="${esc(payment.id)}" class="text-xs underline decoration-outline underline-offset-2">Receipt</button>
              <button type="button" data-action="receipt-download" data-id="${esc(payment.id)}" class="ml-2 text-xs underline decoration-outline underline-offset-2">Download</button>
            </td></tr>`).join('')}</tbody></table></div>`
      : '<p class="px-5 py-4 text-sm text-on-surface-variant">No payments recorded against this invoice.</p>',
  });

  const notesPanel = isQuotation(kind) ? '' : card({
    title: 'Credit and debit notes',
    actions: record.status === 'ISSUED' ? button({ label: 'Issue credit note', action: 'credit-note' }) : '',
    body: data.adjustment_notes.length
      ? `<div class="overflow-x-auto"><table class="data-table w-full min-w-[560px]">
          <thead><tr><th>Number</th><th>Issued</th><th>Reason</th><th class="text-right">Value</th><th></th></tr></thead>
          <tbody>${data.adjustment_notes.map(note => `<tr>
            <td class="font-mono text-xs">${esc(note.note_number)}</td>
            <td>${date(note.issue_date)}</td>
            <td class="max-w-[280px] text-xs">${esc(note.reason)}</td>
            <td class="num text-right">${money(note.totals.grand_total_minor)}</td>
            <td class="text-right"><button type="button" data-action="note-pdf" data-id="${esc(note.id)}" class="text-xs underline decoration-outline underline-offset-2">PDF</button></td>
          </tr>`).join('')}</tbody></table></div>`
      : '<p class="px-5 py-4 text-sm text-on-surface-variant">No adjustment notes.</p>',
  });

  const historyPanel = card({
    title: 'History',
    body: `<ol class="divide-y divide-outline">${data.history.map(entry => `<li class="flex flex-wrap items-baseline gap-2 px-5 py-2.5 text-xs">
        <span class="font-mono">${esc(entry.created_at.slice(0, 19).replace('T', ' '))}</span>
        <span class="font-medium">${esc(entry.from_status ? `${entry.from_status} → ${entry.to_status}` : entry.to_status)}</span>
        ${entry.note ? `<span class="text-on-surface-variant">${esc(entry.note)}</span>` : ''}
      </li>`).join('')}</ol>`,
  });

  const actions = [];
  if (record.status === 'DRAFT') {
    actions.push(button({ label: 'Edit draft', action: 'edit-document' }));
    actions.push(button({ label: isQuotation(kind) ? 'Send quotation' : 'Issue invoice', action: 'submit-document', variant: 'primary' }));
  }
  actions.push(button({ label: 'Preview PDF', action: 'preview-pdf' }));
  actions.push(button({ label: 'Download PDF', action: 'download-pdf' }));
  actions.push(button({ label: 'Print', action: 'print-document' }));
  if (isQuotation(kind)) {
    if (record.status === 'SENT') {
      actions.push(button({ label: 'Record acceptance', action: 'transition', attributes: 'data-target="ACCEPTED"' }));
      actions.push(button({ label: 'Record rejection', action: 'transition', attributes: 'data-target="REJECTED"' }));
    }
    if (record.status === 'ACCEPTED' && !record.converted_invoice_id) {
      actions.push(button({ label: 'Convert to invoice', action: 'convert', variant: 'accent' }));
    }
    actions.push(button({ label: 'Duplicate', action: 'duplicate' }));
    if (['DRAFT', 'SENT'].includes(record.status)) actions.push(button({ label: 'Cancel', action: 'cancel-quotation', variant: 'danger' }));
  } else {
    if (record.status === 'ISSUED' && data.balance_due_minor > 0) {
      actions.push(button({ label: 'Record payment', action: 'record-payment', variant: 'primary' }));
    }
    if (record.status === 'ISSUED' && data.payments.length === 0) {
      actions.push(button({ label: 'Cancel invoice', action: 'cancel-invoice', variant: 'danger' }));
    }
  }

  container.innerHTML = `
    ${pageHeader({
    title: isQuotation(kind) ? (record.title || 'Quotation') : (record.title || 'Tax invoice'),
    breadcrumb: `<a class="hover:text-on-surface" href="#/${list}">${isQuotation(kind) ? 'Quotations' : 'Invoices'}</a> / ${esc(number || 'Draft')}`,
    subtitle: isQuotation(kind)
      ? 'An accepted quotation is a commercial agreement, not a payment.'
      : 'Issued amounts, taxes and customer details are frozen in the stored snapshot.',
    actions: actions.join(''),
  })}

    <div class="mb-4 flex flex-wrap items-center gap-2">
      ${statusBadge(status)}
      ${record.status === 'DRAFT' ? badge('Not yet numbered', 'warn') : badge(number, 'neutral')}
      ${isQuotation(kind) && record.converted_invoice_id ? badge('Converted to invoice', 'success') : ''}
      ${record.supply_type ? badge(record.supply_type === 'INTER' ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)', 'neutral') : ''}
    </div>

    <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div class="space-y-4 xl:col-span-2">
        ${card({
    title: 'Line items',
    body: `<div class="overflow-x-auto"><table class="w-full min-w-[900px] text-sm">
        <thead><tr class="label-technical border-b border-outline">
          <th class="w-8 py-2 text-left">#</th><th class="py-2 text-left">Description</th>
          <th class="py-2 text-right">Qty</th><th class="py-2 text-right">Rate</th><th class="py-2 text-right">Discount</th>
          <th class="py-2 text-right">Taxable</th><th class="py-2 text-right">GST</th><th class="py-2 text-right">Amount</th>
        </tr></thead><tbody>${itemsRows}</tbody></table></div>
      ${(record.additional_charges || []).length ? `<div class="border-t border-outline px-5 py-3">
        <p class="label-technical mb-2">Additional charges</p>
        ${record.additional_charges.map(charge => `<div class="flex justify-between text-sm">
          <span>${esc(charge.label)}${charge.tax_minor ? ` <span class="text-xs text-on-surface-variant">(${esc(percent(charge.tax_rate_bp))} GST)</span>` : ''}</span>
          <span class="num">${money(charge.total_minor)}</span></div>`).join('')}
      </div>` : ''}`,
  })}

        ${data.milestones?.length ? card({
    title: 'Payment milestones',
    body: `<ul class="divide-y divide-outline">${data.milestones.map(milestone => `<li class="flex items-baseline justify-between gap-4 px-5 py-3">
          <div><p class="text-sm font-medium">${esc(milestone.title)}</p>
            ${milestone.description ? `<p class="text-xs text-on-surface-variant">${esc(milestone.description)}</p>` : ''}</div>
          <div class="text-right"><p class="num text-sm">${money(milestone.amount_minor)}</p>
            <p class="text-xs text-on-surface-variant">${esc(percent(milestone.share_bp))} · ${milestone.due_offset_days} day(s)</p></div>
        </li>`).join('')}</ul>`,
  }) : ''}

        ${[[isQuotation(kind) ? 'Project description' : 'Description', record.description],
    ['Scope of work', record.scope_of_work], ['Inclusions', record.inclusions], ['Exclusions', record.exclusions],
    ['Assumptions', record.assumptions], ['Delivery timeline', record.delivery_timeline],
    ['Warranty and support', record.warranty_terms], ['Payment terms', record.payment_terms],
    ['Notes', record.notes], ['Terms and conditions', record.terms]]
    .filter(([, body]) => String(body || '').trim()).map(([title, body]) => card({
      title,
      body: `<div class="whitespace-pre-wrap px-5 py-4 text-sm">${esc(body)}</div>`,
    })).join('')}

        ${paymentsPanel}
        ${notesPanel}
      </div>

      <div class="space-y-4">
        ${card({
    title: 'Summary',
    body: `<dl class="px-5 py-3 text-sm">
          ${totalsRows.map(([label, value]) => `<div class="flex justify-between border-b border-outline py-1.5">
            <dt class="text-on-surface-variant">${esc(label)}</dt><dd class="num">${money(value)}</dd></div>`).join('')}
          <div class="flex justify-between py-2 font-semibold"><dt>Grand total</dt><dd class="num">${money(totals.grand_total_minor || 0)}</dd></div>
          ${isQuotation(kind) ? '' : `
            <div class="flex justify-between border-t border-outline py-1.5"><dt class="text-on-surface-variant">Amount paid</dt><dd class="num">${money(data.amount_paid_minor)}</dd></div>
            <div class="flex justify-between py-1.5 font-semibold"><dt>Balance due</dt><dd class="num">${money(data.balance_due_minor)}</dd></div>`}
        </dl>
        <div class="border-t border-outline px-5 py-3">
          <p class="label-technical">Amount in words</p>
          <p class="mt-1 text-sm">${esc(totals.amount_in_words || words(totals.grand_total_minor || 0))}</p>
        </div>`,
  })}

        ${card({
    title: 'Client',
    body: `<div class="px-5 py-3 text-sm">
          <p class="font-medium">${esc(data.client.name)}</p>
          ${data.client.company_name && data.client.company_name !== data.client.name ? `<p>${esc(data.client.company_name)}</p>` : ''}
          ${data.client.contact_person ? `<p class="text-on-surface-variant">${esc(data.client.contact_person)}</p>` : ''}
          <p class="mt-1 whitespace-pre-wrap">${esc(data.client.billing_address || '')}</p>
          <p class="text-on-surface-variant">${esc([data.client.email, data.client.phone].filter(Boolean).join(' · '))}</p>
          ${data.client.gstin ? `<p class="mt-1 font-mono text-xs">GSTIN ${esc(data.client.gstin)}</p>` : ''}
        </div>`,
  })}

        ${card({
    title: 'Document',
    body: `<dl class="px-5 py-3 text-sm">
          ${[['Number', number || 'Draft'], ['Issue date', date(record.issue_date)],
    [isQuotation(kind) ? 'Valid until' : 'Due date', date(isQuotation(kind) ? record.expiry_date : record.due_date)],
    ['Payment terms', `${record.payment_terms_days} day(s)`],
    ['Place of supply', record.place_of_supply_state_code || '—'],
    ['PO reference', record.po_reference || '—'], ['Project', record.project_reference || '—'],
    // A quotation is sent, an invoice is issued: they store different timestamps.
    [isQuotation(kind) ? 'Sent at' : 'Issued at',
      ((isQuotation(kind) ? record.sent_at : record.issued_at) || '').slice(0, 10) || '—']]
    .map(([label, value]) => `<div class="flex justify-between border-b border-outline py-1.5">
            <dt class="text-on-surface-variant">${esc(label)}</dt><dd class="text-right">${esc(value)}</dd></div>`).join('')}
        </dl>`,
  })}

        ${historyPanel}
      </div>
    </div>`;

  /* ------------------------------------------------------------ interactions */

  const reload = () => ctx.rerender();
  const print = () => printDocument({
    kind: isQuotation(kind) ? 'QUOTATION' : 'TAX_INVOICE',
    document: record, items, milestones: data.milestones || [], client: data.client, business: data.business,
    payments: data.payments || [], notes: data.adjustment_notes || [],
  });

  ctx.on('edit-document', () => ctx.navigate(`#/${list}/${record.id}/edit`));
  ctx.on('preview-pdf', () => api.openDocument(`/api/${list}/${record.id}/pdf?view=1`));
  ctx.on('download-pdf', () => api.openDocument(`/api/${list}/${record.id}/pdf`, { download: true }));
  ctx.on('print-document', print);
  ctx.on('receipt-view', trigger => api.openDocument(`/api/payments/${trigger.dataset.id}/receipt?view=1`));
  ctx.on('receipt-download', trigger => api.openDocument(`/api/payments/${trigger.dataset.id}/receipt`, { download: true }));
  ctx.on('note-pdf', trigger => api.openDocument(`/api/adjustment-notes/${trigger.dataset.id}/pdf?view=1`));

  ctx.on('submit-document', () => {
    pendingId = record.id;
    confirmModal({
      title: isQuotation(kind) ? 'Send quotation' : 'Issue invoice',
      message: isQuotation(kind)
        ? 'Sending allocates the number and freezes the terms. The quotation can no longer be edited.'
        : 'Issuing allocates the sequential number and freezes amounts, taxes and customer details permanently.',
      confirmLabel: isQuotation(kind) ? 'Send quotation' : 'Issue invoice',
      action: 'confirm-submit',
    });
  });
  ctx.on('confirm-submit', async () => {
    const result = isQuotation(kind)
      ? await api.post(`/api/quotations/${pendingId}/send`)
      : await api.post(`/api/invoices/${pendingId}/issue`);
    closeModal();
    toast(isQuotation(kind)
      ? `Quotation ${result.quotation.quotation_number} sent.`
      : `Invoice ${result.invoice.invoice_number} issued.`);
    reload();
  });

  if (isQuotation(kind)) {
    ctx.on('transition', trigger => {
      const target = trigger.dataset.target;
      pendingId = target;
      const node = modal({
        title: target === 'ACCEPTED' ? 'Record acceptance' : 'Record rejection',
        body: `<form id="transition-form" class="space-y-4">
            ${field({ label: 'Reason or reference', name: 'note', type: 'textarea', className: '',
    hint: 'Recorded in the audit trail and shown in the history.' })}
            ${target === 'ACCEPTED' ? '<p class="text-sm text-on-surface-variant">Recording acceptance does not mean payment has been received.</p>' : ''}
          </form>`,
        footer: `${button({ label: 'Cancel', action: 'close-modal' })}${button({ label: 'Save', action: 'confirm-transition', variant: 'primary' })}`,
      });
      ctx.on('confirm-transition', async () => {
        const note = node.querySelector('[name="note"]').value;
        await api.post(`/api/quotations/${record.id}/transition`, { status: pendingId, note });
        closeModal();
        toast('Quotation updated.');
        reload();
      });
    });
    ctx.on('convert', () => {
      confirmModal({
        title: 'Convert to invoice',
        message: 'A new invoice draft is created from this accepted quotation and the quotation is locked to it, so it can never be converted twice.',
        confirmLabel: 'Create invoice draft', action: 'confirm-convert',
      });
    });
    ctx.on('confirm-convert', async () => {
      const result = await api.post(`/api/quotations/${record.id}/convert`, { issue_date: today(), due_date: null });
      closeModal();
      toast('Invoice draft created.');
      ctx.navigate(`#/invoices/${result.invoice.id}/edit`);
    });
    ctx.on('duplicate', async () => {
      const result = await api.post(`/api/quotations/${record.id}/duplicate`);
      toast('Quotation duplicated as a new draft.');
      ctx.navigate(`#/quotations/${result.quotation.id}/edit`);
    });
    ctx.on('cancel-quotation', () => {
      const node = modal({
        title: 'Cancel quotation',
        body: `<form id="cancel-form">${field({ label: 'Reason', name: 'reason', type: 'textarea', required: true, className: '' })}</form>`,
        footer: `${button({ label: 'Keep quotation', action: 'close-modal' })}${button({ label: 'Cancel quotation', action: 'confirm-cancel', variant: 'danger' })}`,
      });
      ctx.on('confirm-cancel', async () => {
        await api.post(`/api/quotations/${record.id}/transition`, {
          status: 'CANCELLED', note: node.querySelector('[name="reason"]').value,
        });
        closeModal();
        toast('Quotation cancelled.');
        reload();
      });
    });
  } else {
    ctx.on('record-payment', () => {
      let running = data.balance_due_minor;
      const node = modal({
        title: `Record payment · ${number}`,
        body: `<form id="payment-form" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            ${field({ label: 'Amount received (₹)', name: 'amount', type: 'number', step: '0.01', min: '0.01', required: true, value: toMajor(running) })}
            ${field({ label: 'Payment date', name: 'paid_on', type: 'date', required: true, value: today() })}
            ${field({ label: 'Method', name: 'method', options: ctx.reference.payment_methods.map(method => ({ value: method, label: titleCase(method) })), value: 'BANK_TRANSFER' })}
            ${field({ label: 'Reference', name: 'reference' })}
            ${field({ label: 'Notes', name: 'notes', type: 'textarea', className: 'sm:col-span-2' })}
          </form>`,
        footer: `${button({ label: 'Cancel', action: 'close-modal' })}${button({ label: 'Record payment', action: 'save-payment', variant: 'primary' })}`,
      });
      ctx.on('save-payment', async () => {
        const form = new FormData(node.querySelector('#payment-form'));
        try {
          const result = await api.post(`/api/invoices/${record.id}/payments`, {
            amount_minor: parseAmount(form.get('amount')),
            paid_on: String(form.get('paid_on')),
            method: String(form.get('method')),
            reference: String(form.get('reference') || ''),
            notes: String(form.get('notes') || ''),
          });
          closeModal();
          toast(`Receipt ${result.receipt.number} issued.`);
          reload();
        } catch (error) { toast(error.message, 'danger'); }
      });
    });

    ctx.on('cancel-invoice', () => {
      const node = modal({
        title: 'Cancel invoice',
        body: `<form id="cancel-form" class="space-y-4">
            <p class="text-sm text-on-surface-variant">The invoice number is retained for the audit trail and the balance is removed from receivables.</p>
            ${field({ label: 'Reason', name: 'reason', type: 'textarea', required: true, className: '' })}
            ${field({ label: 'Treatment', name: 'void', options: [
    { value: 'false', label: 'Cancel (issued in error)' }, { value: 'true', label: 'Void and retain number' },
  ], className: '' })}
          </form>`,
        footer: `${button({ label: 'Keep invoice', action: 'close-modal' })}${button({ label: 'Confirm', action: 'confirm-cancel', variant: 'danger' })}`,
      });
      ctx.on('confirm-cancel', async () => {
        const form = new FormData(node.querySelector('#cancel-form'));
        try {
          await api.post(`/api/invoices/${record.id}/cancel`, {
            reason: String(form.get('reason')), void: String(form.get('void')) === 'true',
          });
          closeModal();
          toast('Invoice cancelled.');
          reload();
        } catch (error) { toast(error.message, 'danger'); }
      });
    });

    ctx.on('credit-note', () => {
      const remaining = data.invoice.totals.grand_total_minor;
      const node = modal({
        title: `Credit note against ${number}`,
        body: `<form id="credit-form" class="space-y-4">
            ${field({ label: 'Reason', name: 'reason', type: 'textarea', required: true, className: '', hint: 'Stored on the note for the audit trail.' })}
            ${field({ label: 'Issue date', name: 'issue_date', type: 'date', required: true, value: today() })}
            ${field({ label: 'Description', name: 'description', required: true, value: 'Scope reduction', className: '' })}
            ${field({ label: 'Amount before tax (₹)', name: 'amount', type: 'number', step: '0.01', min: '0.01', required: true,
    hint: `Tax is applied at the invoice GST rate. The credit cannot exceed ${money(remaining)} in total.` })}
            ${field({ label: 'Notes', name: 'notes', type: 'textarea', className: '' })}
          </form>`,
        footer: `${button({ label: 'Cancel', action: 'close-modal' })}${button({ label: 'Issue credit note', action: 'save-credit', variant: 'primary' })}`,
      });
      ctx.on('save-credit', async () => {
        const form = new FormData(node.querySelector('#credit-form'));
        const item = items[0] || {};
        try {
          const result = await api.post(`/api/invoices/${record.id}/credit-notes`, {
            kind: 'CREDIT',
            reason: String(form.get('reason') || ''),
            issue_date: String(form.get('issue_date')),
            notes: String(form.get('notes') || ''),
            items: [{
              product_id: null,
              description: String(form.get('description') || 'Scope reduction'),
              category: '', hsn_sac: item.hsn_sac || '', unit: item.unit || 'NOS',
              quantity_milli: 1000,
              unit_price_minor: parseAmount(form.get('amount')),
              discount_bp: 0, discount_minor: 0,
              tax_rate_bp: item.tax_treatment === 'TAXABLE' ? item.tax_rate_bp : 0,
              tax_treatment: item.tax_treatment || 'TAXABLE',
            }],
          });
          closeModal();
          toast(`Credit note ${result.note.note_number} issued.`);
          reload();
        } catch (error) { toast(error.message, 'danger'); }
      });
    });
  }
}

/* ------------------------------------------------------------------- entry */

export const render = async (container, params, ctx) => {
  try {
    if (params.mode === 'edit') return await renderEditor(container, params, ctx);
    return await renderDetail(container, params, ctx);
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Document' }) + alertBox(error.message, 'danger');
  }
};
