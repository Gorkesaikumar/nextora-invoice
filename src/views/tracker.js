import { api, query } from '../lib/api.js';
import {
  alertBox, badge, button, card, closeModal, esc, emptyState, field, icon, loading, modal, pageHeader,
  pagination, stat, titleCase, toast, toolbar, warnings,
} from '../lib/ui.js';

/**
 * The POS customer tracker: a spreadsheet over the customer rows, with dynamic
 * columns, Excel round trips and sharing.
 *
 * S.No. is drawn from the response, so it always numbers the current filter and
 * sort and is never used to identify a record. The server remains the authority
 * on every value: the grid only previews what a save will do.
 */

const SUBSCRIPTIONS = [
  { value: '', label: 'Any subscription' }, { value: 'ACTIVE', label: 'Active' },
  { value: 'EXPIRING_7', label: 'Expiring in 7 days' }, { value: 'EXPIRING_15', label: 'Expiring in 15 days' },
  { value: 'EXPIRING_30', label: 'Expiring in 30 days' }, { value: 'EXPIRED', label: 'Expired' },
  { value: 'LIFETIME', label: 'Lifetime' },
];

const STATUSES = [{ value: 'ACTIVE', label: 'Active customers' }, { value: 'ARCHIVED', label: 'Archived customers' },
  { value: 'ALL', label: 'All statuses' }];

const SORTS = [{ value: 'serial', label: 'Recently added' }, { value: 'name', label: 'Customer name' },
  { value: 'business_name', label: 'Business name' }, { value: 'purchase_date', label: 'Date of purchase' },
  { value: 'expiry_date', label: 'Date of expiry' }, { value: 'product', label: 'Product' },
  { value: 'employee', label: 'Employee' }];

const state = { filters: {}, page: 1, sort: 'serial', direction: 'desc', dirty: new Map(), draft: null, selected: new Set() };

export async function render(container, params, ctx) {
  if (params.segments.length === 2 && params.segments[1] !== 'new') {
    return renderCustomer(container, params, ctx);
  }
  return renderGrid(container, params, ctx);
}

/* ------------------------------------------------------------------- the grid */

async function renderGrid(container, params, ctx) {
  container.innerHTML = loading('Loading the customer tracker…');
  let reference;
  try {
    reference = await api.get('/api/tracker/reference');
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'POS Customers', subtitle: 'Customers, purchases and renewals for Nextora POS.' })
      + alertBox(error.message, 'warn');
    return;
  }
  if (params.search?.get('filters')) Object.assign(state.filters, JSON.parse(params.search.get('filters')));
  if (params.search?.get('page')) state.page = Number(params.search.get('page')) || 1;

  const { can_write: canWrite, can_manage: canManage, columns, custom_fields: customFields } = reference;
  const visible = columns.filter(column => column.visible || column.key === 'serial');

  let products = [];
  try {
    const productsData = await api.get('/api/products?limit=100&status=ACTIVE');
    products = (productsData?.products || []).map(p => ({ value: p.id, label: p.name }));
  } catch {
    products = [];
  }

  const data = await api.get(`/api/tracker/customers${query({ ...state.filters, page: state.page, limit: 25,
    sort: state.sort, direction: state.direction })}`);

  const employees = reference.employees.filter(employee => employee.status === 'ACTIVE');
  const plans = reference.plans.filter(plan => plan.status === 'ACTIVE');
  const metrics = reference.metrics;

  const filterField = (label, name, options, className = 'w-40') => field({
    label, name: `filter-${name}`, type: 'select', className,
    options: options.map(option => ({ value: option.value, label: option.label, selected: state.filters[name] === option.value })),
    value: state.filters[name] ?? options[0].value,
  });
  const options = (list, label = 'label') => list.map(item => ({ value: item.value ?? item.id, label: label === 'label' ? item.label : item.name }));

  const headerActions = canWrite
    ? `${button({ label: 'Add Customer', action: 'customer-new', variant: 'primary', icon: 'person_add' })}
       ${button({ label: 'Add Column', action: 'column-new', icon: 'add_column_right' })}
       ${button({ label: 'Import Excel', action: 'import-start', icon: 'upload_file' })}
       ${button({ label: 'Export Excel', action: 'export-xlsx', icon: 'download' })}
       ${canManage ? button({ label: 'Share Privately', action: 'share-private', icon: 'lock' })
    + button({ label: 'Create Public Link', action: 'share-public', icon: 'link' }) : ''}`
    : '';

  const cells = (row, index) => visible.map(column => {
    const dirty = state.dirty.get(row.id)?.[column.key];
    const value = cellText(row, column);
    const editable = canWrite && column.editable && column.type !== 'SERIAL';
    const classes = `align-top border-b border-outline px-3 py-2 ${dirty !== undefined ? 'bg-[#FFFBEA]' : ''}`;
    if (column.key === 'name') {
      return `<td class="${classes}" style="max-width:${column.width}px">
        <a href="#/tracker/${esc(row.id)}" class="font-medium text-primary hover:underline" title="View details">${esc(dirty !== undefined ? dirty : value)}</a>
      </td>`;
    }
    if (!editable) {
      return `<td class="${classes} ${column.key === 'serial' ? 'num text-on-surface-variant' : ''}"
        style="max-width:${column.width}px">${column.key === 'serial' ? `<span class="num">${row.serial}</span>` : esc(value)}</td>`;
    }
    return `<td class="${classes}" style="max-width:${column.width}px">
      <button type="button" class="block w-full text-left hover:bg-surface-dim" style="min-height:22px"
        data-action="cell-edit" data-id="${esc(row.id)}" data-column="${esc(column.key)}"
        title="Double-click to edit">${esc(dirty !== undefined ? dirty : value) || '<span class="text-on-surface-variant">—</span>'}</button>
    </td>`;
  }).join('');

  const rowActions = row => (canWrite ? `<td class="border-b border-outline px-3 py-2 text-right whitespace-nowrap">
      ${state.dirty.has(row.id)
    ? `${button({ label: 'Save', action: 'row-save', attributes: `data-id="${esc(row.id)}"`, variant: 'primary', size: 'sm' })}
         ${button({ label: 'Cancel', action: 'row-cancel', attributes: `data-id="${esc(row.id)}"`, size: 'sm' })}`
    : `${button({ label: 'Edit', action: 'customer-edit', attributes: `data-id="${esc(row.id)}"`, size: 'sm' })}
         ${button({ label: row.status === 'ARCHIVED' ? 'Restore' : 'Archive',
    action: row.status === 'ARCHIVED' ? 'customer-restore' : 'customer-archive', attributes: `data-id="${esc(row.id)}"`, size: 'sm' })}
         ${button({ label: 'Delete', action: 'customer-delete', attributes: `data-id="${esc(row.id)}"`, variant: 'danger', size: 'sm' })}`}
    </td>` : '');

  container.innerHTML = `
    ${pageHeader({
    title: 'POS Customers',
    breadcrumb: 'Customer Tracker',
    subtitle: 'Who bought which Nextora POS product, on which plan, and when it needs renewing.',
    actions: headerActions,
  })}
    ${alertBox('Public links are readable by anyone who receives them. Share privately unless a public link is genuinely needed.', 'warn')}
    <div class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      ${stat({ label: 'Total customers', value: metrics.totals.total_customers, hint: `${metrics.totals.archived_customers} archived` })}
      ${stat({ label: 'Active subscriptions', value: metrics.subscriptions.active, hint: `${metrics.subscriptions.lifetime} lifetime` })}
      ${stat({ label: 'Expiring in 30 days', value: metrics.subscriptions.expiring_30, hint: `${metrics.subscriptions.expiring_7} in 7 days` })}
      ${stat({ label: 'Renewals to follow up', value: metrics.renewals_due, hint: `${metrics.subscriptions.expired} expired`, tone: 'warn' })}
    </div>

    ${card({
    title: `${data.total} customer${data.total === 1 ? '' : 's'}`,
    subtitle: 'S.No. renumbers for the current filter and sort; it is not the record identity.',
    body: `${toolbar(`
      ${field({ label: 'Search', name: 'tracker-search', value: state.filters.search || '', placeholder: 'Name, business, address, product, custom field…', className: 'w-64' })}
      ${filterField('Product', 'product_id', [{ value: '', label: 'Any product' }, ...products])}
      ${filterField('Employee', 'employee_id', [{ value: '', label: 'Any employee' }, ...options(employees, 'name')])}
      ${filterField('Subscription', 'subscription', SUBSCRIPTIONS)}
      ${filterField('Status', 'status', STATUSES)}
      ${button({ label: 'Apply', action: 'filters-apply', variant: 'primary' })}
      ${button({ label: 'Clear', action: 'filters-clear' })}
    `)}
      <div class="overflow-x-auto">
        <table class="w-full min-w-[1120px] text-sm">
          <thead>
            <tr class="label-technical border-b border-outline bg-surface-dim">
              ${canWrite ? '<th class="w-8 px-3 py-2"></th>' : ''}
              ${visible.map(column => `<th class="px-3 py-2 text-left" style="min-width:${column.width}px">
                <button type="button" class="flex items-center gap-1" data-action="sort" data-key="${esc(column.key)}">
                  ${esc(column.label)}${column.custom ? '<span class="font-normal text-on-surface-variant">custom</span>' : ''}
                  ${state.sort === column.key ? `<span class="num">${state.direction === 'asc' ? '▲' : '▼'}</span>` : ''}
                </button></th>`).join('')}
              ${canWrite ? '<th class="px-3 py-2"></th>' : ''}
            </tr>
          </thead>
          <tbody data-rows>
            ${data.customers.map(row => `<tr class="align-top hover:bg-surface-dim" data-row="${esc(row.id)}">
              ${canWrite ? `<td class="border-b border-outline px-3 py-2"><input type="checkbox" data-action="select-row" data-id="${esc(row.id)}" ${state.selected.has(row.id) ? 'checked' : ''}></td>` : ''}
              ${cells(row)}
              ${rowActions(row)}
            </tr>`).join('')}
          </tbody>
        </table>
        ${data.customers.length ? '' : emptyState({ icon: 'group_off', title: 'No customers match this view',
    message: 'Clear the filters, or add the first customer to start the tracker.' })}
      </div>
      ${canWrite ? `<div class="border-t border-outline px-5 py-3">
        ${button({ label: '+ Add Row', action: 'row-add', icon: 'add' })}
        <span class="ml-3 text-xs text-on-surface-variant">Adds an editable row at the end of this page.</span>
      </div>` : ''}
      ${pagination({ page: data.page, total: data.total, limit: data.limit })}`,
  })}

    <div class="mt-4 flex flex-wrap gap-2">
      ${button({ label: 'Export CSV', action: 'export-csv' })}
      ${button({ label: 'Export selected rows', action: 'export-selected' })}
      ${button({ label: 'Export template', action: 'export-template' })}
      ${button({ label: 'Manage columns', action: 'columns-manage' })}
      ${button({ label: 'Manage employees', action: 'employees-manage' })}
      ${button({ label: 'Subscription plans', action: 'plans-manage' })}
      ${canManage ? button({ label: 'Shares', action: 'shares-open' }) : ''}
    </div>`;

  bindGrid(container, ctx, { canWrite, canManage, columns, visible, data, plans, employees, products, customFields });
}

