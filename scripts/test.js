/**
 * Integration tests run against an isolated, disposable SQLite database file by
 * default (matching the desktop runtime), or a disposable PostgreSQL container
 * when `--postgres` is passed. No development or production database is ever touched.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const usePostgres = process.argv.includes('--postgres');
const name = `nextora-invoicing-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
let started = false;
let tempDir = null;

const run = (file, args, env) => new Promise((resolve, reject) => {
  const child = spawn(file, args, { stdio: 'inherit', env });
  child.on('error', reject);
  child.on('exit', code => resolve(code ?? 1));
});

const unitTests = ['tests/money.test.js', 'tests/words.test.js', 'tests/gst.test.js', 'tests/sqlite-dialect.test.js'];
const integrationTests = readdirSync('tests')
  .filter(file => file.endsWith('.test.js') && !unitTests.includes(`tests/${file}`))
  .map(file => `tests/${file}`)
  .sort();
const selected = process.argv.slice(2).filter(argument => !argument.startsWith('-'));
const files = selected.length ? selected : [...unitTests, ...integrationTests];

try {
  let dbEnv = {};
  if (usePostgres) {
    execFileSync('docker', ['run', '--detach', '--rm', '--name', name,
      '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=invoicing_test',
      '-p', '127.0.0.1::5432', 'postgres:17-alpine'], { stdio: 'pipe' });
    started = true;
    const port = execFileSync('docker', ['port', name, '5432/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1);
    const url = `postgresql://postgres:${password}@127.0.0.1:${port}/invoicing_test`;

    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1000 });
      try {
        await client.connect();
        await client.query('SELECT 1');
        ready = true;
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 500));
      } finally {
        await client.end().catch(() => {});
      }
    }
    if (!ready) throw new Error('Test PostgreSQL did not become ready.');
    dbEnv = { DATABASE_URL: url };
  } else {
    tempDir = mkdtempSync(join(tmpdir(), 'nextora-test-'));
    dbEnv = { DATABASE_PATH: join(tempDir, 'test.sqlite') };
  }

  const baseEnv = { ...process.env };
  if (!usePostgres) delete baseEnv.DATABASE_URL;

  const env = {
    ...baseEnv,
    ...dbEnv,
    APP_URL: 'http://localhost:5174',
    RATE_LIMIT_SECRET: 'test-rate-limit-secret-0123456789abcdef0123456789abcdef',
    OWNER_EMAIL: 'owner@example.test',
    OWNER_PASSWORD: 'test-owner-password',
    NODE_ENV: 'test',
  };

  if (await run(process.execPath, ['scripts/migrate.js'], env)) {
    throw new Error('Migrations failed on the disposable database.');
  }
  if (await run(process.execPath, ['scripts/create-owner.js'], env)) {
    throw new Error('Owner bootstrap failed.');
  }
  // Test files run one at a time: they share one database, and login throttling
  // counters are global state that must not be reset by a neighbouring file.
  process.exitCode = await run(process.execPath, ['--test', '--test-concurrency=1', ...files], env);
} finally {
  if (started) execFileSync('docker', ['stop', name], { stdio: 'pipe' });
  if (tempDir) {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore cleanup lock */ }
  }
}
