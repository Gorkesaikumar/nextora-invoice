import { api } from '../lib/api.js';
import {
  esc, button, card, field, grid, loading, pageHeader, alertBox, toast, badge,
} from '../lib/ui.js';

const formatBytes = bytes => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} bytes`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

export const render = async (container, params, ctx) => {
  container.innerHTML = pageHeader({ title: 'Settings' }) + loading();
  let settings;
  try {
    settings = (await api.get('/api/settings')).settings;
  } catch (error) {
    container.innerHTML = pageHeader({ title: 'Settings' }) + alertBox(error.message, 'danger');
    return;
  }

  const numberPreview = ctx.reference.numbering_preview;
  const canEdit = ['OWNER', 'ADMIN'].includes(ctx.session.user.role);
  // Backups and restores are native desktop operations on the local database file.
  const isDesktop = Boolean(globalThis.window?.electronAPI?.backupDatabase);

  container.innerHTML = `
    ${pageHeader({
    title: 'Settings',
    subtitle: 'Issuer details, defaults and document numbering. Nothing here is pre-filled with assumed registration or bank details.',
    actions: canEdit ? button({ label: 'Save settings', action: 'save-settings', variant: 'primary' }) : '',
  })}
    ${!canEdit ? alertBox('Your role can view these settings but not change them.', 'warn') : ''}
    <div id="settings-errors" class="mb-4 space-y-2"></div>

    <form id="settings-form" class="space-y-4">
      ${card({
    title: 'Business identity',
    subtitle: 'These details appear on every quotation, invoice and receipt.',
    body: `<div class="px-5 py-4">${grid(`
        ${field({ label: 'Business name', name: 'business_name', required: true, value: settings.business_name })}
        ${field({ label: 'Legal name', name: 'legal_name', value: settings.legal_name })}
        ${field({ label: 'Registered address', name: 'address', type: 'textarea', value: settings.address, className: 'sm:col-span-2' })}
        ${field({ label: 'Billing email', name: 'email', type: 'email', value: settings.email })}
        ${field({ label: 'Phone', name: 'phone', value: settings.phone })}
        ${field({ label: 'Website', name: 'website', value: settings.website })}
        ${field({ label: 'GSTIN', name: 'gstin', value: settings.gstin, hint: 'Leave blank if the business is not GST registered.' })}
        ${field({ label: 'State (place of supply origin)', name: 'state_code', value: settings.state_code,
    options: [{ value: '', label: 'Not selected' }, ...ctx.reference.states.map(s => ({ value: s.code, label: `${s.code} · ${s.name}` }))],
    hint: 'Required before any taxable document can be issued.' })}
        ${field({ label: 'PAN', name: 'pan', value: settings.pan })}
      `, 2)}
      <p class="mt-2 text-xs text-on-surface-variant">Enter your own registration details. This application never invents them, and tax configuration is not legal advice.</p></div>`,
  })}

      ${card({
    title: 'Payment details printed on documents',
    body: `<div class="px-5 py-4">${grid(`
        ${field({ label: 'Account name', name: 'bank_account_name', value: settings.bank_account_name })}
        ${field({ label: 'Bank name', name: 'bank_name', value: settings.bank_name })}
        ${field({ label: 'Account number', name: 'bank_account_number', value: settings.bank_account_number })}
        ${field({ label: 'IFSC', name: 'bank_ifsc', value: settings.bank_ifsc })}
        ${field({ label: 'Branch', name: 'bank_branch', value: settings.bank_branch })}
        ${field({ label: 'UPI ID', name: 'upi_id', value: settings.upi_id })}
        ${field({ label: 'Authorised signatory', name: 'signatory_name', value: settings.signatory_name })}
        ${field({ label: 'Signatory title', name: 'signatory_title', value: settings.signatory_title })}
      `, 2)}</div>`,
  })}

      ${card({
    title: 'Defaults',
    body: `<div class="px-5 py-4">${grid(`
        ${field({ label: 'Quotation validity (days)', name: 'default_quotation_validity_days', type: 'number', min: '1', max: '365', value: String(settings.default_quotation_validity_days) })}
        ${field({ label: 'Payment terms (days)', name: 'default_payment_terms_days', type: 'number', min: '0', max: '365', value: String(settings.default_payment_terms_days) })}
        ${field({ label: 'Currency', name: 'default_currency', value: settings.default_currency,
    options: ctx.reference.currencies.map(c => ({ value: c.code, label: c.label })) })}
        ${field({ label: 'Rounding', name: 'rounding_mode', value: settings.rounding_mode,
    options: [{ value: 'NEAREST_RUPEE', label: 'Round the grand total to the nearest rupee' }, { value: 'NONE', label: 'Never round the total' }] })}
        ${field({ label: 'Default GST rate for new lines', name: 'default_tax_rate_bp', value: String(settings.default_tax_rate_bp),
    options: ctx.reference.gst_rate_slabs.map(slab => ({ value: String(slab.bp), label: slab.label })) })}
        ${field({ label: 'Reverse charge applies', name: 'reverse_charge', value: String(settings.reverse_charge),
    options: [{ value: 'false', label: 'No' }, { value: 'true', label: 'Yes' }] })}
      `, 3)}</div>`,
  })}

      ${card({
    title: 'Document numbering',
    subtitle: 'Numbers are allocated at issue time inside a database transaction, so concurrent issues can never collide.',
    body: `<div class="px-5 py-4">${grid(`
        ${field({ label: 'Quotation prefix', name: 'quotation_prefix', required: true, value: settings.quotation_prefix })}
        ${field({ label: 'Invoice prefix', name: 'invoice_prefix', required: true, value: settings.invoice_prefix })}
        ${field({ label: 'Receipt prefix', name: 'receipt_prefix', required: true, value: settings.receipt_prefix })}
        ${field({ label: 'Credit note prefix', name: 'credit_note_prefix', required: true, value: settings.credit_note_prefix })}
      `, 4)}
      <div class="mt-4 border border-outline bg-surface-dim px-4 py-3 text-xs">
        <p class="label-technical mb-2">Next numbers would look like</p>
        <p class="font-mono">Quotation ${esc(numberPreview.quotation)}</p>
        <p class="font-mono">Invoice ${esc(numberPreview.invoice)}</p>
        <p class="font-mono">Receipt ${esc(numberPreview.receipt)}</p>
        <p class="mt-2 text-on-surface-variant">Changing a prefix only affects a financial year that has not issued anything yet.
        Numbers already issued keep their prefix so the sequence is never renumbered mid-year.</p>
      </div></div>`,
  })}

      ${card({
    title: 'Terms printed on documents',
    body: `<div class="px-5 py-4">${grid(`
        ${field({ label: 'Invoice terms and conditions', name: 'terms', type: 'textarea', value: settings.terms, className: 'sm:col-span-2' })}
        ${field({ label: 'Quotation terms and conditions', name: 'quotation_terms', type: 'textarea', value: settings.quotation_terms, className: 'sm:col-span-2' })}
      `, 2)}</div>`,
  })}

      ${card({
    title: 'PDF and print preferences',
    body: `<div class="px-5 py-4">${grid(`
        ${field({ label: 'Accent colour', name: 'pdf_accent_color', value: settings.pdf_accent_color, hint: 'Hex colour, for example #00AEEF.' })}
        ${field({ label: 'Show bank details', name: 'show_bank_details', value: String(settings.show_bank_details),
    options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] })}
        ${field({ label: 'Show authorised signatory', name: 'show_signatory', value: String(settings.show_signatory),
    options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] })}
        ${field({ label: 'Show amount in words', name: 'show_amount_in_words', value: String(settings.show_amount_in_words),
    options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] })}
      `, 4)}
      <div class="mt-4 flex flex-wrap items-end gap-4 border-t border-outline pt-4">
        <div>
          <label class="label-technical mb-1.5 block" for="logo-input">Business logo (PNG, max 500 KB)</label>
          <input id="logo-input" type="file" accept="image/png" class="text-sm">
        </div>
        ${button({ label: 'Upload logo', action: 'upload-logo' })}
        ${button({ label: 'View current logo', action: 'view-logo' })}
      </div>
      <p class="mt-2 text-xs text-on-surface-variant">The logo is validated as a real PNG with sensible dimensions before it is stored.</p></div>`,
  })}
    </form>

    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      ${card({
    title: 'Account',
    body: `<div class="px-5 py-4">
        <p class="text-sm">${esc(ctx.session.user.email)}</p>
        <div class="mt-2 flex items-center gap-2">${badge(ctx.session.user.role, 'info')}<span class="text-xs text-on-surface-variant">Signed in</span></div>
        <form id="password-form" class="mt-4 space-y-3">
          ${field({ label: 'Current password', name: 'current_password', type: 'password', required: true, className: '' })}
          ${field({ label: 'New password', name: 'password', type: 'password', required: true, hint: 'At least 12 characters.', className: '' })}
          ${button({ label: 'Change password', type: 'submit' })}
        </form>
        ${canEdit ? `
        <div class="mt-6 border-t border-outline pt-4">
          <p class="font-headline text-xs font-semibold">Master Recovery Key</p>
          <p class="mt-0.5 text-xs text-on-surface-variant">Used by authorized staff to recover accounts when passwords are lost.</p>
          <form id="recovery-key-form" class="mt-3 space-y-3">
            ${field({ label: 'New recovery key', name: 'recovery_key', type: 'password', required: true, hint: 'At least 8 characters. Keep this confidential.', className: '' })}
            ${button({ label: 'Update recovery key', type: 'submit' })}
          </form>
        </div>` : ''}
      </div>`,
  })}
      ${card({
    title: 'Audit and retention',
    body: `<div class="space-y-2 px-5 py-4 text-sm text-on-surface-variant">
        <p>Every issue, payment, cancellation and configuration change is written to an append-only audit log.</p>
        <p>Issued documents keep an immutable snapshot, so editing the catalog or client afterwards never changes history.</p>
        <p>Invoice and quotation numbers stay unique and sequential under concurrent users.</p>
        <p><a class="underline decoration-outline underline-offset-2 hover:decoration-cyan-accent" href="#/reports">Open the audit trail in Reports</a></p>
      </div>`,
  })}
    </div>

    ${isDesktop ? `
    <div class="mt-4">
      ${card({
    title: 'Local database',
    subtitle: 'The entire business database is a single file on this computer. Nothing is uploaded anywhere.',
    body: `<div class="px-5 py-4">
        <dl class="space-y-2 text-sm">
          <div class="flex flex-wrap justify-between gap-2">
            <dt class="text-on-surface-variant">Location</dt>
            <dd id="db-file" class="break-all font-mono text-xs">Reading…</dd>
          </div>
          <div class="flex flex-wrap justify-between gap-2">
            <dt class="text-on-surface-variant">Size on disk</dt>
            <dd id="db-size" class="font-mono text-xs">—</dd>
          </div>
          <div class="flex flex-wrap justify-between gap-2">
            <dt class="text-on-surface-variant">Stored records</dt>
            <dd id="db-counts" class="font-mono text-xs">—</dd>
          </div>
        </dl>
        <div class="mt-5 flex flex-wrap gap-2 border-t border-outline pt-4">
          ${button({ label: 'Back up database', action: 'db-backup', variant: 'primary' })}
          ${button({ label: 'Restore from backup', action: 'db-restore' })}
          <a href="#/cleanup" class="btn btn-secondary flex items-center gap-1.5">Business data cleanup</a>
          ${button({ label: 'Open data folder', action: 'db-folder' })}
        </div>
        <p class="mt-3 text-xs text-on-surface-variant">
          A backup is a complete, integrity-checked copy of the database file. Restoring replaces every record, keeps an
          automatic safety copy of the current database first, and requires you to sign in again.
        </p>
      </div>`,
  })}
    </div>` : ''}`;

  if (!canEdit) {
    container.querySelectorAll('#settings-form input, #settings-form select, #settings-form textarea')
      .forEach(node => { node.disabled = true; });
  }

  ctx.on('save-settings', async () => {
    const form = new FormData(container.querySelector('#settings-form'));
    const text = name => String(form.get(name) || '').trim();
    const payload = {
      business_name: text('business_name'), legal_name: text('legal_name'), address: String(form.get('address') || ''),
      email: text('email'), phone: text('phone'), website: text('website'), gstin: text('gstin').toUpperCase(),
      state_code: text('state_code'), pan: text('pan').toUpperCase(),
      bank_account_name: text('bank_account_name'), bank_account_number: text('bank_account_number'),
      bank_ifsc: text('bank_ifsc').toUpperCase(), bank_name: text('bank_name'), bank_branch: text('bank_branch'),
      upi_id: text('upi_id'), signatory_name: text('signatory_name'), signatory_title: text('signatory_title'),
      default_quotation_validity_days: Number(form.get('default_quotation_validity_days') || 30),
      default_payment_terms_days: Number(form.get('default_payment_terms_days') || 15),
      default_currency: text('default_currency'), rounding_mode: text('rounding_mode'),
      default_tax_rate_bp: Number(form.get('default_tax_rate_bp') || 0),
      reverse_charge: String(form.get('reverse_charge')) === 'true',
      quotation_prefix: text('quotation_prefix'), invoice_prefix: text('invoice_prefix'),
      receipt_prefix: text('receipt_prefix'), credit_note_prefix: text('credit_note_prefix'),
      terms: String(form.get('terms') || ''), quotation_terms: String(form.get('quotation_terms') || ''),
      pdf_accent_color: text('pdf_accent_color'),
      show_bank_details: String(form.get('show_bank_details')) === 'true',
      show_signatory: String(form.get('show_signatory')) === 'true',
      show_amount_in_words: String(form.get('show_amount_in_words')) === 'true',
    };
    try {
      await api.put('/api/settings', payload);
      await ctx.refreshReference();
      toast('Settings saved.');
      ctx.rerender();
    } catch (error) {
      const details = error.fields?.length
        ? error.fields.map(item => `${item.field || 'form'}: ${item.message}`).join(' · ') : error.message;
      container.querySelector('#settings-errors').innerHTML = alertBox(details, 'danger');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  ctx.on('upload-logo', () => {
    const input = container.querySelector('#logo-input');
    const file = input.files?.[0];
    if (!file) { toast('Choose a PNG file first.', 'danger'); return; }
    if (file.size > 512000) { toast('The logo must be 500 KB or smaller.', 'danger'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api.post('/api/settings/logo', { png: String(reader.result) });
        toast('Logo updated.');
        ctx.rerender();
      } catch (error) { toast(error.message, 'danger'); }
    };
    reader.readAsDataURL(file);
  });

  ctx.on('view-logo', () => {
    const url = `/api/settings?_=${Date.now()}`;
    api.get(url).then(() => toast('The logo is embedded in every generated PDF.', 'info')).catch(() => {});
  });

  if (isDesktop && canEdit) {
    const fileCell = container.querySelector('#db-file');
    const sizeCell = container.querySelector('#db-size');
    const countsCell = container.querySelector('#db-counts');

    api.get('/api/backup/status').then(info => {
      if (fileCell) fileCell.textContent = info.file || 'Local database';
      if (sizeCell) sizeCell.textContent = formatBytes(info.total_bytes) + (info.wal_bytes ? ' (includes write-ahead log)' : '');
      const counts = info.counts || {};
      if (countsCell) {
        countsCell.textContent = ['clients', 'products', 'quotations', 'invoices', 'payments', 'pos_customers']
          .map(key => `${counts[key] ?? 0} ${key.replace('_', ' ')}`).join(' · ');
      }
    }).catch(() => {
      if (fileCell) fileCell.textContent = 'Unavailable';
    });

    ctx.on('db-backup', async () => {
      const result = await api.backupDatabase();
      if (result?.canceled) return;
      toast(`Backup saved to ${result.backup.path}`);
    });

    ctx.on('db-restore', async () => {
      const result = await api.restoreDatabase();
      if (result?.canceled) return;
      toast('Backup restored. Sign in again with the restored accounts.', 'info');
      // The restored database has its own sessions, so the current one is gone.
      setTimeout(() => location.reload(), 1500);
    });

    ctx.on('db-folder', async () => {
      await globalThis.window?.electronAPI?.openDataFolder?.();
    });
  }

  container.querySelector('#password-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      await api.post('/api/auth/password', {
        current_password: String(form.get('current_password') || ''),
        password: String(form.get('password') || ''),
      });
      toast('Password changed. Please sign in again.');
      setTimeout(() => { location.hash = '#/dashboard'; location.reload(); }, 1200);
    } catch (error) {
      toast(error.fields?.length ? error.fields.map(item => item.message).join(' · ') : error.message, 'danger');
    }
  });

  container.querySelector('#recovery-key-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.target);
    const key = String(form.get('recovery_key') || '').trim();
    if (key.length < 8) {
      toast('Recovery key must be at least 8 characters.', 'danger');
      return;
    }
    try {
      await api.post('/api/settings/recovery-key', { recovery_key: key });
      toast('Master recovery key updated.');
      event.target.reset();
    } catch (error) {
      toast(error.message || 'Failed to update recovery key.', 'danger');
    }
  });
};
