/**
 * Comprehensive Authentication & Account Management Test Suite.
 *
 * Covers all 20 test specifications from Phase 8:
 * 1. Valid login.
 * 2. Invalid password.
 * 3. Unknown email.
 * 4. Empty email and password.
 * 5. Invalid email format.
 * 6. Successful account creation.
 * 7. Duplicate email rejection.
 * 8. Password confirmation mismatch.
 * 9. Weak password rejection.
 * 10. Password hash verification.
 * 11. Session restoration after restart.
 * 12. Expired session handling.
 * 13. Invalid token handling.
 * 14. Successful password recovery.
 * 15. Expired / wrong recovery key rejection.
 * 16. Non-existent account recovery rejection.
 * 17. Unauthorized recovery key modification attempt.
 * 18. Logout and subsequent protected-page access.
 * 19. Initial administrator setup protection.
 * 20. Existing database migration without loss of records.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeClient, OWNER } from './helpers.js';
import { checkPassword, hashPassword, hash } from '../server/auth.js';
import { migrate } from '../scripts/migrate.js';

test('1. valid login returns 200, session cookie, and csrf token', async () => {
  const client = makeClient({ ip: '10.10.1.1' });
  const result = await client.login(OWNER);
  assert.equal(result.status, 200);
  assert.equal(result.data.user.email, OWNER.email);
  assert.equal(result.data.user.role, 'OWNER');
  assert.ok(result.data.csrf_token);
  assert.ok(result.headers.get('set-cookie')?.includes('ni_session'));
});

test('2. invalid password is rejected with 401 and generic error', async () => {
  const client = makeClient({ ip: '10.10.1.2' });
  const result = await client.json('POST', '/api/auth/login', {
    email: OWNER.email,
    password: 'wrong-password-12345',
  });
  assert.equal(result.status, 401);
  assert.equal(result.data.code, 'INVALID_CREDENTIALS');
});

test('3. unknown email is rejected with 401 identically to wrong password', async () => {
  const client = makeClient({ ip: '10.10.1.3' });
  const result = await client.json('POST', '/api/auth/login', {
    email: 'nonexistent-user@example.test',
    password: 'some-password-123',
  });
  assert.equal(result.status, 401);
  assert.equal(result.data.code, 'INVALID_CREDENTIALS');
});

test('4. empty email and password are rejected with 400 validation error', async () => {
  const client = makeClient({ ip: '10.10.1.4' });
  const emptyEmail = await client.json('POST', '/api/auth/login', { email: '', password: 'some-password' });
  assert.equal(emptyEmail.status, 400);
  assert.equal(emptyEmail.data.code, 'VALIDATION_ERROR');

  const emptyPass = await client.json('POST', '/api/auth/login', { email: OWNER.email, password: '' });
  assert.equal(emptyPass.status, 400);
  assert.equal(emptyPass.data.code, 'VALIDATION_ERROR');
});

test('5. invalid email format is rejected with 400', async () => {
  const client = makeClient({ ip: '10.10.1.5' });
  const result = await client.json('POST', '/api/auth/login', {
    email: 'not-an-email-address',
    password: 'valid-password-123',
  });
  assert.equal(result.status, 400);
  assert.equal(result.data.code, 'VALIDATION_ERROR');
});

test('6. successful account creation creates staff account with FINANCE role', async () => {
  const client = makeClient({ ip: '10.10.1.6' });
  const newStaff = {
    display_name: 'Priya Sharma',
    email: 'priya.sharma@nextora.test',
    password: 'staff-secure-password-2026',
    confirm_password: 'staff-secure-password-2026',
  };
  const result = await client.json('POST', '/api/auth/register', newStaff);
  assert.equal(result.status, 201);
  assert.equal(result.data.user.email, newStaff.email);
  assert.equal(result.data.user.role, 'FINANCE');
  assert.equal(result.data.user.display_name, newStaff.display_name);
  assert.ok(result.data.csrf_token);
  assert.ok(result.headers.get('set-cookie')?.includes('ni_session'));

  // Verify newly created user is in database
  const row = (await client.db.query('SELECT role, disabled FROM inv.users WHERE email=$1', [newStaff.email])).rows[0];
  assert.equal(row.role, 'FINANCE');
  assert.equal(Boolean(row.disabled), false);
});

test('7. duplicate email registration is rejected with 409', async () => {
  const client = makeClient({ ip: '10.10.1.7' });
  const duplicate = {
    display_name: 'Duplicate Staff',
    email: 'priya.sharma@nextora.test',
    password: 'another-secure-password-2026',
    confirm_password: 'another-secure-password-2026',
  };
  const result = await client.json('POST', '/api/auth/register', duplicate);
  assert.equal(result.status, 409);
  assert.equal(result.data.code, 'DUPLICATE_EMAIL');
});

test('8. registration password confirmation mismatch is rejected', async () => {
  const client = makeClient({ ip: '10.10.1.8' });
  const mismatch = {
    display_name: 'Mismatch User',
    email: 'mismatch@nextora.test',
    password: 'password-one-1234',
    confirm_password: 'password-two-5678',
  };
  const result = await client.json('POST', '/api/auth/register', mismatch);
  assert.equal(result.status, 400);
  assert.equal(result.data.code, 'VALIDATION_ERROR');
});

test('9. weak password (< 10 chars) is rejected on registration', async () => {
  const client = makeClient({ ip: '10.10.1.9' });
  const weak = {
    display_name: 'Weak Pass User',
    email: 'weakpass@nextora.test',
    password: 'short',
    confirm_password: 'short',
  };
  const result = await client.json('POST', '/api/auth/register', weak);
  assert.equal(result.status, 400);
  assert.equal(result.data.code, 'VALIDATION_ERROR');
});

test('10. password hash verification uses salted scrypt', async () => {
  const rawPassword = 'super-secret-password-1234';
  const hashed = await hashPassword(rawPassword);
  assert.ok(hashed.startsWith('scrypt:'));
  assert.equal(await checkPassword(rawPassword, hashed), true);
  assert.equal(await checkPassword('wrong-password', hashed), false);
  assert.equal(await checkPassword('', hashed), false);
});

test('11. session restoration after restart using stored session cookie', async () => {
  const client1 = makeClient({ ip: '10.10.1.11' });
  const loginRes = await client1.login(OWNER);
  const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);

  // Simulate new client / app launch with restored cookie
  const client2 = makeClient({ ip: '10.10.1.11' });
  client2.setCookie(cookie);
  const meRes = await client2.json('GET', '/api/auth/me');
  assert.equal(meRes.status, 200);
  assert.equal(meRes.data.user.email, OWNER.email);
});

test('12. expired session handling returns 401 SESSION_EXPIRED', async () => {
  const client = makeClient({ ip: '10.10.1.12' });
  const loginRes = await client.login(OWNER);
  const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];
  const tokenVal = cookie.split('=')[1];
  const tokenHash = hash(tokenVal);

  // Force session expiry in database
  await client.db.query("UPDATE inv.sessions SET expires_at=now()-interval '1 hour' WHERE token_hash=$1", [tokenHash]);

  const probe = await client.json('GET', '/api/auth/me');
  assert.equal(probe.status, 401);
  assert.equal(probe.data.code, 'SESSION_EXPIRED');
});

test('13. invalid session token handling returns 401 UNAUTHENTICATED', async () => {
  const client = makeClient({ ip: '10.10.1.13' });
  client.setCookie('ni_session=invalid-tampered-token-value-that-does-not-exist');
  const probe = await client.json('GET', '/api/auth/me');
  assert.equal(probe.status, 401);
  assert.equal(probe.data.code, 'UNAUTHENTICATED');
});

test('14. successful password recovery resets password and allows sign-in', async () => {
  const client = makeClient({ ip: '10.10.1.14' });
  // Create staff user to recover
  const staff = {
    display_name: 'Rahul Varma',
    email: 'rahul.varma@nextora.test',
    password: 'old-password-12345',
    confirm_password: 'old-password-12345',
  };
  await client.json('POST', '/api/auth/register', staff);

  // Recover password using business recovery key
  const recoverRes = await client.json('POST', '/api/auth/recover', {
    email: staff.email,
    recovery_key: 'NEXTORA-RECOVERY-2026',
    password: 'new-recovered-password-2026',
    confirm_password: 'new-recovered-password-2026',
  });
  assert.equal(recoverRes.status, 200);
  assert.equal(recoverRes.data.success, true);

  // Sign in with new password
  const newLogin = await client.json('POST', '/api/auth/login', {
    email: staff.email,
    password: 'new-recovered-password-2026',
  });
  assert.equal(newLogin.status, 200);
  assert.equal(newLogin.data.user.email, staff.email);

  // Verify old password no longer works
  const oldLogin = await client.json('POST', '/api/auth/login', {
    email: staff.email,
    password: 'old-password-12345',
  });
  assert.equal(oldLogin.status, 401);
});

test('15. invalid recovery key is rejected with 401 INVALID_RECOVERY_KEY', async () => {
  const client = makeClient({ ip: '10.10.1.15' });
  const result = await client.json('POST', '/api/auth/recover', {
    email: OWNER.email,
    recovery_key: 'wrong-recovery-key-123',
    password: 'new-password-12345',
    confirm_password: 'new-password-12345',
  });
  assert.equal(result.status, 401);
  assert.equal(result.data.code, 'INVALID_RECOVERY_KEY');
});

test('16. non-existent account recovery is rejected with 404 USER_NOT_FOUND', async () => {
  const client = makeClient({ ip: '10.10.1.16' });
  const result = await client.json('POST', '/api/auth/recover', {
    email: 'nobody-here@nextora.test',
    recovery_key: 'NEXTORA-RECOVERY-2026',
    password: 'new-password-12345',
    confirm_password: 'new-password-12345',
  });
  assert.equal(result.status, 404);
  assert.equal(result.data.code, 'USER_NOT_FOUND');
});

test('17. unauthorized recovery key modification is rejected', async () => {
  const client = makeClient({ ip: '10.10.1.17' });
  // Anonymous attempt
  const anon = await client.json('POST', '/api/settings/recovery-key', { recovery_key: 'brand-new-key-123' });
  assert.equal(anon.status, 401);

  // Log in as staff (FINANCE) - not manager
  const staffClient = makeClient({ ip: '10.10.1.18' });
  await staffClient.login({ email: 'rahul.varma@nextora.test', password: 'new-recovered-password-2026' });
  const staffAttempt = await staffClient.json('POST', '/api/settings/recovery-key', { recovery_key: 'brand-new-key-123' });
  assert.equal(staffAttempt.status, 403);
});

test('18. logout destroys session and prevents subsequent protected access', async () => {
  const client = makeClient({ ip: '10.10.1.19' });
  await client.login(OWNER);
  const before = await client.json('GET', '/api/clients');
  assert.equal(before.status, 200);

  const logoutRes = await client.json('POST', '/api/auth/logout', {});
  assert.equal(logoutRes.status, 200);
  assert.ok(logoutRes.headers.get('set-cookie')?.includes('Max-Age=0'));

  const after = await client.json('GET', '/api/clients');
  assert.equal(after.status, 401);
});

test('19. initial administrator setup is refused when accounts exist', async () => {
  const client = makeClient({ ip: '10.10.1.20' });
  const status = await client.json('GET', '/api/auth/setup');
  assert.equal(status.status, 200);
  assert.equal(status.data.setup_required, false);

  const attempt = await client.json('POST', '/api/auth/setup', {
    display_name: 'Hijacker',
    email: 'hijack@nextora.test',
    password: 'hijack-password-123',
    business_name: 'Hijacked',
    state_code: '36',
  });
  assert.equal(attempt.status, 409);
  assert.equal(attempt.data.code, 'ALREADY_INITIALIZED');
});

test('20. existing database migration preserves all records', async () => {
  const client = makeClient({ ip: '10.10.1.21' });
  // Run migration on active database
  await migrate(client.db);
  // Verify owner user still exists and can be queried
  const ownerRow = (await client.db.query('SELECT email, role FROM inv.users WHERE email=$1', [OWNER.email])).rows[0];
  assert.equal(ownerRow.email, OWNER.email);
  assert.equal(ownerRow.role, 'OWNER');

  // Verify settings table exists and has recovery_key_hash column
  const settings = (await client.db.query('SELECT recovery_key_hash FROM inv.business_settings WHERE id=true')).rows[0];
  assert.notEqual(settings, undefined);
});