function cellText(row, column) {
  if (column.custom) return row.custom?.[column.key] ?? '';
  if (column.key === 'expiry_date' && row.is_lifetime) return 'Lifetime';
  return row[column.key] ?? '';
}

function bindGrid(container, ctx, contextData) {
  const { canWrite, canManage, columns, plans = [], employees = [], products = [], customFields } = contextData;
  const rerender = () => ctx.rerender();

  ctx.on('sort', trigger => {
    const key = trigger.dataset.key;
    if (state.sort === key) state.direction = state.direction === 'asc' ? 'desc' : 'asc';
    else { state.sort = key; state.direction = 'asc'; }
    rerender();
  });
  ctx.on('filters-apply', () => {
    state.filters = {};
    const search = document.querySelector('[name="tracker-search"]')?.value.trim();
    if (search) state.filters.search = search;
    for (const input of container.querySelectorAll('[name^="filter-"]')) {
      const key = input.name.replace('filter-', '');
      if (input.value) state.filters[key] = input.value;
    }
    state.page = 1;
    rerender();
  });
  ctx.on('filters-clear', () => { state.filters = {}; state.page = 1; rerender(); });
  ctx.on('page', trigger => { state.page = Number(trigger.dataset.page) || 1; rerender(); });

  // Inline cell editing keeps a local draft until the row is saved, so a failed
  // save never discards what was typed.
  ctx.on('cell-edit', trigger => {
    if (!canWrite) return;
    const { id, column } = trigger.dataset;
    const original = cellText(contextData.data.customers.find(row => row.id === id), columns.find(item => item.key === column));
    const header = columns.find(item => item.key === column);
    const definition = header.custom ? customFields.find(item => item.id === header.definition_id) : null;
    const input = field({
      label: header.label, name: 'cell-value', className: '',
      type: definition?.field_type === 'DATE' ? 'date' : ['NUMBER', 'CURRENCY'].includes(definition?.field_type) ? 'number' : 'text',
      options: definition?.field_type === 'DROPDOWN' ? definition.options.map(option => ({ value: option, label: option })) : undefined,
      value: state.dirty.get(id)?.[column] ?? original, hint: definition?.description || header.description || '',
    });
    const node = modal({
      title: `${header.label} · ${esc(trigger.innerText.trim())}`,
      body: `<form id="cell-form" class="space-y-4">${input}</form>`,
      footer: `${button({ label: 'Cancel', action: 'close-modal' })}${button({ label: 'Apply', action: 'cell-apply', variant: 'primary' })}`,
    });
    ctx.on('cell-apply', () => {
      const form = new FormData(node.querySelector('#cell-form'));
      const entered = String(form.get('cell-value') ?? '');
      state.dirty.set(id, { ...(state.dirty.get(id) || {}), [column]: entered });
      closeModal();
      rerender();
    });
  });

  ctx.on('row-cancel', trigger => { state.dirty.delete(trigger.dataset.id); rerender(); });
  ctx.on('row-save', async trigger => {
    const id = trigger.dataset.id;
    const changes = state.dirty.get(id) || {};
    const row = contextData.data.customers.find(item => item.id === id);
    const payload = {
      name: changes.name ?? row.name, business_name: changes.business_name ?? row.business_name,
      address: changes.address ?? row.address, employee_id: row.employee_id, email: row.email, phone: row.phone,
      remarks: changes.remarks ?? row.remarks, client_id: row.client_id, expected_updated_at: row.updated_at,
    };
    if (changes.purchase_date || changes.expiry_date || changes.plan_id) {
      payload.subscription = {
        product_id: row.product_id, plan_id: changes.plan_id ?? row.plan_id, plan_label: row.plan_label,
        purchase_date: changes.purchase_date ?? row.purchase_date,
        start_date: row.start_date, is_lifetime: row.is_lifetime,
        expiry_date: row.is_lifetime ? null : (changes.expiry_date ?? row.expiry_date),
        status: row.subscription_status || 'ACTIVE', amount_minor: row.amount_minor,
        transaction_reference: row.transaction_reference,
      };
    }
    try {
      const fieldChanges = Object.entries(changes).filter(([key]) => key.startsWith('custom:'));
      await api.patch(`/api/tracker/customers/${id}`, payload);
      if (fieldChanges.length) {
        await api.put(`/api/tracker/customers/${id}/fields`,
          { values: fieldChanges.map(([key, value]) => ({ definition_id: key.slice('custom:'.length), value })) });
      }
      state.dirty.delete(id);
      toast('Row saved.');
      rerender();
    } catch (error) {
      toast(error.message, 'danger');
      // The draft stays, so the operator can fix and retry.
      rerender();
    }
  });

  ctx.on('row-add', () => {
    state.draft = {
      id: 'new',
      name: '',
      business_name: '',
      address: '',
      employee_id: employees[0]?.id || '',
      purchase_date: new Date().toISOString().slice(0, 10),
      product_id: products[0]?.value || '',
      plan_id: plans[0]?.id || '',
      expiry_date: '',
      remarks: '',
    };
    openCustomerModal(ctx, { canWrite, plans, employees, products, draft: state.draft });
  });
  ctx.on('customer-new', () => openCustomerModal(ctx, { canWrite, plans, employees, products }));

  ctx.on('select-row', trigger => {
    if (trigger.checked) state.selected.add(trigger.dataset.id); else state.selected.delete(trigger.dataset.id);
  });
  ctx.on('customer-detail', trigger => ctx.navigate(`#/tracker/${trigger.dataset.id}`));
  ctx.on('customer-edit', trigger => {
    openCustomerEditModal(ctx, { customerId: trigger.dataset.id, reference: contextData, products });
  });
  ctx.on('customer-delete', trigger => {
    const row = contextData.data.customers.find(item => item.id === trigger.dataset.id);
    confirmDeleteCustomerModal(ctx, {
      customerId: trigger.dataset.id,
      customerName: row?.name || 'Customer',
      businessName: row?.business_name || '',
    });
  });
  for (const [action, status, label] of [['customer-archive', 'ARCHIVED', 'Archive'],
    ['customer-restore', 'ACTIVE', 'Restore']]) {
    ctx.on(action, trigger => {
      const id = trigger.dataset.id;
      confirmInline(`${label} this customer?`,
        status === 'ARCHIVED'
          ? 'The record and its subscription history are kept; the customer leaves the active view.'
          : 'The customer returns to the active view.',
        async () => {
          try {
            await api.post(`/api/tracker/customers/${id}/status`, { status });
            toast(`Customer ${status === 'ARCHIVED' ? 'archived' : 'restored'}.`);
            rerender();
          } catch (error) { toast(error.message, 'danger'); }
        });
    });
  }

  ctx.on('export-xlsx', () => api.openDocument(`/api/tracker/export${query({ ...state.filters, format: 'xlsx' })}`, { download: true }));
  ctx.on('export-csv', () => api.openDocument(`/api/tracker/export${query({ ...state.filters, format: 'csv' })}`, { download: true }));
  ctx.on('export-template', () => api.openDocument('/api/tracker/export?format=template', { download: true }));
  ctx.on('export-selected', async () => {
    if (!state.selected.size) { toast('Select at least one row first.', 'warn'); return; }
    await api.openDocument(`/api/tracker/export${query({ format: 'xlsx', ids: [...state.selected].join(',') })}`, { download: true });
  });

  ctx.on('column-new', () => openColumnModal(ctx, { canManage }));
  ctx.on('columns-manage', async () => openColumnsManager(ctx));
  ctx.on('employees-manage', () => openEmployeesModal(ctx, { canManage }));
  ctx.on('plans-manage', () => openPlansModal(ctx, { canManage }));
  ctx.on('import-start', () => openImportModal(ctx));
  ctx.on('share-private', () => openShareModal(ctx, { shareType: 'PRIVATE', columns, data: contextData.data }));
  ctx.on('share-public', () => openShareModal(ctx, { shareType: 'PUBLIC', columns, data: contextData.data }));
  ctx.on('shares-open', () => ctx.navigate('#/shares'));
}

