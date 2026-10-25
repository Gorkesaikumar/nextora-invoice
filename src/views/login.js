import { esc, field, button, icon } from '../lib/ui.js';

let submitHandler = null;
let setupHandler = null;
let registerHandler = null;
let recoverHandler = null;

export function wire(handler) {
  submitHandler = handler;
}

export function wireSetup(handler) {
  setupHandler = handler;
}

export function wireRegister(handler) {
  registerHandler = handler;
}

export function wireRecover(handler) {
  recoverHandler = handler;
}

let currentMode = 'login'; // 'login' | 'register' | 'recover'

/* ----------------------------------------------------------------- sign in */

export function render({ message = '', successMessage = '', mode = 'login' } = {}) {
  currentMode = mode;
  if (mode === 'register') return renderRegister({ message, successMessage });
  if (mode === 'recover') return renderRecover({ message, successMessage });

  return `
    <div class="flex min-h-screen items-center justify-center bg-surface-dim px-4 py-12">
      <div class="w-full max-w-md border border-outline bg-surface p-8 shadow-sm">
        <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-on-surface-variant">Nextora Creations</p>
        <h1 class="mt-1 font-headline text-2xl font-bold tracking-tight">Invoicing</h1>
        <p class="mt-2 text-sm text-on-surface-variant">Sign in to manage quotations, invoices and payments.</p>

        <div id="login-success" class="mt-6 ${successMessage ? '' : 'hidden'}">
          <div class="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">${esc(successMessage)}</div>
        </div>

        <div id="login-error" class="mt-6 ${message ? '' : 'hidden'}">
          <div class="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">${esc(message)}</div>
        </div>

        <form id="login-form" class="mt-6 space-y-4" novalidate>
          ${field({ label: 'Email address', name: 'email', type: 'email', required: true, attributes: 'autocomplete="username"' })}

          <div class="sm:col-span-1">
            <div class="flex items-center justify-between mb-1.5">
              <label for="field-password" class="label-technical">Password <span class="text-red-600">*</span></label>
              <button type="button" class="btn-toggle-password text-xs text-on-surface-variant hover:text-on-surface focus:outline-none" data-target="field-password">Show</button>
            </div>
            <input id="field-password" name="password" type="password" required autocomplete="current-password" class="field">
          </div>

          <div class="flex items-center justify-end">
            <button type="button" class="btn-switch-mode text-xs text-on-surface-variant hover:text-cyan-accent focus:outline-none" data-mode="recover">
              Forgot password?
            </button>
          </div>

          <div>
            ${button({ label: 'Sign in', type: 'submit', variant: 'primary', attributes: 'class="w-full justify-center px-3.5 py-2.5 text-sm"' })}
          </div>
        </form>

        <div class="mt-6 flex items-center justify-center border-t border-outline pt-4 text-xs text-on-surface-variant">
          <span>Need staff access?</span>
          <button type="button" class="btn-switch-mode ml-1.5 font-semibold text-cyan-accent hover:underline focus:outline-none" data-mode="register">
            Create account
          </button>
        </div>

        <p class="mt-4 text-center text-[11px] text-on-surface-variant">
          Access is limited to authorised Nextora Creations staff. Every sign-in and document action is recorded.
        </p>
      </div>
    </div>`;
}

/* ----------------------------------------------------------- create account */

