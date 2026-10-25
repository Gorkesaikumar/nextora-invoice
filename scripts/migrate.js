import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDatabase } from '../server/db.js';
import { hash } from '../server/auth.js';

/**
 * Forward-only migrations with checksums. A migration that was already applied
 * may never be edited - a new file has to be added instead.
 */
export async function migrate(db, { directory } = {}) {
  const dir = directory || (db.driver === 'sqlite' ? 'server/migrations-sqlite' : 'server/migrations');
  await db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(918273645)');
    await tx.query('CREATE SCHEMA IF NOT EXISTS inv');
    await tx.query(`CREATE TABLE IF NOT EXISTS inv.schema_migrations(
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const files = (await readdir(resolve(dir))).filter(file => file.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = (await readFile(resolve(dir, file), 'utf8')).replace(/\r\n/g, '\n');
      const checksum = hash(sql);
      const existing = (await tx.query('SELECT checksum FROM inv.schema_migrations WHERE name=$1', [file])).rows[0];
      if (existing) {
        if (existing.checksum !== checksum) {
          throw new Error(`Migration ${file} was changed after it was applied. Add a new migration instead.`);
        }
        continue;
      }
      await tx.query(sql);
      await tx.query('INSERT INTO inv.schema_migrations(name,checksum) VALUES($1,$2)', [file, checksum]);
      console.log(`Applied ${file}`);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const db = getDatabase();
  try {
    await migrate(db);
    console.log('Migrations up to date.');
  } finally {
    await db.close();
  }
}