function confirmInline(title, message, action) {
  modal({
    title, body: `<p class="text-sm text-on-surface-variant">${esc(message)}</p>`,
    footer: `${button({ label: 'Keep', action: 'close-modal' })}${button({ label: 'Confirm', action: 'confirm-inline', variant: 'primary' })}`,
  });
  document.querySelector('[data-action="confirm-inline"]').addEventListener('click', () => { closeModal(); action(); });
}

/* ---------------------------------------------------------------- customer form */

export function openCustomerModal(ctx, { canWrite = true, plans = [], employees = [], products = [], draft = null } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const employeeList = Array.isArray(employees) ? employees : (typeof employees === 'function' ? employees() : []);
  const planList = Array.isArray(plans) ? plans : (typeof plans === 'function' ? plans() : []);
  const productList = Array.isArray(products) ? products : (typeof products === 'function' ? products() : []);

  const node = modal({
    title: draft ? 'Add a customer row' : 'Add customer',
    size: 'wide',
    body: `<form id="customer-form" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      ${field({ label: 'Customer Name', name: 'name', required: true, value: draft?.name || '' })}
      ${field({ label: 'Customer Business Name', name: 'business_name', value: draft?.business_name || '',
    hint: 'Restaurant, shop or company name.' })}
      ${field({ label: 'Address', name: 'address', type: 'textarea', className: 'sm:col-span-2',
    value: draft?.address || '' })}
      ${field({ label: 'Employee Assigned', name: 'employee_id', type: 'select', value: draft?.employee_id || '',
    options: [{ value: '', label: 'Not assigned' }, ...employeeList.map(e => ({ value: e.id, label: e.name }))] })}
      ${field({ label: 'Date of Purchase', name: 'purchase_date', type: 'date', value: draft?.purchase_date || today })}
      ${field({ label: 'Product', name: 'product_id', type: 'select', value: draft?.product_id || '',
    options: [{ value: '', label: 'Not selected' }, ...productList.map(p => ({ value: p.value || p.id, label: p.label || p.name }))] })}
      ${field({ label: 'Subscription', name: 'plan_id', type: 'select', value: draft?.plan_id || '',
    options: [{ value: '', label: 'Not selected' }, ...planList.map(p => ({ value: p.id, label: `${p.label}${p.is_lifetime ? ' (lifetime)' : ` · ${p.duration_months} months`}` }))] })}
      ${field({ label: 'Date of Expiry', name: 'expiry_date', type: 'date', value: draft?.expiry_date || '',
    hint: 'Leave blank for a lifetime plan.' })}
      ${field({ label: 'Remarks', name: 'remarks', type: 'textarea', className: 'sm:col-span-2',
    value: draft?.remarks || '' })}
      <p class="text-sm text-on-surface-variant sm:col-span-2">
        A new customer starts a subscription. Renewals are added from the customer page so the previous purchase is kept.
      </p>
    </form>`,
    footer: `${button({ label: 'Cancel', action: 'close-modal' })}${button({ label: 'Save customer', action: 'customer-save', variant: 'primary' })}`,
  });

  let isSaving = false;
  ctx.on('customer-save', async () => {
    if (isSaving) return;
    const formEl = node.querySelector('#customer-form');
    if (!formEl) return;
    if (typeof formEl.reportValidity === 'function' && !formEl.reportValidity()) return;

    const form = new FormData(formEl);
    const name = String(form.get('name') || '').trim();
    if (!name) {
      toast('Customer Name is required.', 'danger');
      formEl.querySelector('[name="name"]')?.focus();
      return;
    }

    const payload = {
      name,
      business_name: String(form.get('business_name') || '').trim(),
      address: String(form.get('address') || '').trim(),
      remarks: String(form.get('remarks') || '').trim(),
      employee_id: String(form.get('employee_id') || '') || null,
    };
    const productId = String(form.get('product_id') || '');
    const planId = String(form.get('plan_id') || '');
    const expiry = String(form.get('expiry_date') || '');
    if (productId || planId || expiry) {
      payload.subscription = {
        product_id: productId || null,
        plan_id: planId || null,
        purchase_date: String(form.get('purchase_date')),
        start_date: String(form.get('purchase_date')),
        expiry_date: expiry || null,
        is_lifetime: !expiry,
        status: 'ACTIVE',
      };
    }

    isSaving = true;
    const saveBtn = node.querySelector('[data-action="customer-save"]');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.setAttribute('aria-busy', 'true');
    }

    try {
      const result = await api.post('/api/tracker/customers', payload);
      closeModal();
      toast(result.warnings?.length ? `Customer added. ${result.warnings[0]}` : 'Customer added.');
      ctx.rerender();
    } catch (error) {
      toast(error.message || 'Failed to save customer.', 'danger');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.removeAttribute('aria-busy');
      }
    } finally {
      isSaving = false;
    }
  });
}

/* ------------------------------------------------------------- column dialogs */

const FIELD_TYPES = [
  { value: 'TEXT', label: 'Short text' }, { value: 'LONG_TEXT', label: 'Long text' },
  { value: 'NUMBER', label: 'Number' }, { value: 'CURRENCY', label: 'Currency' },
  { value: 'DATE', label: 'Date' }, { value: 'DROPDOWN', label: 'Dropdown' },
  { value: 'MULTI_SELECT', label: 'Multi-select' }, { value: 'CHECKBOX', label: 'Checkbox (yes/no)' },
  { value: 'URL', label: 'URL' }, { value: 'EMAIL', label: 'Email' }, { value: 'PHONE', label: 'Phone number' },
];

function openColumnModal(ctx, { canManage, existing = null }) {
  const node = modal({
    title: existing ? `Edit column · ${existing.label}` : 'Add column',
    size: 'wide',
    body: `<form id="column-form" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      ${field({ label: 'Column name', name: 'label', required: true, value: existing?.label || '' })}
      ${field({ label: 'Field type', name: 'field_type', type: 'select', value: existing?.field_type || 'TEXT',
    options: FIELD_TYPES })}
      ${field({ label: 'Description', name: 'description', className: 'sm:col-span-2', value: existing?.description || '' })}
      ${field({ label: 'Dropdown options (one per line)', name: 'options', type: 'textarea', className: 'sm:col-span-2',
    value: (existing?.options || []).join('\n'), hint: 'Used by dropdown and multi-select fields.' })}
      ${field({ label: 'Required', name: 'required', type: 'select', value: String(existing?.required ?? false),
    options: [{ value: 'false', label: 'Optional' }, { value: 'true', label: 'Required' }] })}
      ${field({ label: 'Visible', name: 'visible', type: 'select', value: String(existing?.visible ?? true),
    options: [{ value: 'true', label: 'Shown' }, { value: 'false', label: 'Hidden' }] })}
      ${field({ label: 'Column width', name: 'width', type: 'number', value: String(existing?.width ?? 160) })}
      ${field({ label: 'Editable by', name: 'editor_roles', type: 'select', className: '',
    value: (existing?.editor_roles || ['OWNER', 'ADMIN']).join(','),
    options: [{ value: 'OWNER,ADMIN', label: 'Owner and administrators' },
      { value: 'OWNER,ADMIN,FINANCE', label: 'Owner, administrators and finance' },
      { value: 'OWNER', label: 'Owner only' }] })}
      <p class="text-sm text-on-surface-variant sm:col-span-2">
        Existing customers keep their values: a new column starts empty unless it has a default.
      </p>
    </form>`,
    footer: `${button({ label: 'Cancel', action: 'close-modal' })}${button({
      label: existing ? 'Save column' : 'Create column', action: 'column-save', variant: 'primary',
    })}`,
  });
  ctx.on('column-save', async () => {
    const form = new FormData(node.querySelector('#column-form'));
    const roles = String(form.get('editor_roles')).split(',').filter(Boolean);
    const payload = {
      label: String(form.get('label')).trim(), field_type: String(form.get('field_type')),
      description: String(form.get('description') || ''),
      options: String(form.get('options') || '').split('\n').map(value => value.trim()).filter(Boolean),
      required: String(form.get('required')) === 'true', visible: String(form.get('visible')) === 'true',
      width: Number(form.get('width')) || 160, editor_roles: roles,
      position: existing?.position ?? 0,
    };
    if (roles.includes('ACCOUNTANT') && !canManage) { /* roles are validated on the server anyway */ }
    try {
      if (existing) await api.patch(`/api/tracker/fields/${existing.id}`, payload);
      else await api.post('/api/tracker/fields', payload);
      closeModal();
      toast(existing ? 'Column updated.' : 'Column added.');
      ctx.rerender();
    } catch (error) { toast(error.message, 'danger'); }
  });
}