export function renderRegister({ message = '', successMessage = '' } = {}) {
  return `
    <div class="flex min-h-screen items-center justify-center bg-surface-dim px-4 py-12">
      <div class="w-full max-w-md border border-outline bg-surface p-8 shadow-sm">
        <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-on-surface-variant">Nextora Creations</p>
        <h1 class="mt-1 font-headline text-2xl font-bold tracking-tight">Create Staff Account</h1>
        <p class="mt-2 text-sm text-on-surface-variant">Register a new staff account to manage invoices and quotations.</p>

        <div id="login-success" class="mt-6 ${successMessage ? '' : 'hidden'}">
          <div class="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">${esc(successMessage)}</div>
        </div>

        <div id="login-error" class="mt-6 ${message ? '' : 'hidden'}">
          <div class="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">${esc(message)}</div>
        </div>

        <form id="register-form" class="mt-6 space-y-4" novalidate>
          ${field({ label: 'Full name', name: 'display_name', required: true, attributes: 'autocomplete="name"' })}
          ${field({ label: 'Email address', name: 'email', type: 'email', required: true, attributes: 'autocomplete="username"' })}

          <div class="sm:col-span-1">
            <div class="flex items-center justify-between mb-1.5">
              <label for="field-reg-password" class="label-technical">Password <span class="text-red-600">*</span></label>
              <button type="button" class="btn-toggle-password text-xs text-on-surface-variant hover:text-on-surface focus:outline-none" data-target="field-reg-password">Show</button>
            </div>
            <input id="field-reg-password" name="password" type="password" required autocomplete="new-password" class="field">
            <p class="mt-1 text-xs text-on-surface-variant">At least 10 characters.</p>
          </div>

          <div class="sm:col-span-1">
            <div class="flex items-center justify-between mb-1.5">
              <label for="field-reg-confirm" class="label-technical">Confirm password <span class="text-red-600">*</span></label>
              <button type="button" class="btn-toggle-password text-xs text-on-surface-variant hover:text-on-surface focus:outline-none" data-target="field-reg-confirm">Show</button>
            </div>
            <input id="field-reg-confirm" name="confirm_password" type="password" required autocomplete="new-password" class="field">
          </div>

          <div>
            ${button({ label: 'Create Account', type: 'submit', variant: 'primary', attributes: 'class="w-full justify-center px-3.5 py-2.5 text-sm"' })}
          </div>
        </form>

        <div class="mt-6 flex items-center justify-center border-t border-outline pt-4 text-xs text-on-surface-variant">
          <span>Already have an account?</span>
          <button type="button" class="btn-switch-mode ml-1.5 font-semibold text-cyan-accent hover:underline focus:outline-none" data-mode="login">
            Sign in
          </button>
        </div>

        <p class="mt-4 text-center text-[11px] text-on-surface-variant">
          Staff accounts are granted Finance staff permissions upon registration. Administrative privileges require Owner authorization.
        </p>
      </div>
    </div>`;
}

/* ---------------------------------------------------------- forgot password */

export function renderRecover({ message = '', successMessage = '' } = {}) {
  return `
    <div class="flex min-h-screen items-center justify-center bg-surface-dim px-4 py-12">
      <div class="w-full max-w-md border border-outline bg-surface p-8 shadow-sm">
        <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-on-surface-variant">Nextora Creations</p>
        <h1 class="mt-1 font-headline text-2xl font-bold tracking-tight">Account Recovery</h1>
        <p class="mt-2 text-sm text-on-surface-variant">Reset your password using the Business Recovery Key.</p>

        <div id="login-success" class="mt-6 ${successMessage ? '' : 'hidden'}">
          <div class="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">${esc(successMessage)}</div>
        </div>

        <div id="login-error" class="mt-6 ${message ? '' : 'hidden'}">
          <div class="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">${esc(message)}</div>
        </div>

        <form id="recover-form" class="mt-6 space-y-4" novalidate>
          ${field({ label: 'Email address', name: 'email', type: 'email', required: true, attributes: 'autocomplete="username"' })}

          <div class="sm:col-span-1">
            <div class="flex items-center justify-between mb-1.5">
              <label for="field-recovery-key" class="label-technical">Business recovery key <span class="text-red-600">*</span></label>
              <button type="button" class="btn-toggle-password text-xs text-on-surface-variant hover:text-on-surface focus:outline-none" data-target="field-recovery-key">Show</button>
            </div>
            <input id="field-recovery-key" name="recovery_key" type="password" required class="field">
            <p class="mt-1 text-xs text-on-surface-variant">Provided by the business owner/administrator.</p>
          </div>

          <div class="sm:col-span-1">
            <div class="flex items-center justify-between mb-1.5">
              <label for="field-recover-new-password" class="label-technical">New password <span class="text-red-600">*</span></label>
              <button type="button" class="btn-toggle-password text-xs text-on-surface-variant hover:text-on-surface focus:outline-none" data-target="field-recover-new-password">Show</button>
            </div>
            <input id="field-recover-new-password" name="password" type="password" required autocomplete="new-password" class="field">
            <p class="mt-1 text-xs text-on-surface-variant">At least 10 characters.</p>
          </div>

          <div class="sm:col-span-1">
            <div class="flex items-center justify-between mb-1.5">
              <label for="field-recover-confirm-password" class="label-technical">Confirm new password <span class="text-red-600">*</span></label>
              <button type="button" class="btn-toggle-password text-xs text-on-surface-variant hover:text-on-surface focus:outline-none" data-target="field-recover-confirm-password">Show</button>
            </div>
            <input id="field-recover-confirm-password" name="confirm_password" type="password" required autocomplete="new-password" class="field">
          </div>

          <div>
            ${button({ label: 'Reset password', type: 'submit', variant: 'primary', attributes: 'class="w-full justify-center px-3.5 py-2.5 text-sm"' })}
          </div>
        </form>

        <div class="mt-6 flex items-center justify-center border-t border-outline pt-4 text-xs text-on-surface-variant">
          <span>Remember your password?</span>
          <button type="button" class="btn-switch-mode ml-1.5 font-semibold text-cyan-accent hover:underline focus:outline-none" data-mode="login">
            Sign in
          </button>
        </div>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ mount */

function attachPasswordToggles(root) {
  root.querySelectorAll('.btn-toggle-password').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = root.querySelector(`#${targetId}`);
      if (!input) return;
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = 'Hide';
      } else {
        input.type = 'password';
        btn.textContent = 'Show';
      }
    });
  });
}

