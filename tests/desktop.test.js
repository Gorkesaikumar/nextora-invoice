/**
 * Tests for the desktop-specific behaviours: the custom-scheme renderer origin,
 * the clean-machine first run, and local database backup and restore.
 *
 * The integration tests here need the local SQLite driver. In PostgreSQL mode
 * (`npm run test:postgres`) the file-contract tests are skipped explicitly
 * rather than silently passing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { configuration } from '../server/api.js';
import { makeClient, baseClient } from './helpers.js';

const sqliteMode = !process.env.DATABASE_URL;
const fileUrl = relative => pathToFileURL(resolve(relative)).href;

/* ------------------------------------------------------------- configuration */

test('the desktop renderer origin is accepted, and only in a desktop build', () => {
  const desktop = configuration({ APP_URL: 'app://nextora', NODE_ENV: 'test' });
  assert.equal(desktop.appOrigin, 'app://nextora');
  assert.equal(desktop.production, false, 'a desktop install never uses production cookie rules');

  const trailing = configuration({ APP_URL: 'app://nextora/', NODE_ENV: 'test' });
  assert.equal(trailing.appOrigin, 'app://nextora', 'a trailing slash must not change the origin');

  assert.throws(() => configuration({ APP_URL: 'app://nextora', NODE_ENV: 'production' }),
    error => error.code === 'CONFIGURATION_ERROR',
    'a hosted build must never accept the desktop scheme');
  assert.throws(() => configuration({ APP_URL: 'app://nextora/extra', NODE_ENV: 'test' }),
    error => error.code === 'CONFIGURATION_ERROR',
    'the desktop origin must be an origin, not a path');
  assert.throws(() => configuration({ APP_URL: 'file:///C:/tmp/app', NODE_ENV: 'test' }),
    error => error.code === 'CONFIGURATION_ERROR',
    'a file:// origin is still refused');
});

/* ------------------------------------------------------------------ first run */

test('a fresh installation can create its owner account and sign in',
  { skip: sqliteMode ? false : 'the first run needs its own local database file' }, () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextora-first-run-'));
    const script = `
      const { getDatabase } = await import(${JSON.stringify(fileUrl('server/db.js'))});
      const { migrate } = await import(${JSON.stringify(fileUrl('scripts/migrate.js'))});
      const { configuration, createAPI } = await import(${JSON.stringify(fileUrl('server/api.js'))});
      const db = getDatabase();
      await migrate(db);
      const config = configuration({ APP_URL: 'app://nextora', NODE_ENV: 'test' });
      const api = createAPI(db, config);
      const call = (method, path, body, cookie) => api(new Request(config.appOrigin + path, {
        method,
        headers: { origin: config.appOrigin, 'sec-fetch-site': 'same-origin',
          ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      }), { ip: '127.0.0.1' });
      const before = await call('GET', '/api/auth/setup');
      const created = await call('POST', '/api/auth/setup', {
        display_name: 'First Owner', email: 'first@example.test', password: 'first-owner-password',
        business_name: 'Nextora Creations', state_code: '36',
      });
      const session = (created.headers.get('set-cookie') || '').split(';')[0];
      const after = await call('GET', '/api/auth/setup');
      const me = await call('GET', '/api/auth/me', undefined, session);
      // A second attempt must never replace the owner.
      const again = await call('POST', '/api/auth/setup', {
        display_name: 'Second Owner', email: 'second@example.test', password: 'second-owner-password',
        business_name: 'Other', state_code: '27',
      });
      await db.close();
      process.stdout.write('RESULT ' + JSON.stringify({
        before: (await before.json()).setup_required,
        createStatus: created.status,
        after: (await after.json()).setup_required,
        meStatus: me.status,
        me: (await me.text()).includes('first@example.test'),
        secondStatus: again.status,
        secondCode: (await again.json()).code,
      }) + '\\n');
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_PATH: join(directory, 'first-run.sqlite'), DATABASE_URL: '' },
    });
    const line = output.split('\n').find(row => row.startsWith('RESULT '));
    assert.ok(line, `the first-run process printed no result: ${output}`);
    const result = JSON.parse(line.slice('RESULT '.length));
    assert.equal(result.before, true, 'a fresh database must ask to be set up');
    assert.equal(result.createStatus, 201, 'the owner account is created');
    assert.equal(result.after, false, 'setup is no longer offered once an owner exists');
    assert.equal(result.meStatus, 200, 'the session issued by setup is usable immediately');
    assert.equal(result.me, true, 'the session belongs to the account that was just created');
    assert.equal(result.secondStatus, 409, 'a second setup attempt is refused');
    assert.equal(result.secondCode, 'ALREADY_INITIALIZED');
  });

/* ------------------------------------------------------------ backup/restore */

test('a backup is verified, and restoring it replaces the live database',
  { skip: sqliteMode ? false : 'local file backups are a SQLite feature' }, async () => {
    const client = makeClient({ ip: '10.9.0.1' });
    await client.login();
    const directory = mkdtempSync(join(tmpdir(), 'nextora-backup-'));

    const status = client.ok(await client.json('GET', '/api/backup/status'), 'status');
    assert.equal(status.driver, 'sqlite');
    assert.ok(status.file.endsWith('.sqlite'), `unexpected database file: ${status.file}`);
    assert.equal(typeof status.counts.clients, 'number');

    const backupPath = join(directory, 'nightly.sqlite');
    const created = client.ok(await client.json('POST', '/api/backup/create', { destination_path: backupPath }), 'backup');
    assert.equal(existsSync(backupPath), true, 'the backup file is written');
    assert.ok(created.backup.size_bytes > 0);
    assert.ok(created.backup.counts.clients >= 0);

    // Change the database after the backup so the restore has something to undo.
    const marker = `Backup Marker ${Date.now()}`;
    const made = client.ok(await client.json('POST', '/api/clients', baseClient({ name: marker })), 'client').client;
    assert.equal((await client.json('GET', `/api/clients/${made.id}`)).status, 200);

    // Files that are not usable backups are refused before anything is touched.
    const junk = join(directory, 'notes.sqlite');
    writeFileSync(junk, 'this is not a SQLite database at all');
    const invalid = await client.json('POST', '/api/backup/restore', { source_path: junk });
    assert.equal(invalid.status, 422);
    assert.equal(invalid.data.code, 'INVALID_BACKUP');

    const missing = await client.json('POST', '/api/backup/restore', { source_path: join(directory, 'absent.sqlite') });
    assert.equal(missing.status, 422);
    assert.equal(missing.data.code, 'BACKUP_NOT_FOUND');
    assert.equal((await client.json('GET', `/api/clients/${made.id}`)).status, 200,
      'a refused restore must leave the live database untouched');

    const restored = client.ok(await client.json('POST', '/api/backup/restore', { source_path: backupPath }), 'restore');
    assert.equal(restored.restore.restored, true);
    assert.equal(existsSync(restored.restore.safety_backup_path), true,
      'the database that was replaced is kept as a safety copy');

    // The session predates the backup, so it survives, and the changed record is gone.
    assert.equal((await client.json('GET', `/api/clients/${made.id}`)).status, 404,
      'the post-backup change was rolled back by the restore');
    const list = client.ok(await client.json('GET', '/api/clients?limit=1'));
    assert.equal(typeof list.total, 'number', 'the API still serves requests after the swap');
    const after = client.ok(await client.json('GET', '/api/backup/status'));
    assert.equal(after.file, status.file, 'the database file did not move');
  });