async function openColumnsManager(ctx) {
  const { fields } = await api.get('/api/tracker/fields?archived=1');
  const { columns } = await api.get('/api/tracker/reference');
  const defaults = columns.filter(column => !column.custom);
  const node = modal({
    title: 'Columns',
    size: 'wide',
    body: `<div class="space-y-4">
      <section>
        <p class="label-technical mb-2">Default columns</p>
        <ul class="divide-y divide-outline" data-defaults>
          ${defaults.map(column => `<li class="flex items-center gap-3 py-2 text-sm">
            <input type="checkbox" data-action="column-visible" data-key="${esc(column.key)}" ${column.visible ? 'checked' : ''}>
            <span class="flex-1">${esc(column.label)} <span class="text-xs text-on-surface-variant">${esc(column.key)}</span></span>
            <input type="number" class="field w-24" data-action="column-width" data-key="${esc(column.key)}" value="${column.width}" min="80" max="600">
            <button type="button" class="text-xs underline" data-action="column-move" data-key="${esc(column.key)}" data-dir="-1">Up</button>
            <button type="button" class="text-xs underline" data-action="column-move" data-key="${esc(column.key)}" data-dir="1">Down</button>
          </li>`).join('')}
        </ul>
      </section>
      <section>
        <p class="label-technical mb-2">Custom columns</p>
        <ul class="divide-y divide-outline">
          ${fields.length ? fields.map(item => `<li class="flex flex-wrap items-center gap-3 py-2 text-sm">
            <span class="flex-1">${esc(item.label)} <span class="text-xs text-on-surface-variant">${esc(titleCase(item.field_type))}${item.required ? ' · required' : ''}</span>
              ${item.status === 'ARCHIVED' ? badge('Archived', 'warn') : ''}
              ${item.value_count ? `<span class="text-xs text-on-surface-variant">· ${item.value_count} value(s)</span>` : ''}</span>
            <button type="button" class="text-xs underline" data-action="column-edit" data-id="${esc(item.id)}">Edit</button>
            <button type="button" class="text-xs underline" data-action="column-status" data-id="${esc(item.id)}"
              data-status="${item.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED'}">${item.status === 'ARCHIVED' ? 'Restore' : 'Archive'}</button>
          </li>`).join('') : '<li class="py-2 text-sm text-on-surface-variant">No custom columns yet.</li>'}
        </ul>
      </section>
      <p class="text-sm text-on-surface-variant">Archiving a column keeps its stored values and hides it from the grid.</p>
    </div>`,
    footer: `${button({ label: 'Close', action: 'close-modal' })}${button({ label: 'Save layout', action: 'columns-save', variant: 'primary' })}`,
  });
  node.querySelectorAll('[data-action="column-edit"]').forEach(buttonNode => buttonNode.addEventListener('click', () => {
    const item = fields.find(fieldItem => fieldItem.id === buttonNode.dataset.id);
    closeModal();
    openColumnModal(ctx, { existing: item });
  }));
  node.querySelectorAll('[data-action="column-status"]').forEach(buttonNode => buttonNode.addEventListener('click', async () => {
    const target = buttonNode.dataset.status;
    const item = fields.find(fieldItem => fieldItem.id === buttonNode.dataset.id);
    if (target === 'ARCHIVED' && item.value_count > 0) {
      const confirmed = window.confirm(`${item.label} holds ${item.value_count} value(s). Archiving keeps them but hides the column. Continue?`);
      if (!confirmed) return;
    }
    try {
      await api.post(`/api/tracker/fields/${item.id}/status`, { status: target });
      closeModal();
      toast(`Column ${target === 'ARCHIVED' ? 'archived' : 'restored'}.`);
      ctx.rerender();
    } catch (error) { toast(error.message, 'danger'); }
  }));
  node.querySelectorAll('[data-action="column-move"]').forEach(buttonNode => buttonNode.addEventListener('click', () => {
    const list = [...node.querySelectorAll('[data-defaults] li')];
    const index = list.findIndex(item => item.querySelector('[data-action="column-visible"]').dataset.key === buttonNode.dataset.key);
    const swap = index + Number(buttonNode.dataset.dir);
    if (swap < 0 || swap >= list.length) return;
    const parent = list[index].parentElement;
    if (Number(buttonNode.dataset.dir) === -1) parent.insertBefore(list[index], list[swap]);
    else parent.insertBefore(list[swap], list[index]);
  }));
  ctx.on('columns-save', async () => {
    const listed = [...node.querySelectorAll('[data-defaults] li')];
    const layout = listed.map(item => ({
      key: item.querySelector('[data-action="column-visible"]').dataset.key,
      visible: item.querySelector('[data-action="column-visible"]').checked,
      width: Number(item.querySelector('[data-action="column-width"]').value) || 160,
    }));
    for (const column of columns.filter(item => item.custom)) {
      layout.push({ key: column.key, visible: column.visible, width: column.width });
    }
    try {
      await api.put('/api/tracker/columns', { columns: layout });
      closeModal();
      toast('Column layout saved.');
      ctx.rerender();
    } catch (error) { toast(error.message, 'danger'); }
  });
}

/* ---------------------------------------------------------- lookups and plans */

async function openEmployeesModal(ctx, { canManage }) {
  const { employees: list } = await api.get('/api/tracker/employees?inactive=1');
  const node = modal({
    title: 'Employees',
    body: `<div class="space-y-4">
      <ul class="divide-y divide-outline">${list.length ? list.map(item => `<li class="flex items-center gap-3 py-2 text-sm">
        <span class="flex-1">${esc(item.name)} ${item.status === 'INACTIVE' ? badge('Inactive', 'warn') : ''}
          <span class="text-xs text-on-surface-variant">· ${item.customer_count} customer(s)</span></span>
        ${canManage ? `<button type="button" class="text-xs underline" data-action="employee-status" data-id="${esc(item.id)}"
          data-status="${item.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE'}">${item.status === 'INACTIVE' ? 'Reactivate' : 'Deactivate'}</button>` : ''}
      </li>`).join('') : '<li class="py-2 text-sm text-on-surface-variant">No employees yet.</li>'}</ul>
      ${canManage ? `<form id="employee-form" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        ${field({ label: 'Name', name: 'name', required: true })}
        ${field({ label: 'Email', name: 'email', type: 'email' })}
      </form>` : ''}
    </div>`,
    footer: `${button({ label: 'Close', action: 'close-modal' })}${canManage
      ? button({ label: 'Add employee', action: 'employee-add', variant: 'primary' }) : ''}`,
  });
  node.querySelectorAll('[data-action="employee-status"]').forEach(buttonNode => buttonNode.addEventListener('click', async () => {
    try {
      await api.post(`/api/tracker/employees/${buttonNode.dataset.id}/status`, { status: buttonNode.dataset.status });
      closeModal();
      toast('Employee updated.');
      ctx.rerender();
    } catch (error) { toast(error.message, 'danger'); }
  }));
  ctx.on('employee-add', async () => {
    const form = new FormData(node.querySelector('#employee-form'));
    try {
      await api.post('/api/tracker/employees', { name: String(form.get('name')).trim(), email: String(form.get('email') || '') });
      closeModal();
      toast('Employee added.');
      ctx.rerender();
    } catch (error) { toast(error.message, 'danger'); }
  });
}

async function openPlansModal(ctx, { canManage }) {
  const { plans: list } = await api.get('/api/tracker/plans?archived=1');
  const node = modal({
    title: 'Subscription plans',
    body: `<div class="space-y-4">
      <p class="text-sm text-on-surface-variant">Plans decide expiry dates. Prices are never assumed: record them on the subscription.</p>
      <ul class="divide-y divide-outline">${list.map(item => `<li class="flex items-center gap-3 py-2 text-sm">
        <span class="flex-1">${esc(item.label)}
          <span class="text-xs text-on-surface-variant">· ${item.is_lifetime ? 'lifetime' : `${item.duration_months} months`} · ${item.subscription_count} subscription(s)</span></span>
      </li>`).join('') || '<li class="py-2 text-sm text-on-surface-variant">No plans yet.</li>'}</ul>
      ${canManage ? `<form id="plan-form" class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        ${field({ label: 'Label', name: 'label', required: true })}
        ${field({ label: 'Duration (months)', name: 'duration_months', type: 'number', value: '12',
    hint: 'Use 0 for lifetime.' })}
        ${field({ label: 'Lifetime', name: 'is_lifetime', type: 'select',
    options: [{ value: 'false', label: 'No' }, { value: 'true', label: 'Yes' }] })}
      </form>` : ''}
    </div>`,
    footer: `${button({ label: 'Close', action: 'close-modal' })}${canManage
      ? button({ label: 'Add plan', action: 'plan-add', variant: 'primary' }) : ''}`,
  });
  ctx.on('plan-add', async () => {
    const form = new FormData(node.querySelector('#plan-form'));
    const isLifetime = String(form.get('is_lifetime')) === 'true';
    try {
      await api.post('/api/tracker/plans', {
        label: String(form.get('label')).trim(),
        duration_months: isLifetime ? 0 : Number(form.get('duration_months')) || 12, is_lifetime: isLifetime,
      });
      closeModal();
      toast('Plan added.');
      ctx.rerender();
    } catch (error) { toast(error.message, 'danger'); }
  });
}