function attachModeSwitches(root) {
  root.querySelectorAll('.btn-switch-mode').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      const app = document.getElementById('app');
      app.innerHTML = render({ mode });
      mount(mode);
    });
  });
}

export function mount(mode = currentMode) {
  const app = document.getElementById('app');
  attachPasswordToggles(app);
  attachModeSwitches(app);

  if (mode === 'login') {
    const form = app.querySelector('#login-form');
    const error = app.querySelector('#login-error');
    const submit = form?.querySelector('button[type="submit"]');
    app.querySelector('#field-email')?.focus();

    form?.addEventListener('submit', async event => {
      event.preventDefault();
      const data = new FormData(form);
      const email = String(data.get('email') || '').trim();
      const password = String(data.get('password') || '');

      if (!email || !password) {
        error.classList.remove('hidden');
        error.firstElementChild.textContent = 'Please enter both email address and password.';
        return;
      }

      error.classList.add('hidden');
      submit.disabled = true;
      submit.querySelector('span').textContent = 'Signing in…';

      try {
        await submitHandler({ email, password });
      } catch (failure) {
        error.classList.remove('hidden');
        error.firstElementChild.textContent = failure.message || 'Sign in failed.';
        submit.disabled = false;
        submit.querySelector('span').textContent = 'Sign in';
      }
    });
  } else if (mode === 'register') {
    const form = app.querySelector('#register-form');
    const error = app.querySelector('#login-error');
    const submit = form?.querySelector('button[type="submit"]');
    app.querySelector('#field-display_name')?.focus();

    form?.addEventListener('submit', async event => {
      event.preventDefault();
      const data = new FormData(form);
      const displayName = String(data.get('display_name') || '').trim();
      const email = String(data.get('email') || '').trim().toLowerCase();
      const password = String(data.get('password') || '');
      const confirmPassword = String(data.get('confirm_password') || '');

      if (!displayName || !email || !password || !confirmPassword) {
        error.classList.remove('hidden');
        error.firstElementChild.textContent = 'All fields are required.';
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) {
        error.classList.remove('hidden');
        error.firstElementChild.textContent = 'Please enter a valid email address.';
        return;
      }

      if (password.length < 10) {
        error.classList.remove('hidden');
        error.firstElementChild.textContent = 'Password must be at least 10 characters long.';
        return;
      }

      if (password !== confirmPassword) {
        error.classList.remove('hidden');
        error.firstElementChild.textContent = 'Passwords do not match.';
        return;
      }

      error.classList.add('hidden');
      submit.disabled = true;
      submit.querySelector('span').textContent = 'Creating account…';

      try {
        await registerHandler({
          display_name: displayName,
          email,
          password,
          confirm_password: confirmPassword,
        });
      } catch (failure) {
        error.classList.remove('hidden');
        error.firstElementChild.textContent = failure.message || 'Account creation failed.';
        submit.disabled = false;
        submit.querySelector('span').textContent = 'Create Account';
      }
    });
  } else if (mode === 'recover') {
    const form = app.querySelector('#recover-form');
    const error = app.querySelector('#login-error');
    const submit = form?.querySelector('button[type="submit"]');
    app.querySelector('#field-email')?.focus();

    form?.addEventListener('submit', async event => {
      event.preventDefault();
      const data = new FormData(form);
      const email = String(data.get('email') || '').trim().toLowerCase();
      const recoveryKey = String(data.get('recovery_key') || '').trim();
      const password = String(data.get('password') || '');
      const confirmPassword = String(data.get('confirm_password') || '');

      if (!email || !recoveryKey || !password || !confirmPassword) {
        error.classList.remove('hidden');
        error.firstElementChild.textContent = 'All fields are required.';
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) {
        error.classList.remove('hidden');
        error.firstElementChild.textContent = 'Please enter a valid email address.';
        return;
      }

      if (password.length < 10) {
        error.classList.remove('hidden');
        error.firstElementChild.textContent = 'Password must be at least 10 characters long.';
        return;
      }

      if (password !== confirmPassword) {
        error.classList.remove('hidden');
        error.firstElementChild.textContent = 'Passwords do not match.';
        return;
      }

      error.classList.add('hidden');
      submit.disabled = true;
      submit.querySelector('span').textContent = 'Resetting password…';

      try {
        await recoverHandler({
          email,
          recovery_key: recoveryKey,
          password,
          confirm_password: confirmPassword,
        });
        // On success, redirect to login with a success notice
        app.innerHTML = render({
          mode: 'login',
          successMessage: 'Password reset successful! Please sign in with your new password.',
        });
        mount('login');
      } catch (failure) {
        error.classList.remove('hidden');
        error.firstElementChild.textContent = failure.message || 'Password recovery failed.';
        submit.disabled = false;
        submit.querySelector('span').textContent = 'Reset password';
      }
    });
  }
}

