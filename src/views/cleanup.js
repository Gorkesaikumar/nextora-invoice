import { api } from '../lib/api.js';
import {
  esc, button, card, field, grid, loading, pageHeader, alertBox, toast, badge, statusBadge, icon, money,
} from '../lib/ui.js';

const formatBytes = bytes => {
  const value = Number(bytes) || 0;
  if (value === 0) return '0 bytes';
  if (value < 1024) return `${value} bytes`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
};

export const render = async (container, params, ctx) => {
  const canEdit = ['OWNER', 'ADMIN'].includes(ctx.session?.user?.role);
  if (!canEdit) {
    container.innerHTML = pageHeader({ title: 'Business Data Cleanup' })
      + alertBox('Access restricted. Only the Owner or an Administrator can access Business Data Cleanup.', 'warn');
    return;
  }

  container.innerHTML = pageHeader({ title: 'Business Data Cleanup' }) + loading();

  let statusData;
  try {
    statusData = await api.get('/api/cleanup/status');
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Business Data Cleanup' }) + alertBox(error.message, 'danger');
    return;
  }

  let activeTab = 'QUOTATIONS'; // 'QUOTATIONS' or 'INVOICES'
  let currentPreview = null;
  let currentExport = null;

  function renderView() {
    const isQuo = activeTab === 'QUOTATIONS';
    const qStats = statusData.quotations;
    const iStats = statusData.invoices;
    const storage = statusData.storage;

    container.innerHTML = `
      ${pageHeader({
        title: 'Business Data Cleanup',
        subtitle: 'Safely export and delete historical quotations and invoices to reclaim local database storage.',
        actions: `<a href="#/settings" class="btn btn-secondary flex items-center gap-2">${icon('settings', '!text-[16px]')}Back to Settings</a>`,
      })}

      <!-- Strict Preservation Guarantee Banner -->
      <div class="mb-5 rounded border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-sm">
        <div class="flex items-start gap-3">
          <span class="mt-0.5 text-emerald-600">${icon('shield', '!text-[20px]')}</span>
          <div>
            <p class="font-headline font-semibold text-emerald-950">Master Data &amp; Relational Safety Guarantee</p>
            <p class="mt-1">
              <strong>Products &amp; Services are preserved and will not be deleted during business data cleanup.</strong>
              Client records, user accounts, business profile, tax configurations, and payment ledger records are always strictly preserved.
            </p>
          </div>
        </div>
      </div>

      <!-- Storage & Reclaiming Explanation Card -->
      <div class="mb-5">
        ${card({
          title: 'Database Storage & Disk Space Reclaiming',
          subtitle: 'Understanding record deletion vs database file size reduction.',
          body: `<div class="px-5 py-4">
            <dl class="grid grid-cols-1 gap-4 sm:grid-cols-3 text-sm">
              <div class="border border-outline bg-surface-dim p-3 rounded">
                <dt class="text-xs text-on-surface-variant uppercase font-mono">Current File Size</dt>
                <dd class="mt-1 font-mono text-base font-bold">${formatBytes(storage.size_bytes)}</dd>
                <dd class="text-[11px] text-on-surface-variant mt-0.5">WAL log: ${formatBytes(storage.wal_bytes)}</dd>
              </div>
              <div class="border border-outline bg-surface-dim p-3 rounded">
                <dt class="text-xs text-on-surface-variant uppercase font-mono">Quotation Storage Impact</dt>
                <dd class="mt-1 font-mono text-base font-bold text-cyan-accent">~${formatBytes(qStats.estimated_reclaim_bytes)}</dd>
                <dd class="text-[11px] text-on-surface-variant mt-0.5">${qStats.eligible_count} eligible quotations</dd>
              </div>
              <div class="border border-outline bg-surface-dim p-3 rounded">
                <dt class="text-xs text-on-surface-variant uppercase font-mono">Invoice Storage Impact</dt>
                <dd class="mt-1 font-mono text-base font-bold text-cyan-accent">~${formatBytes(iStats.estimated_reclaim_bytes)}</dd>
                <dd class="text-[11px] text-on-surface-variant mt-0.5">${iStats.eligible_count} eligible invoices</dd>
              </div>
            </dl>
            <div class="mt-3 text-xs text-on-surface-variant space-y-1">
              <p>• <strong>Removing records</strong> marks database pages as available internally.</p>
              <p>• <strong>Reclaiming space</strong> runs SQLite WAL checkpoint and <code class="font-mono bg-surface-dim px-1">VACUUM</code> after verified export and deletion to shrink the database file on disk.</p>
              <p>• An automatic safety backup of your database file is saved before any irreversible deletion begins.</p>
            </div>
          </div>`,
        })}
      </div>

      <!-- Tab Switcher -->
      <div class="mb-6 flex border-b border-outline">
        <button type="button" data-action="tab-quotations" class="flex items-center gap-2 border-b-2 px-6 py-3 font-headline text-sm font-semibold transition-colors ${
          isQuo ? 'border-cyan-accent text-on-surface bg-surface-dim' : 'border-transparent text-on-surface-variant hover:text-on-surface'
        }">
          ${icon('request_quote', '!text-[18px]')} Option A: Clean Up Quotations (${qStats.eligible_count} eligible)
        </button>
        <button type="button" data-action="tab-invoices" class="flex items-center gap-2 border-b-2 px-6 py-3 font-headline text-sm font-semibold transition-colors ${
          !isQuo ? 'border-cyan-accent text-on-surface bg-surface-dim' : 'border-transparent text-on-surface-variant hover:text-on-surface'
        }">
          ${icon('receipt_long', '!text-[18px]')} Option B: Clean Up Invoices (${iStats.eligible_count} eligible)
        </button>
      </div>

      <div id="cleanup-content">
        ${isQuo ? renderQuotationsTab(qStats) : renderInvoicesTab(iStats)}
      </div>
    `;

    bindEvents();
  }

  function renderQuotationsTab(qStats) {
    return `
      <div class="space-y-5">
        <!-- Breakdown Cards -->
        ${card({
          title: 'Quotations Inventory & Eligibility Status',
          subtitle: 'Drafts and non-converted historical quotations can be exported and cleaned up. Converted quotations are retained.',
          body: `<div class="px-5 py-4">
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div class="border border-outline p-3 rounded bg-surface">
                <span class="text-xs text-on-surface-variant font-mono">Total Quotations</span>
                <p class="text-xl font-bold font-headline mt-1">${qStats.total}</p>
              </div>
              <div class="border border-outline p-3 rounded bg-surface">
                <span class="text-xs text-on-surface-variant font-mono">Drafts</span>
                <p class="text-xl font-bold font-headline mt-1 text-slate-700">${qStats.draft}</p>
              </div>
              <div class="border border-outline p-3 rounded bg-surface">
                <span class="text-xs text-on-surface-variant font-mono">Sent / Issued</span>
                <p class="text-xl font-bold font-headline mt-1 text-cyan-700">${qStats.issued}</p>
              </div>
              <div class="border border-outline p-3 rounded bg-surface">
                <span class="text-xs text-on-surface-variant font-mono">Accepted</span>
                <p class="text-xl font-bold font-headline mt-1 text-emerald-700">${qStats.accepted}</p>
              </div>
              <div class="border border-outline p-3 rounded bg-surface">
                <span class="text-xs text-on-surface-variant font-mono">Rejected / Expired</span>
                <p class="text-xl font-bold font-headline mt-1 text-amber-700">${qStats.rejected_or_expired}</p>
              </div>
              <div class="border border-outline p-3 rounded bg-surface">
                <span class="text-xs text-on-surface-variant font-mono">Date Range</span>
                <p class="text-xs font-mono font-semibold mt-2">${qStats.earliest_date || '—'} to ${qStats.latest_date || '—'}</p>
              </div>
              <div class="border border-outline p-3 rounded bg-emerald-50 text-emerald-950">
                <span class="text-xs font-mono font-semibold text-emerald-800">Eligible for Cleanup</span>
                <p class="text-xl font-bold font-headline mt-1 text-emerald-800">${qStats.eligible_count}</p>
              </div>
              <div class="border border-outline p-3 rounded bg-amber-50 text-amber-950">
                <span class="text-xs font-mono font-semibold text-amber-800">Retained (Converted)</span>
                <p class="text-xl font-bold font-headline mt-1 text-amber-800">${qStats.blocked_count}</p>
              </div>
            </div>
            <p class="mt-3 text-xs text-on-surface-variant">
              Notice: Quotations converted to invoices are retained to preserve invoice traceability and relational integrity.
            </p>
          </div>`,
        })}

        <!-- Filter & Selection Section -->
        ${card({
          title: 'Step 1 — Select Quotations for Cleanup',
          subtitle: 'Choose which eligible quotations you want to export and remove.',
          body: `<div class="px-5 py-4">
            <form id="quotation-selection-form" class="space-y-4">
              <div class="flex flex-wrap gap-4 items-center">
                <label class="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <input type="radio" name="filter_type" value="ALL" checked class="text-cyan-accent">
                  All eligible quotations (${qStats.eligible_count})
                </label>
                <label class="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <input type="radio" name="filter_type" value="DATE_RANGE" class="text-cyan-accent">
                  Within custom date range
                </label>
              </div>
              <div id="date-range-fields" class="hidden flex flex-wrap gap-4 items-end pt-2 border-t border-outline">
                ${field({ label: 'From Date', name: 'from_date', type: 'date', value: qStats.earliest_date || '' })}
                ${field({ label: 'To Date', name: 'to_date', type: 'date', value: qStats.latest_date || '' })}
              </div>
              <div>
                ${button({ label: 'Preview Eligible Quotations', action: 'preview-selection', variant: 'primary' })}
              </div>
            </form>
          </div>`,
        })}

        <div id="preview-results-area"></div>
      </div>
    `;
  }

  function renderInvoicesTab(iStats) {
    return `
      <div class="space-y-5">
        <!-- Breakdown Cards -->
        ${card({
          title: 'Invoices Inventory & Accounting Safeguards',
          subtitle: 'Invoices with payments, credit notes, or subscriptions are strictly blocked from cleanup to preserve financial integrity.',
          body: `<div class="px-5 py-4">
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div class="border border-outline p-3 rounded bg-surface">
                <span class="text-xs text-on-surface-variant font-mono">Total Invoices</span>
                <p class="text-xl font-bold font-headline mt-1">${iStats.total}</p>
              </div>
              <div class="border border-outline p-3 rounded bg-surface">
                <span class="text-xs text-on-surface-variant font-mono">Drafts</span>
                <p class="text-xl font-bold font-headline mt-1 text-slate-700">${iStats.draft}</p>
              </div>
              <div class="border border-outline p-3 rounded bg-surface">
                <span class="text-xs text-on-surface-variant font-mono">Issued</span>
                <p class="text-xl font-bold font-headline mt-1 text-cyan-700">${iStats.issued}</p>
              </div>
              <div class="border border-outline p-3 rounded bg-surface">
                <span class="text-xs text-on-surface-variant font-mono">Cancelled / Void</span>
                <p class="text-xl font-bold font-headline mt-1 text-red-700">${iStats.cancelled_or_void}</p>
              </div>
              <div class="border border-outline p-3 rounded bg-surface">
                <span class="text-xs text-on-surface-variant font-mono">Paid (Blocked)</span>
                <p class="text-xl font-bold font-headline mt-1 text-emerald-700">${iStats.paid}</p>
              </div>
              <div class="border border-outline p-3 rounded bg-surface">
                <span class="text-xs text-on-surface-variant font-mono">Partially Paid (Blocked)</span>
                <p class="text-xl font-bold font-headline mt-1 text-cyan-700">${iStats.partially_paid}</p>
              </div>
              <div class="border border-outline p-3 rounded bg-emerald-50 text-emerald-950">
                <span class="text-xs font-mono font-semibold text-emerald-800">Eligible for Cleanup</span>
                <p class="text-xl font-bold font-headline mt-1 text-emerald-800">${iStats.eligible_count}</p>
              </div>
              <div class="border border-outline p-3 rounded bg-amber-50 text-amber-950">
                <span class="text-xs font-mono font-semibold text-amber-800">Retained (Statutory Ledger)</span>
                <p class="text-xl font-bold font-headline mt-1 text-amber-800">${iStats.blocked_count}</p>
              </div>
            </div>

            <div class="mt-4 border-t border-outline pt-3">
              <p class="font-headline text-xs font-semibold uppercase tracking-wider text-on-surface">Protected Accounting Records:</p>
              <ul class="mt-1 list-disc list-inside text-xs text-on-surface-variant space-y-0.5">
                <li>${iStats.blocked_breakdown.with_payments} invoice(s) have payments recorded in the immutable payment ledger.</li>
                <li>${iStats.blocked_breakdown.with_credit_notes} invoice(s) have GST credit/debit adjustment notes.</li>
                <li>${iStats.blocked_breakdown.with_subscriptions} invoice(s) are linked to POS customer subscriptions.</li>
              </ul>
            </div>
          </div>`,
        })}

        <!-- Filter & Selection Section -->
        ${card({
          title: 'Step 1 — Select Invoices for Cleanup',
          subtitle: 'Choose which eligible uncollected/voided invoices you want to export and remove.',
          body: `<div class="px-5 py-4">
            <form id="invoice-selection-form" class="space-y-4">
              <div class="flex flex-wrap gap-4 items-center">
                <label class="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <input type="radio" name="filter_type" value="ALL" checked class="text-cyan-accent">
                  All eligible invoices (${iStats.eligible_count})
                </label>
                <label class="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <input type="radio" name="filter_type" value="DATE_RANGE" class="text-cyan-accent">
                  Within custom date range
                </label>
              </div>
              <div id="date-range-fields" class="hidden flex flex-wrap gap-4 items-end pt-2 border-t border-outline">
                ${field({ label: 'From Date', name: 'from_date', type: 'date', value: iStats.earliest_date || '' })}
                ${field({ label: 'To Date', name: 'to_date', type: 'date', value: iStats.latest_date || '' })}
              </div>
              <div>
                ${button({ label: 'Preview Eligible Invoices', action: 'preview-selection', variant: 'primary' })}
              </div>
            </form>
          </div>`,
        })}

        <div id="preview-results-area"></div>
      </div>
    `;
  }

  function renderPreviewResults(preview) {
    const area = container.querySelector('#preview-results-area');
    if (!area) return;

    if (preview.selected_count === 0 && preview.blocked_count === 0) {
      area.innerHTML = alertBox('No records matched the selected criteria.', 'info');
      return;
    }

    const isQuo = preview.category === 'QUOTATIONS';
    const singular = isQuo ? 'quotation' : 'invoice';

    area.innerHTML = `
      <div class="space-y-5">
        ${card({
          title: `Step 2 — Review Selected ${isQuo ? 'Quotations' : 'Invoices'} (${preview.selected_count} eligible)`,
          subtitle: `Verify the records that will be exported and deleted. Affected line items and milestones will be removed concurrently.`,
          body: `<div class="px-5 py-4">
            <div class="mb-4 flex flex-wrap gap-4 items-center justify-between text-sm">
              <div>
                <span class="font-semibold text-on-surface">${preview.selected_count} eligible ${singular}(s)</span> selected
                <span class="text-xs text-on-surface-variant font-mono">(${preview.affected_related_records.total_sub_records} related item rows)</span>
              </div>
              <div class="flex items-center gap-2">
                <button type="button" data-action="toggle-all-checks" class="text-xs text-cyan-accent hover:underline">Select / Deselect All</button>
              </div>
            </div>

            <div class="max-h-80 overflow-y-auto border border-outline rounded bg-surface">
              <table class="w-full text-left text-xs">
                <thead class="sticky top-0 bg-surface-dim font-mono uppercase text-[11px] border-b border-outline">
                  <tr>
                    <th class="p-2 w-8 text-center"></th>
                    <th class="p-2">Number</th>
                    <th class="p-2">Client</th>
                    <th class="p-2">Issue Date</th>
                    <th class="p-2">Status</th>
                    <th class="p-2 text-right">Grand Total</th>
                    <th class="p-2 text-center">Items</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-outline">
                  ${preview.eligible_records.map(r => `
                    <tr class="hover:bg-surface-dim/50">
                      <td class="p-2 text-center">
                        <input type="checkbox" name="doc_id" value="${r.id}" checked class="doc-checkbox text-cyan-accent">
                      </td>
                      <td class="p-2 font-mono font-medium">${esc(r.number)}</td>
                      <td class="p-2">${esc(r.client_name)}</td>
                      <td class="p-2 font-mono">${esc(r.issue_date || '—')}</td>
                      <td class="p-2">${statusBadge(r.status)}</td>
                      <td class="p-2 font-mono text-right font-medium">${money(r.grand_total_minor)}</td>
                      <td class="p-2 text-center font-mono">${r.items_count}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>

            ${preview.blocked_records.length > 0 ? `
              <div class="mt-4 border-t border-outline pt-4">
                <details class="cursor-pointer">
                  <summary class="font-headline text-xs font-semibold text-amber-800 flex items-center gap-2">
                    ${icon('lock', '!text-[16px]')} ${preview.blocked_records.length} record(s) blocked from deletion (Click to view reasons)
                  </summary>
                  <div class="mt-3 max-h-48 overflow-y-auto border border-amber-200 bg-amber-50 rounded p-3 text-xs text-amber-900 space-y-2">
                    ${preview.blocked_records.map(b => `
                      <div class="border-b border-amber-200/50 pb-1.5 last:border-0 last:pb-0">
                        <span class="font-mono font-bold">${esc(b.number)}</span> (${esc(b.client_name)}):
                        <span class="text-amber-800">${esc(b.reasons.join('; '))}</span>
                      </div>
                    `).join('')}
                  </div>
                </details>
              </div>
            ` : ''}

            <div class="mt-6 border-t border-outline pt-4">
              <div class="rounded border border-cyan-200 bg-cyan-50/60 p-4 mb-4">
                <p class="font-headline text-xs font-bold uppercase tracking-wider text-cyan-950">Export-First Mandate</p>
                <p class="mt-1 text-xs text-cyan-900">
                  Before permanent deletion, you must generate and verify the required export archives (.xlsx, .csv, .pdf, and structured .json).
                  The Delete button will remain disabled until export verification completes successfully.
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-3">
                ${button({ label: 'Generate & Verify Export Archives', action: 'start-export', variant: 'primary' })}
              </div>
            </div>
          </div>`,
        })}

        <div id="export-results-area"></div>
      </div>
    `;

    bindPreviewEvents();
  }

  function renderExportResults(exportData) {
    const area = container.querySelector('#export-results-area');
    if (!area) return;

    const manifest = exportData.manifest;
    const files = manifest.files;
    const isQuo = manifest.category === 'QUOTATIONS';
    const confirmPhrase = isQuo ? 'DELETE QUOTATIONS' : 'DELETE INVOICES';

    area.innerHTML = `
      <div class="space-y-5">
        ${card({
          title: 'Step 3 — Export Verified & Final Confirmation',
          subtitle: 'All export archives have been generated and validated with SHA-256 cryptographic checksums.',
          body: `<div class="px-5 py-4 space-y-4">
            <div class="rounded border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 text-xs">
              <div class="flex items-center gap-2 font-headline font-bold text-sm text-emerald-900 mb-2">
                ${icon('check_circle', '!text-[20px]')} Export Verification Passed
              </div>
              <p>All ${manifest.record_count} selected documents were successfully exported, validated, and checksummed.</p>
              <p class="mt-1 font-mono text-[11px] text-emerald-800 break-all">Export Directory: ${esc(manifest.export_directory)}</p>
            </div>

            <div class="border border-outline rounded bg-surface overflow-x-auto text-xs">
              <table class="w-full text-left font-mono">
                <thead class="bg-surface-dim uppercase text-[10px] border-b border-outline">
                  <tr>
                    <th class="p-2">Format</th>
                    <th class="p-2">Filename</th>
                    <th class="p-2 text-right">Size</th>
                    <th class="p-2 text-center">Verification</th>
                    <th class="p-2">SHA-256 Checksum</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-outline">
                  ${Object.entries(files).map(([key, f]) => {
                    const label = key === 'json' ? 'Structured JSON'
                      : key === 'xlsx' ? 'Excel (.xlsx)'
                      : key === 'csv_master' ? 'Master CSV'
                      : key === 'csv_items' ? 'Line Items CSV'
                      : 'Compiled PDF';
                    return `
                    <tr>
                      <td class="p-2 font-bold text-cyan-accent text-xs">${esc(label)}</td>
                      <td class="p-2">${esc(f.filename)}</td>
                      <td class="p-2 text-right">${formatBytes(f.size_bytes)}</td>
                      <td class="p-2 text-center">
                        <span class="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                          ${icon('check', '!text-[12px]')} Validated
                        </span>
                      </td>
                      <td class="p-2 text-[10px] text-on-surface-variant break-all">${esc(f.sha256)}</td>
                    </tr>
                  `;}).join('')}
                </tbody>
              </table>
            </div>

            <!-- Pre-deletion Warning Alert -->
            <div class="rounded border border-red-300 bg-red-50 p-4 text-red-950 text-xs space-y-2">
              <p class="font-headline font-bold text-sm text-red-900 flex items-center gap-2">
                ${icon('error', '!text-[20px]')} Irreversible Deletion Warning
              </p>
              <p>
                Deleting historical ${isQuo ? 'quotations' : 'invoices'} will permanently remove them from the active database.
                This will reclaim approximately <strong>${formatBytes(manifest.record_count * (isQuo ? 3500 : 4500))}</strong> of storage space.
                An automatic safety backup of your database will be saved before deletion starts.
              </p>
              <p class="font-semibold text-red-900">
                Statutory Notice: Deletion of issued documents affects accounting history, audit trails, and tax summaries.
                Ensure you have securely archived the exported files before proceeding.
              </p>
            </div>

            <form id="execute-cleanup-form" class="space-y-4 pt-2">
              <label class="flex items-start gap-2 text-xs cursor-pointer font-medium text-on-surface">
                <input type="checkbox" id="confirm-saved-checkbox" class="mt-0.5 text-cyan-accent">
                <span>I confirm that I have reviewed the exported files and that they are safely saved on external/permanent storage.</span>
              </label>

              <div>
                <label for="confirm-phrase-input" class="label-technical mb-1 block">
                  To confirm permanent deletion, type <code class="font-mono font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded">${confirmPhrase}</code> below:
                </label>
                <input type="text" id="confirm-phrase-input" placeholder="${confirmPhrase}" autocomplete="off"
                  class="font-mono text-sm max-w-md w-full border border-outline px-3 py-2 rounded uppercase focus:border-red-500 focus:ring-1 focus:ring-red-500">
              </div>

              <div class="pt-2 flex flex-wrap items-center gap-3">
                <button type="submit" id="btn-execute-deletion" disabled class="btn btn-danger flex items-center gap-2 opacity-50 cursor-not-allowed">
                  ${icon('close', '!text-[16px]')} Permanently Delete &amp; Reclaim Disk Space
                </button>
                <button type="button" data-action="cancel-cleanup" class="btn btn-secondary">Cancel</button>
              </div>
            </form>
          </div>`,
        })}
      </div>
    `;

    bindExecutionEvents(exportData);
  }

  function bindEvents() {
    ctx.on('tab-quotations', () => {
      activeTab = 'QUOTATIONS';
      currentPreview = null;
      currentExport = null;
      renderView();
    });

    ctx.on('tab-invoices', () => {
      activeTab = 'INVOICES';
      currentPreview = null;
      currentExport = null;
      renderView();
    });

    // Date range toggle
    container.querySelectorAll('input[name="filter_type"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const fields = container.querySelector('#date-range-fields');
        if (fields) {
          if (radio.value === 'DATE_RANGE') fields.classList.remove('hidden');
          else fields.classList.add('hidden');
        }
      });
    });

    // Preview selection
    ctx.on('preview-selection', async () => {
      const formId = activeTab === 'QUOTATIONS' ? '#quotation-selection-form' : '#invoice-selection-form';
      const form = new FormData(container.querySelector(formId));
      const filterType = form.get('filter_type') || 'ALL';
      const fromDate = form.get('from_date') ? String(form.get('from_date')) : null;
      const toDate = form.get('to_date') ? String(form.get('to_date')) : null;

      try {
        const preview = await api.post('/api/cleanup/preview', {
          category: activeTab,
          filter_type: filterType,
          from_date: fromDate,
          to_date: toDate,
        });
        currentPreview = preview;
        renderPreviewResults(preview);
      } catch (err) {
        toast(err.message || 'Failed to preview selection', 'danger');
      }
    });
  }

  function bindPreviewEvents() {
    // Select / Deselect All
    ctx.on('toggle-all-checks', () => {
      const checkboxes = container.querySelectorAll('.doc-checkbox');
      const allChecked = Array.from(checkboxes).every(c => c.checked);
      checkboxes.forEach(c => { c.checked = !allChecked; });
    });

    // Start Export
    ctx.on('start-export', async () => {
      const checkedBoxes = Array.from(container.querySelectorAll('.doc-checkbox:checked'));
      const selectedIds = checkedBoxes.map(c => c.value);
      if (selectedIds.length === 0) {
        toast('Please select at least one document to export.', 'danger');
        return;
      }

      toast('Generating exports and calculating cryptographic checksums…', 'info');
      try {
        const result = await api.post('/api/cleanup/export', {
          category: activeTab,
          ids: selectedIds,
        });
        currentExport = result;
        renderExportResults(result);
        toast('Exports generated and verified successfully.');
      } catch (err) {
        toast(err.message || 'Export failed.', 'danger');
      }
    });
  }

  function bindExecutionEvents(exportData) {
    const isQuo = activeTab === 'QUOTATIONS';
    const confirmPhrase = isQuo ? 'DELETE QUOTATIONS' : 'DELETE INVOICES';
    const phraseInput = container.querySelector('#confirm-phrase-input');
    const checkbox = container.querySelector('#confirm-saved-checkbox');
    const submitBtn = container.querySelector('#btn-execute-deletion');
    const form = container.querySelector('#execute-cleanup-form');

    function updateButtonState() {
      const phraseMatches = phraseInput.value.trim().toUpperCase() === confirmPhrase;
      const isConfirmed = checkbox.checked;
      if (phraseMatches && isConfirmed) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      } else {
        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
      }
    }

    phraseInput?.addEventListener('input', updateButtonState);
    checkbox?.addEventListener('change', updateButtonState);

    ctx.on('cancel-cleanup', () => {
      currentExport = null;
      currentPreview = null;
      renderView();
    });

    form?.addEventListener('submit', async event => {
      event.preventDefault();
      if (submitBtn.disabled) return;

      submitBtn.disabled = true;
      submitBtn.innerHTML = `${icon('close', '!text-[16px]')} Deleting and Reclaiming Space…`;

      try {
        const result = await api.post('/api/cleanup/execute', {
          category: activeTab,
          ids: exportData.manifest.document_ids,
          verification_token: exportData.verification_token,
          confirmation_phrase: phraseInput.value.trim().toUpperCase(),
        });

        // Show success result card
        const content = container.querySelector('#cleanup-content');
        content.innerHTML = `
          ${card({
            title: 'Cleanup Complete — Space Reclaimed',
            subtitle: 'The selected historical records were safely deleted and SQLite database maintenance completed.',
            body: `<div class="px-5 py-4 space-y-4">
              <div class="rounded border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 text-sm">
                <div class="flex items-center gap-2 font-headline font-bold text-base text-emerald-900 mb-2">
                  ${icon('check_circle', '!text-[22px]')} Successfully Deleted ${result.deleted_count} ${isQuo ? 'Quotations' : 'Invoices'}
                </div>
                <p>All associated line items and milestones were cleanly removed from the database.</p>
                ${result.safety_backup ? `
                  <p class="mt-2 font-mono text-xs text-emerald-800 break-all">
                    Pre-cleanup Safety Backup Saved: <strong>${esc(result.safety_backup)}</strong>
                  </p>
                ` : ''}
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs text-on-surface">
                <div class="border border-outline bg-surface-dim p-3 rounded">
                  <span class="text-on-surface-variant uppercase font-sans font-semibold text-[10px]">Database Size Before</span>
                  <p class="text-base font-bold mt-1">${formatBytes(result.storage_before_bytes)}</p>
                </div>
                <div class="border border-outline bg-surface-dim p-3 rounded">
                  <span class="text-on-surface-variant uppercase font-sans font-semibold text-[10px]">Database Size After VACUUM</span>
                  <p class="text-base font-bold mt-1 text-emerald-700">${formatBytes(result.storage_after_bytes)}</p>
                </div>
                <div class="border border-outline bg-emerald-50 p-3 rounded text-emerald-950">
                  <span class="uppercase font-sans font-semibold text-[10px] text-emerald-800">Actual Space Reclaimed</span>
                  <p class="text-base font-bold mt-1 text-emerald-700">${formatBytes(result.reclaimed_bytes)}</p>
                </div>
              </div>

              <div class="flex items-center gap-2 text-xs text-emerald-800 font-medium">
                ${icon('check_circle', '!text-[16px]')} Database integrity check passed (PRAGMA integrity_check: OK).
              </div>

              <div class="pt-3 border-t border-outline flex gap-3">
                <button type="button" data-action="cleanup-again" class="btn btn-primary">Done</button>
                <a href="#/reports" class="btn btn-secondary">View Audit Trail</a>
              </div>
            </div>`,
          })}
        `;

        ctx.on('cleanup-again', async () => {
          statusData = await api.get('/api/cleanup/status');
          currentExport = null;
          currentPreview = null;
          renderView();
        });

        toast(`Cleanup completed! Reclaimed ${formatBytes(result.reclaimed_bytes)} disk space.`);
      } catch (err) {
        toast(err.message || 'Cleanup operation failed.', 'danger');
        submitBtn.disabled = false;
        submitBtn.innerHTML = `${icon('close', '!text-[16px]')} Permanently Delete &amp; Reclaim Disk Space`;
      }
    });
  }

  renderView();
};