/* -------------------------------------------------------------------- import */

function openImportModal(ctx) {
  const node = modal({
    title: 'Import customers',
    size: 'wide',
    body: `<div class="space-y-4">
      <p class="text-sm text-on-surface-variant">Upload an .xlsx or .csv file. Nothing is written until you review the mapping and confirm.</p>
      <form id="import-form" class="space-y-3">
        ${field({ label: 'File', name: 'file', type: 'file', className: '',
    hint: 'Use the exported template to keep the column names aligned.' })}
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="skip_duplicates" checked>
          Skip rows that look like an existing customer</label>
      </form>
      <div id="import-preview" class="text-sm text-on-surface-variant">Choose a file to preview its columns.</div>
    </div>`,
    footer: `${button({ label: 'Cancel', action: 'close-modal' })}${button({
      label: 'Preview file', action: 'import-preview', variant: 'primary',
    })}`,
  });
  ctx.on('import-preview', async () => {
    const input = node.querySelector('[name="file"]');
    const file = input.files?.[0];
    if (!file) { toast('Choose a file first.', 'warn'); return; }
    const content = await file.text().catch(() => null);
    const base64 = content !== null && /\.(csv|txt)$/i.test(file.name)
      ? btoa(unescape(encodeURIComponent(content)))
      : await fileToBase64(file);
    try {
      const preview = await api.post('/api/tracker/import/preview', { filename: file.name, content_base64: base64 });
      window.__importPayload = { filename: file.name, content_base64: base64 };
      node.querySelector('#import-preview').innerHTML = `
        <p class="font-medium text-on-surface">${preview.row_count} row(s) · ${preview.headers.length} column(s)</p>
        <div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          ${preview.headers.map(header => field({ label: header, name: `map-${header}`, type: 'select',
    className: '', value: preview.mapping[header] || '',
    options: [{ value: '', label: 'Ignore this column' },
      ...preview.columns.map(column => ({ value: column.key, label: column.label }))] })).join('')}
        </div>
        ${preview.unmatched.length ? `<p class="mt-2">Ignored: ${esc(preview.unmatched.join(', '))}</p>` : ''}`;
      node.querySelector('[data-action="import-preview"]').classList.add('hidden');
    } catch (error) {
      toast(error.message, 'danger');
    }
  });
  ctx.on('import-apply', async () => {
    const payload = window.__importPayload;
    if (!payload) { toast('Preview the file first.', 'warn'); return; }
    const mapping = {};
    for (const select of node.querySelectorAll('[name^="map-"]')) {
      if (select.value) mapping[select.name.replace('map-', '')] = select.value;
    }
    const skip = node.querySelector('[name="skip_duplicates"]')?.checked ?? true;
    try {
      const result = await api.post('/api/tracker/import', { ...payload, mapping, skip_duplicates: skip });
      const { summary, errors, errors_csv: errorsCsv } = result;
      closeModal();
      toast(`Imported ${summary.created} of ${summary.read} row(s); ${summary.failed} refused.`, summary.failed ? 'warn' : 'success');
      if (errors.length) {
        const blob = new Blob([errorsCsv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        modal({
          title: 'Import report',
          body: `<p class="text-sm">${summary.created} created · ${summary.skipped} skipped · ${summary.failed} refused.</p>
            <ul class="mt-3 max-h-[40vh] space-y-1 overflow-y-auto text-sm">${errors.slice(0, 200).map(entry =>
    `<li><span class="num">Row ${entry.row}</span> — ${esc(entry.error)}</li>`).join('')}</ul>`,
          footer: `${button({ label: 'Close', action: 'close-modal' })}${button({
            label: 'Download error report', action: 'import-errors', variant: 'primary',
          })}`,
        });
        document.querySelector('[data-action="import-errors"]').addEventListener('click', () => {
          const link = document.createElement('a');
          link.href = url;
          link.download = 'import-errors.csv';
          link.click();
        });
      }
      ctx.rerender();
    } catch (error) { toast(error.message, 'danger'); }
  });
  // The confirm step appears once the preview succeeds.
  node.querySelector('[data-action="import-preview"]').addEventListener('click', () => {
    setTimeout(() => {
      const footer = node.querySelector('footer');
      if (footer && !footer.querySelector('[data-action="import-apply"]')) {
        footer.insertAdjacentHTML('beforeend', button({ label: 'Import rows', action: 'import-apply', variant: 'accent' }));
      }
    }, 50);
  });
}

const fileToBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

/* -------------------------------------------------------------------- sharing */

async function openShareModal(ctx, { shareType, columns, data }) {
  const isPublic = shareType === 'PUBLIC';
  const selectable = columns.filter(column => column.key !== 'serial' || true);
  const node = modal({
    title: isPublic ? 'Create public link' : 'Share privately',
    size: 'wide',
    body: `<div class="space-y-4">
      ${isPublic ? alertBox('A public link can be forwarded. Anyone with the link can read the columns you choose here - never share a link that exposes more than it must.', 'warn') : ''}
      <form id="share-form" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        ${field({ label: 'Share title', name: 'title', required: true, value: isPublic ? 'POS customer list' : 'POS customers' })}
        ${field({ label: 'Records', name: 'scope', type: 'select',
    options: [{ value: 'selected', label: `Selected customers (${state.selected.size})` }, { value: 'all', label: 'Every customer' }] })}
        ${isPublic
    ? field({ label: 'Password (optional)', name: 'password', type: 'text', hint: 'At least 8 characters.' })
      + field({ label: 'Expires on (optional)', name: 'expires_at', type: 'date' })
    : field({ label: 'Share with account emails', name: 'recipients', className: 'sm:col-span-2',
      hint: 'Comma separated. Each address must already have an application account.' })}
        ${isPublic ? field({ label: 'Expires on (optional)', name: 'expires_at', type: 'date' }) : ''}
        <fieldset class="sm:col-span-2">
          <legend class="label-technical mb-2">Columns shared</legend>
          <label class="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" name="all-columns" checked>
            All columns</label>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
            ${selectable.map(column => `<label class="flex items-center gap-2 text-sm">
              <input type="checkbox" name="column" value="${esc(column.key)}" checked>
              ${esc(column.label)}${['remarks'].includes(column.key) ? ' <span class="text-xs text-on-surface-variant">(sensitive)</span>' : ''}
            </label>`).join('')}
          </div>
        </fieldset>
        <fieldset class="sm:col-span-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="allow_search" checked> Allow search</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="allow_filter" checked> Allow filters</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="allow_download"> Allow downloads</label>
        </fieldset>
        ${isPublic ? `<label class="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="confirm_public">
          <span>I understand this link is public and read-only, and that it can be copied or forwarded.</span></label>` : ''}
      </form>
      <div id="share-result"></div>
    </div>`,
    footer: `${button({ label: 'Cancel', action: 'close-modal' })}${button({
      label: isPublic ? 'Create public link' : 'Share read-only', action: 'share-create', variant: 'primary',
    })}`,
  });
  const allColumns = node.querySelector('[name="all-columns"]');
  allColumns.addEventListener('change', () => {
    for (const box of node.querySelectorAll('[name="column"]')) box.checked = allColumns.checked;
  });
  ctx.on('share-create', async () => {
    const form = new FormData(node.querySelector('#share-form'));
    const chosen = [...node.querySelectorAll('[name="column"]')].filter(box => box.checked).map(box => box.value);
    const payload = {
      title: String(form.get('title')).trim(),
      scope_all: String(form.get('scope')) === 'all',
      customer_ids: String(form.get('scope')) === 'all' ? [] : [...state.selected],
      columns: chosen,
      allow_search: form.get('allow_search') !== null, allow_filter: form.get('allow_filter') !== null,
      allow_download: form.get('allow_download') !== null,
      expires_at: form.get('expires_at') ? new Date(`${form.get('expires_at')}T23:59:00Z`).toISOString() : null,
    };
    if (!payload.columns.length) { toast('Choose at least one column to share.', 'warn'); return; }
    if (isPublic) {
      payload.confirm_public = true;
      payload.password = String(form.get('password') || '') || null;
    } else {
      payload.recipients = String(form.get('recipients') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
      if (!payload.recipients.length) { toast('Add at least one account email.', 'warn'); return; }
    }
    try {
      const result = await api.post(`/api/shares?type=${isPublic ? 'public' : 'private'}`, payload);
      const link = result.token ? `${location.origin}/#/shared/${result.token}` : null;
      node.querySelector('#share-result').innerHTML = isPublic
        ? `<div class="mt-4 border border-outline p-3">
            <p class="label-technical">Public link</p>
            <p class="mt-1 break-all font-mono text-xs">${esc(link)}</p>
            <div class="mt-2 flex gap-2">
              <button type="button" class="text-xs underline" data-action="copy-link">Copy link</button>
              <a class="text-xs underline" href="#/shared/${esc(result.token)}" target="_blank" rel="noopener">Preview</a>
            </div>
            ${(result.warnings || []).map(message => `<p class="mt-2 text-xs text-on-surface-variant">${esc(message)}</p>`).join('')}
          </div>`
        : `<p class="mt-4 text-sm">Shared read-only with ${esc(result.share.recipients.join(', '))}. They can view and search the permitted rows, and cannot edit anything.</p>`;
      if (isPublic) {
        node.querySelector('[data-action="copy-link"]')?.addEventListener('click', async () => {
          await navigator.clipboard?.writeText(link).catch(() => {});
          toast('Link copied.');
        });
      }
      toast(isPublic ? 'Public link created.' : 'Share created.');
    } catch (error) { toast(error.message, 'danger'); }
  });
}

// openCustomerModal is already exported where it is declared.
export { openColumnModal };

/* ------------------------------------------------------------ customer edit */

export async function openCustomerEditModal(ctx, { customerId, reference, products }) {
  let detail;
  try {
    detail = await api.get(`/api/tracker/customers/${customerId}`);
  } catch (error) {
    toast(error.message, 'danger');
    return;
  }
  const customer = detail.customer;
  const customValues = detail.custom || [];

  let ref = reference;
  if (!ref || !ref.employees || !ref.plans || !ref.columns) {
    try {
      ref = await api.get('/api/tracker/reference');
    } catch {
      ref = { employees: [], plans: [], columns: [], custom_fields: [] };
    }
  }

  const employees = (ref.employees || []).filter(e => e.status === 'ACTIVE' || e.id === customer.employee_id);
  const customDefs = (ref.custom_fields || ref.customFields || []).filter(f => !f.status || f.status === 'ACTIVE');

  const customFieldsHtml = customDefs.length > 0 ? `
    <div class="sm:col-span-2 border-t border-outline pt-3 mt-1">
      <p class="label-technical mb-2 font-semibold text-on-surface">Custom Fields</p>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        ${customDefs.map(def => {
          const stored = customValues.find(v => v.definition_id === def.id)?.value ?? def.default_value ?? '';
          let fieldType = 'text';
          if (def.field_type === 'DATE') fieldType = 'date';
          else if (['NUMBER', 'CURRENCY'].includes(def.field_type)) fieldType = 'number';
          else if (def.field_type === 'LONG_TEXT') fieldType = 'textarea';
          else if (def.field_type === 'EMAIL') fieldType = 'email';
          
          const opts = def.field_type === 'DROPDOWN' && Array.isArray(def.options)
            ? [{ value: '', label: 'Select option' }, ...def.options.map(o => ({ value: o, label: o }))]
            : undefined;

          return field({
            label: def.label,
            name: `custom-${def.id}`,
            type: fieldType,
            value: stored,
            options: opts,
            hint: def.description || '',
            required: def.required,
          });
        }).join('')}
      </div>
    </div>
  ` : '';

  const formHtml = `
    <form id="customer-edit-form" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      ${field({ label: 'Customer Name', name: 'name', required: true, value: customer.name || '' })}
      ${field({ label: 'Customer Business Name', name: 'business_name', value: customer.business_name || '', hint: 'Restaurant, shop or company name.' })}
      ${field({ label: 'Address', name: 'address', type: 'textarea', className: 'sm:col-span-2', value: customer.address || '' })}
      ${field({
        label: 'Employee Assigned', name: 'employee_id', type: 'select', value: customer.employee_id || '',
        options: [{ value: '', label: 'Not assigned' }, ...employees.map(e => ({ value: e.id, label: e.name }))]
      })}
      ${field({
        label: 'Customer Status', name: 'status', type: 'select', value: customer.status || 'ACTIVE',
        options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'ARCHIVED', label: 'Archived' }]
      })}
      ${field({ label: 'Phone', name: 'phone', type: 'text', value: customer.phone || '' })}
      ${field({ label: 'Email', name: 'email', type: 'email', value: customer.email || '' })}
      ${field({ label: 'Remarks', name: 'remarks', type: 'textarea', className: 'sm:col-span-2', value: customer.remarks || '' })}
      ${customFieldsHtml}
    </form>
  `;

  const node = modal({
    title: `Edit Customer · ${esc(customer.name)}`,
    size: 'wide',
    body: formHtml,
    footer: `${button({ label: 'Cancel', action: 'edit-cancel' })}${button({ label: 'Save changes', action: 'edit-save', variant: 'primary' })}`,
  });

  const formEl = node.querySelector('#customer-edit-form');
  const initialData = new FormData(formEl);

  const isFormDirty = () => {
    const current = new FormData(formEl);
    for (const [key, value] of initialData.entries()) {
      if (current.get(key) !== value) return true;
    }
    return false;
  };

  node.querySelector('[data-action="edit-cancel"]')?.addEventListener('click', () => {
    if (isFormDirty() && !window.confirm('You have unsaved changes. Discard them?')) return;
    closeModal();
  });

  let isSaving = false;
  node.querySelector('[data-action="edit-save"]')?.addEventListener('click', async () => {
    if (isSaving) return;
    if (typeof formEl.reportValidity === 'function' && !formEl.reportValidity()) return;

    const form = new FormData(formEl);
    const name = String(form.get('name') || '').trim();
    if (!name) {
      toast('Customer Name is required.', 'danger');
      formEl.querySelector('[name="name"]')?.focus();
      return;
    }

    const payload = {
      name,
      business_name: String(form.get('business_name') || '').trim(),
      address: String(form.get('address') || '').trim(),
      employee_id: String(form.get('employee_id') || '') || null,
      status: String(form.get('status') || 'ACTIVE'),
      phone: String(form.get('phone') || '').trim(),
      email: String(form.get('email') || '').trim(),
      remarks: String(form.get('remarks') || '').trim(),
      expected_updated_at: customer.updated_at,
    };

    const customValuesPayload = customDefs.map(def => ({
      definition_id: def.id,
      value: String(form.get(`custom-${def.id}`) ?? '').trim(),
    }));

    isSaving = true;
    const saveBtn = node.querySelector('[data-action="edit-save"]');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.setAttribute('aria-busy', 'true');
      saveBtn.innerText = 'Saving…';
    }

    try {
      await api.patch(`/api/tracker/customers/${customerId}`, payload);
      if (customValuesPayload.length > 0) {
        await api.put(`/api/tracker/customers/${customerId}/fields`, { values: customValuesPayload });
      }
      closeModal();
      toast('Customer saved successfully.');
      ctx.rerender();
    } catch (error) {
      toast(error.message || 'Failed to save customer.', 'danger');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.removeAttribute('aria-busy');
        saveBtn.innerText = 'Save changes';
      }
    } finally {
      isSaving = false;
    }
  });
}

/* ------------------------------------------------------------ purchase edit */

export function openSubscriptionEditModal(ctx, { subscriptionId, customer, subscriptions, products = [], plans = [] }) {
  const sub = subscriptions.find(s => s.id === subscriptionId);
  if (!sub) {
    toast('Subscription record not found.', 'danger');
    return;
  }

  const isLinkedToInvoice = Boolean(sub.invoice_id);
  const productList = Array.isArray(products) ? products : [];
  const planList = Array.isArray(plans) ? plans : [];

  const bodyHtml = `
    <div class="space-y-4">
      ${isLinkedToInvoice ? alertBox(`This purchase was created from Invoice #${sub.transaction_reference || ''}. Financial transaction records are protected from direct modification.`, 'info') : ''}
      <form id="subscription-edit-form" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        ${field({
          label: 'Product', name: 'product_id', type: 'select', value: sub.product_id || '',
          options: [{ value: '', label: 'Not selected' }, ...productList.map(p => ({ value: p.value || p.id, label: p.label || p.name }))]
        })}
        ${field({
          label: 'Plan', name: 'plan_id', type: 'select', value: sub.plan_id || '',
          options: [{ value: '', label: 'Not selected' }, ...planList.map(p => ({ value: p.id, label: `${p.label}${p.is_lifetime ? ' (lifetime)' : ` · ${p.duration_months} months`}` }))]
        })}
        ${field({ label: 'Date of Purchase', name: 'purchase_date', type: 'date', required: true, value: sub.purchase_date || '' })}
        ${field({
          label: 'Date of Expiry', name: 'expiry_date', type: 'date', value: sub.is_lifetime ? '' : (sub.expiry_date || ''),
          hint: 'Leave blank for a lifetime plan.'
        })}
        ${field({
          label: 'Status', name: 'status', type: 'select', value: sub.status || 'ACTIVE',
          options: [
            { value: 'ACTIVE', label: 'Active (Running)' },
            { value: 'EXPIRED', label: 'Expired' },
            { value: 'CANCELLED', label: 'Cancelled' },
            { value: 'TRIAL', label: 'Trial' },
          ]
        })}
        ${field({
          label: 'Amount Recorded (₹)', name: 'amount', type: 'number', step: '0.01',
          value: sub.amount_minor !== null && sub.amount_minor !== undefined ? (Number(sub.amount_minor) / 100).toFixed(2) : '',
          attributes: isLinkedToInvoice ? 'readonly disabled' : '',
          hint: isLinkedToInvoice ? 'Protected (linked to invoice)' : 'Optional. Paise are stored exactly.'
        })}
        ${field({
          label: 'Transaction / Invoice Reference', name: 'transaction_reference',
          value: sub.transaction_reference || '',
          attributes: isLinkedToInvoice ? 'readonly disabled' : '',
          hint: isLinkedToInvoice ? 'Protected (linked to invoice)' : 'Invoice or receipt reference'
        })}
        ${field({
          label: 'Notes / Remarks', name: 'notes', type: 'textarea', className: 'sm:col-span-2',
          value: sub.notes || ''
        })}
      </form>
    </div>
  `;

  const node = modal({
    title: `Edit Purchase · ${esc(sub.product_name || sub.plan_label || 'Purchase')}`,
    size: 'wide',
    body: bodyHtml,
    footer: `${button({ label: 'Cancel', action: 'sub-edit-cancel' })}${button({ label: 'Save changes', action: 'sub-edit-save', variant: 'primary' })}`,
  });

  const formEl = node.querySelector('#subscription-edit-form');
  const initialData = new FormData(formEl);

  const isFormDirty = () => {
    const current = new FormData(formEl);
    for (const [key, value] of initialData.entries()) {
      if (current.get(key) !== value) return true;
    }
    return false;
  };

  node.querySelector('[data-action="sub-edit-cancel"]')?.addEventListener('click', () => {
    if (isFormDirty() && !window.confirm('Discard unsaved purchase changes?')) return;
    closeModal();
  });

  let isSaving = false;
  node.querySelector('[data-action="sub-edit-save"]')?.addEventListener('click', async () => {
    if (isSaving) return;
    if (typeof formEl.reportValidity === 'function' && !formEl.reportValidity()) return;

    const form = new FormData(formEl);
    const productId = String(form.get('product_id') || '') || null;
    const planId = String(form.get('plan_id') || '') || null;
    const purchaseDate = String(form.get('purchase_date') || '');
    const expiry = String(form.get('expiry_date') || '');
    const chosenPlan = planList.find(p => p.id === planId);
    const isLifetime = !expiry && (chosenPlan?.is_lifetime || chosenPlan?.duration_months === 0);

    if (!purchaseDate) {
      toast('Date of Purchase is required.', 'danger');
      return;
    }

    let amountMinor = sub.amount_minor;
    let txRef = sub.transaction_reference;
    if (!isLinkedToInvoice) {
      const amtStr = String(form.get('amount') || '').trim();
      amountMinor = amtStr ? Math.round(Number(amtStr) * 100) : null;
      txRef = String(form.get('transaction_reference') || '').trim();
    }

    const payload = {
      product_id: productId,
      plan_id: planId,
      plan_label: chosenPlan?.label || sub.plan_label || '',
      purchase_date: purchaseDate,
      start_date: purchaseDate,
      expiry_date: isLifetime ? null : (expiry || null),
      is_lifetime: Boolean(isLifetime),
      status: String(form.get('status') || 'ACTIVE'),
      amount_minor: amountMinor,
      transaction_reference: txRef,
      notes: String(form.get('notes') || '').trim(),
    };

    isSaving = true;
    const saveBtn = node.querySelector('[data-action="sub-edit-save"]');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.setAttribute('aria-busy', 'true');
      saveBtn.innerText = 'Saving…';
    }

    try {
      await api.patch(`/api/tracker/subscriptions/${subscriptionId}`, payload);
      closeModal();
      toast('Purchase updated.');
      ctx.rerender();
    } catch (error) {
      toast(error.message || 'Failed to update purchase.', 'danger');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.removeAttribute('aria-busy');
        saveBtn.innerText = 'Save changes';
      }
    } finally {
      isSaving = false;
    }
  });
}

/* ------------------------------------------------------------ delete modals */

export function confirmDeleteCustomerModal(ctx, { customerId, customerName, businessName }) {
  const node = modal({
    title: 'Delete Customer',
    body: `
      <div class="space-y-3">
        <p class="text-sm">Are you sure you want to permanently delete customer <strong>${esc(customerName)}</strong>${businessName ? ` (${esc(businessName)})` : ''}?</p>
        <div class="border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <strong>Warning:</strong> This permanently erases the customer profile, custom fields, and unlinked purchase history. This action cannot be undone.
        </div>
        <p class="text-xs text-on-surface-variant">Customers with issued invoices or recorded payments cannot be permanently deleted to protect financial records, and must be archived instead.</p>
        <div id="delete-error-area" class="mt-2"></div>
      </div>
    `,
    footer: `${button({ label: 'Cancel', action: 'delete-cancel' })}${button({ label: 'Delete Customer', action: 'delete-confirm', variant: 'danger' })}`,
  });

  node.querySelector('[data-action="delete-cancel"]')?.addEventListener('click', () => closeModal());

  let isDeleting = false;
  node.querySelector('[data-action="delete-confirm"]')?.addEventListener('click', async () => {
    if (isDeleting) return;
    isDeleting = true;
    const delBtn = node.querySelector('[data-action="delete-confirm"]');
    if (delBtn) {
      delBtn.disabled = true;
      delBtn.setAttribute('aria-busy', 'true');
      delBtn.innerText = 'Deleting…';
    }

    try {
      await api.delete(`/api/tracker/customers/${customerId}`);
      closeModal();
      toast('Customer permanently deleted.');
      if (location.hash.startsWith('#/tracker/')) {
        ctx.navigate('#/tracker');
      } else {
        ctx.rerender();
      }
    } catch (error) {
      const errArea = node.querySelector('#delete-error-area');
      if (errArea) {
        errArea.innerHTML = `
          <div class="border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 space-y-2">
            <p><strong>Cannot Delete:</strong> ${esc(error.message)}</p>
            <button type="button" class="btn btn-primary text-xs py-1 px-3" data-action="archive-instead">Archive Customer Instead</button>
          </div>
        `;
        errArea.querySelector('[data-action="archive-instead"]')?.addEventListener('click', async () => {
          try {
            await api.post(`/api/tracker/customers/${customerId}/status`, { status: 'ARCHIVED' });
            closeModal();
            toast('Customer archived.');
            ctx.rerender();
          } catch (archiveErr) {
            toast(archiveErr.message, 'danger');
          }
        });
      }
      toast(error.message || 'Failed to delete customer.', 'danger');
      if (delBtn) {
        delBtn.disabled = false;
        delBtn.removeAttribute('aria-busy');
        delBtn.innerText = 'Delete Customer';
      }
    } finally {
      isDeleting = false;
    }
  });
}

export function confirmDeletePurchaseModal(ctx, { subscriptionId, productName, planName, purchaseDate }) {
  const node = modal({
    title: 'Delete Purchase Record',
    body: `
      <div class="space-y-3">
        <p class="text-sm">Are you sure you want to permanently delete the purchase record for <strong>${esc(productName || 'Unknown product')}</strong> (${esc(planName || 'Plan')}) purchased on <strong>${esc(purchaseDate)}</strong>?</p>
        <div class="border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <strong>Warning:</strong> Deleting this purchase will permanently remove this subscription record. Other purchases for this customer will remain untouched. Purchases linked to issued invoices cannot be deleted.
        </div>
      </div>
    `,
    footer: `${button({ label: 'Cancel', action: 'delete-sub-cancel' })}${button({ label: 'Delete Purchase', action: 'delete-sub-confirm', variant: 'danger' })}`,
  });

  node.querySelector('[data-action="delete-sub-cancel"]')?.addEventListener('click', () => closeModal());

  let isDeleting = false;
  node.querySelector('[data-action="delete-sub-confirm"]')?.addEventListener('click', async () => {
    if (isDeleting) return;
    isDeleting = true;
    const delBtn = node.querySelector('[data-action="delete-sub-confirm"]');
    if (delBtn) {
      delBtn.disabled = true;
      delBtn.setAttribute('aria-busy', 'true');
      delBtn.innerText = 'Deleting…';
    }

    try {
      await api.delete(`/api/tracker/subscriptions/${subscriptionId}`);
      closeModal();
      toast('Purchase record deleted.');
      ctx.rerender();
    } catch (error) {
      toast(error.message || 'Failed to delete purchase record.', 'danger');
      if (delBtn) {
        delBtn.disabled = false;
        delBtn.removeAttribute('aria-busy');
        delBtn.innerText = 'Delete Purchase';
      }
    } finally {
      isDeleting = false;
    }
  });
}

/* ------------------------------------------------------------ customer detail */

async function renderCustomer(container, params, ctx) {
  const id = params.segments[1];
  container.innerHTML = loading();
  let detail;
  try {
    detail = await api.get(`/api/tracker/customers/${id}`);
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Customer', breadcrumb: '<a href="#/tracker">POS Customers</a>' })
      + alertBox(error.message, 'warn');
    return;
  }
  const { customer, subscriptions, custom, days_to_expiry: days } = detail;
  let products = [];
  let reference = { columns: [], plans: [], employees: [] };
  try {
    const [refData, productsData] = await Promise.all([
      api.get('/api/tracker/reference'),
      api.get('/api/products?limit=100&status=ACTIVE').catch(() => ({ products: [] })),
    ]);
    reference = refData;
    products = (productsData?.products || []).map(p => ({ value: p.id, label: p.name }));
  } catch {
    reference = await api.get('/api/tracker/reference');
  }
  const { columns, plans, employees } = reference;
  const customColumns = columns.filter(column => column.custom);
  const errors = warnings(customer.warnings || []);

  container.innerHTML = `
    ${pageHeader({
    title: customer.name,
    breadcrumb: `<a class="hover:text-on-surface" href="#/tracker">POS Customers</a> / ${esc(customer.name)}`,
    subtitle: 'One customer, every purchase. A renewal adds a subscription instead of replacing the old one.',
    actions: `${button({ label: 'Back to tracker', action: 'tracker-back' })}
      ${button({ label: 'Edit Customer', action: 'customer-edit', attributes: `data-id="${esc(customer.id)}"`, variant: 'primary' })}
      ${customer.status === 'ARCHIVED'
    ? button({ label: 'Restore', action: 'customer-status', attributes: 'data-status="ACTIVE"' })
    : button({ label: 'Archive', action: 'customer-status', attributes: 'data-status="ARCHIVED"' })}
      ${button({ label: 'Delete Customer', action: 'customer-delete', attributes: `data-id="${esc(customer.id)}"`, variant: 'danger' })}`,
  })}
    ${errors}
    <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div class="space-y-4 xl:col-span-2">
        ${card({
    title: 'Subscriptions',
    subtitle: 'Purchase history, newest first.',
    actions: button({ label: 'Add purchase or renewal', action: 'subscription-add', variant: 'primary' }),
    body: subscriptions.length ? `<div class="overflow-x-auto"><table class="data-table w-full min-w-[720px]">
      <thead><tr>
        <th>Product</th><th>Plan</th><th>Purchased</th><th>Expires</th><th>Status</th><th>Reference</th><th class="text-right">Actions</th>
      </tr></thead>
      <tbody>${subscriptions.map(item => `<tr>
        <td>${esc(item.product_name || 'Not set')}</td>
        <td>${esc(item.plan_name || item.plan_label || 'Not set')}</td>
        <td>${esc(item.purchase_date)}</td>
        <td>${item.is_lifetime ? 'Lifetime' : esc(item.expiry_date || '—')}</td>
        <td>${badge(item.status === 'ACTIVE' ? 'Running' : titleCase(item.status),
      item.status === 'ACTIVE' ? 'success' : 'neutral')}</td>
        <td class="text-xs">${esc(item.transaction_reference || '—')}</td>
        <td class="text-right whitespace-nowrap">
          ${button({ label: 'Edit', action: 'subscription-edit', attributes: `data-id="${esc(item.id)}"`, size: 'sm' })}
          ${button({ label: 'Delete', action: 'subscription-delete', attributes: `data-id="${esc(item.id)}"`, variant: 'danger', size: 'sm' })}
        </td>
      </tr>`).join('')}</tbody></table></div>`
      : '<p class="px-5 py-4 text-sm text-on-surface-variant">No subscription recorded yet.</p>',
  })}

        ${card({
    title: 'Custom fields',
    body: customColumns.length ? `<form id="custom-form" class="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
          ${customColumns.map(column => field({
      label: column.label, name: `field-${column.definition_id}`,
      type: column.type === 'DATE' ? 'date' : ['NUMBER', 'CURRENCY'].includes(column.type) ? 'number' : 'text',
      value: custom.find(item => item.definition_id === column.definition_id)?.value || '',
      options: column.type === 'DROPDOWN' ? column.options.map(option => ({ value: option, label: option })) : undefined,
      hint: column.description || '',
    })).join('')}
          <div class="sm:col-span-2">${button({ label: 'Save custom fields', action: 'custom-save', variant: 'primary' })}</div>
        </form>` : '<p class="px-5 py-4 text-sm text-on-surface-variant">No custom columns yet.</p>',
  })}
      </div>

      <div class="space-y-4">
        ${card({
    title: 'Customer',
    actions: button({ label: 'Edit', action: 'customer-edit', attributes: `data-id="${esc(customer.id)}"`, size: 'sm' }),
    body: `<dl class="px-5 py-3 text-sm">
          ${[['Customer name', customer.name], ['Business name', customer.business_name || '—'], ['Employee', customer.employee_name || 'Not assigned'],
    ['Address', customer.address || '—'], ['Phone', customer.phone || '—'], ['Email', customer.email || '—'],
    ['Remarks', customer.remarks || '—'],
    ['Status', titleCase(customer.status)], ['Added', String(customer.created_at).slice(0, 10)]]
    .map(([label, value]) => `<div class="flex justify-between gap-3 border-b border-outline py-1.5">
            <dt class="text-on-surface-variant">${esc(label)}</dt><dd class="text-right break-all">${esc(value)}</dd></div>`).join('')}
        </dl>`,
  })}
        ${card({
    title: 'Renewal',
    body: `<div class="px-5 py-3 text-sm">
          ${days === null ? '<p class="text-on-surface-variant">No expiry tracked.</p>'
    : days < 0 ? `<p class="font-medium">Expired ${Math.abs(days)} day(s) ago.</p>`
      : `<p class="font-medium">Expires in ${days} day(s).</p>`}
        </div>`,
  })}
      </div>
    </div>`;

  ctx.on('tracker-back', () => ctx.navigate('#/tracker'));
  ctx.on('customer-edit', () => {
    openCustomerEditModal(ctx, { customerId: id, reference, products });
  });
  ctx.on('customer-delete', () => {
    confirmDeleteCustomerModal(ctx, {
      customerId: id,
      customerName: customer.name,
      businessName: customer.business_name || '',
    });
  });
  ctx.on('customer-status', async trigger => {
    try {
      await api.post(`/api/tracker/customers/${id}/status`, { status: trigger.dataset.status });
      toast('Customer updated.');
      ctx.rerender();
    } catch (error) { toast(error.message, 'danger'); }
  });
  ctx.on('custom-save', async () => {
    const form = new FormData(container.querySelector('#custom-form'));
    const values = customColumns.map(column => ({
      definition_id: column.definition_id, value: String(form.get(`field-${column.definition_id}`) ?? ''),
    }));
    try {
      await api.put(`/api/tracker/customers/${id}/fields`, { values });
      toast('Custom fields saved.');
    } catch (error) { toast(error.message, 'danger'); }
  });
  ctx.on('subscription-edit', trigger => {
    openSubscriptionEditModal(ctx, {
      subscriptionId: trigger.dataset.id,
      customer,
      subscriptions,
      products,
      plans,
    });
  });
  ctx.on('subscription-delete', trigger => {
    const sub = subscriptions.find(s => s.id === trigger.dataset.id);
    confirmDeletePurchaseModal(ctx, {
      subscriptionId: trigger.dataset.id,
      productName: sub?.product_name || sub?.plan_label || 'Purchase',
      planName: sub?.plan_name || sub?.plan_label || 'Plan',
      purchaseDate: sub?.purchase_date || '',
    });
  });
  ctx.on('subscription-add', () => {
    const node = modal({
      title: `Add purchase or renewal · ${customer.name}`,
      body: `<form id="subscription-form" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        ${field({ label: 'Product', name: 'product_id', type: 'select',
    options: [{ value: '', label: 'Not selected' }, ...products.map(p => ({ value: p.value || p.id, label: p.label || p.name }))] })}
        ${field({ label: 'Plan', name: 'plan_id', type: 'select',
    options: [{ value: '', label: 'Not selected' }, ...plans.map(plan => ({ value: plan.id, label: plan.label }))] })}
        ${field({ label: 'Date of purchase', name: 'purchase_date', type: 'date',
    value: new Date().toISOString().slice(0, 10) })}
        ${field({ label: 'Date of expiry', name: 'expiry_date', type: 'date', hint: 'Leave blank for a lifetime plan.' })}
        ${field({ label: 'Amount recorded', name: 'amount', type: 'number', hint: 'Optional. Paise are stored exactly.' })}
        ${field({ label: 'Transaction reference', name: 'transaction_reference' })}
        <label class="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="renews" checked> This replaces the current subscription (a renewal)</label>
      </form>`,
      footer: `${button({ label: 'Cancel', action: 'close-modal' })}${button({
        label: 'Add subscription', action: 'subscription-save', variant: 'primary',
      })}`,
    });
    let isSaving = false;
    ctx.on('subscription-save', async () => {
      if (isSaving) return;
      isSaving = true;
      const saveBtn = node.querySelector('[data-action="subscription-save"]');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.setAttribute('aria-busy', 'true');
      }
      const form = new FormData(node.querySelector('#subscription-form'));
      const expiry = String(form.get('expiry_date') || '');
      const amount = String(form.get('amount') || '');
      try {
        await api.post(`/api/tracker/customers/${id}/subscriptions`, {
          product_id: String(form.get('product_id')) || null, plan_id: String(form.get('plan_id')) || null,
          purchase_date: String(form.get('purchase_date')), start_date: String(form.get('purchase_date')),
          expiry_date: expiry || null, is_lifetime: !expiry, status: 'ACTIVE',
          amount_minor: amount ? Math.round(Number(amount) * 100) : null,
          transaction_reference: String(form.get('transaction_reference') || ''),
          renews: form.get('renews') !== null,
        });
        closeModal();
        toast('Subscription added.');
        ctx.rerender();
      } catch (error) {
        toast(error.message || 'Failed to save subscription.', 'danger');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.removeAttribute('aria-busy');
        }
      } finally {
        isSaving = false;
      }
    });
  });
  void employees;
}