/* ---------------------------------------------------------- first-run setup */

export function renderSetup({ message = '' } = {}) {
  return `
    <div class="flex min-h-screen items-center justify-center bg-surface-dim px-4 py-12">
      <div class="w-full max-w-xl border border-outline bg-surface p-8 shadow-sm">
        <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-on-surface-variant">Nextora Creations</p>
        <h1 class="mt-1 font-headline text-2xl font-bold tracking-tight">Set up invoicing</h1>
        <p class="mt-2 text-sm text-on-surface-variant">
          Create the owner account for this computer. Quotations, invoices and customer records are stored in a local
          database next to your user profile, so this step is only needed once.
        </p>

        <div id="login-error" class="mt-6 ${message ? '' : 'hidden'}">
          <div class="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">${esc(message)}</div>
        </div>

        <form id="login-form" class="mt-6 space-y-4" novalidate>
          ${field({ label: 'Your name', name: 'display_name', required: true, attributes: 'autocomplete="name"' })}
          ${field({ label: 'Email address', name: 'email', type: 'email', required: true, attributes: 'autocomplete="username"' })}

          <div class="sm:col-span-1">
            <div class="flex items-center justify-between mb-1.5">
              <label for="field-setup-password" class="label-technical">Password <span class="text-red-600">*</span></label>
              <button type="button" class="btn-toggle-password text-xs text-on-surface-variant hover:text-on-surface focus:outline-none" data-target="field-setup-password">Show</button>
            </div>
            <input id="field-setup-password" name="password" type="password" required autocomplete="new-password" class="field">
            <p class="mt-1 text-xs text-on-surface-variant">At least 10 characters. It is stored only as a salted scrypt hash.</p>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            ${field({ label: 'Business name', name: 'business_name', value: 'Nextora Creations' })}
            ${field({ label: 'GST state code', name: 'state_code', hint: 'Two-letter code such as 36 for Telangana. Editable later.', attributes: 'maxlength="2"' })}
          </div>
          <div>
            ${button({ label: 'Create owner account', type: 'submit', variant: 'primary', attributes: 'class="w-full justify-center px-3.5 py-2.5 text-sm"' })}
          </div>
        </form>

        <p class="mt-6 border-t border-outline pt-4 text-xs text-on-surface-variant">
          This account owns the local database and is the only role that can restore a backup.
        </p>
      </div>
    </div>`;
}

export function mountSetup() {
  const app = document.getElementById('app');
  attachPasswordToggles(app);
  const form = app.querySelector('#login-form');
  const error = app.querySelector('#login-error');
  const submit = form?.querySelector('button[type="submit"]');
  app.querySelector('#field-display_name')?.focus();

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    error.classList.add('hidden');
    submit.disabled = true;
    submit.querySelector('span').textContent = 'Creating account…';
    try {
      await setupHandler({
        display_name: String(data.get('display_name') || '').trim(),
        email: String(data.get('email') || '').trim().toLowerCase(),
        password: String(data.get('password') || ''),
        business_name: String(data.get('business_name') || '').trim(),
        state_code: String(data.get('state_code') || '').trim().toUpperCase(),
      });
    } catch (failure) {
      error.classList.remove('hidden');
      error.firstElementChild.textContent = failure.message || 'Setup failed.';
      submit.disabled = false;
      submit.querySelector('span').textContent = 'Create owner account';
    }
  });
}
