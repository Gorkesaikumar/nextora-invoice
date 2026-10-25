import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from './auth.js';
import { HttpError } from './domain.js';

// Resolved against this module rather than the working directory: a packaged
// Electron build starts with an unrelated cwd, and silently skipping the
// migration check would let an incompatible backup through.
const DEFAULT_MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations-sqlite');

const SQLITE_MAGIC = 'SQLite format 3\u0000';

/**
 * Every table the shipped DDL creates, read from the migrations themselves. A
 * hand-maintained copy of this list drifts: it previously required a receipts
 * table that the schema never had, which made every backup fail validation.
 * Returns null when the DDL cannot be read, in which case the check is skipped
 * rather than guessed.
 */
function requiredTables(migrationsDir) {
  if (!existsSync(migrationsDir)) return null;
  const names = new Set();
  for (const file of readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    for (const match of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([A-Za-z_][A-Za-z0-9_]*)/gi)) {
      names.add(match[1]);
    }
  }
  return names.size ? names : null;
}

// HttpError keeps the specific code and 422 status visible to the client; the
// request handler maps unknown errors to a generic 503.
function failValidation(message, code = 'INVALID_BACKUP') {
  return new HttpError(422, message, code);
}

/**
 * Inspects a candidate SQLite backup file in read-only mode to verify:
 * 1. File existence, non-zero size, and SQLite 3 magic header.
 * 2. Database structural integrity via PRAGMA integrity_check.
 * 3. Foreign-key consistency via PRAGMA foreign_key_check.
 * 4. Presence of required Nextora schema tables and migration checksums.
 */
export function validateBackupFile(candidatePath, { migrationsDir = DEFAULT_MIGRATIONS_DIR } = {}) {
  if (!candidatePath || !existsSync(candidatePath)) {
    throw failValidation('The selected backup file does not exist.', 'BACKUP_NOT_FOUND');
  }
  const stat = statSync(candidatePath);
  if (!stat.isFile() || stat.size < 100) {
    throw failValidation('The selected file is not a valid SQLite database.', 'INVALID_BACKUP');
  }
  const header = readFileSync(candidatePath).subarray(0, 16).toString('latin1');
  if (header !== SQLITE_MAGIC) {
    throw failValidation('The selected file does not have a valid SQLite 3 header.', 'INVALID_BACKUP');
  }

  let checkDb;
  try {
    checkDb = new DatabaseSync(candidatePath, { readOnly: true });
    const integrityRows = checkDb.prepare('PRAGMA integrity_check').all();
    const integrityOk = integrityRows.length === 1 && String(integrityRows[0].integrity_check).toLowerCase() === 'ok';
    if (!integrityOk) {
      throw failValidation('The backup file failed the SQLite integrity check.', 'CORRUPT_BACKUP');
    }

    const fkRows = checkDb.prepare('PRAGMA foreign_key_check').all();
    if (fkRows.length > 0) {
      throw failValidation('The backup file contains broken foreign-key references.', 'CORRUPT_BACKUP');
    }

    const tables = new Set(
      checkDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name)),
    );
    const expected = requiredTables(migrationsDir);
    const missingTables = expected ? [...expected].filter(name => !tables.has(name)) : [];
    if (missingTables.length > 0) {
      throw failValidation(
        `The backup file is missing required application tables (${missingTables.slice(0, 3).join(', ')}).`,
        'INCOMPATIBLE_SCHEMA',
      );
    }

    const applied = checkDb.prepare('SELECT name, checksum FROM inv_schema_migrations ORDER BY name').all();
    if (applied.length === 0) {
      throw failValidation('The backup file has no recorded schema migrations.', 'INCOMPATIBLE_SCHEMA');
    }

    if (existsSync(migrationsDir)) {
      const knownFiles = new Map(
        readdirSync(migrationsDir)
          .filter(f => f.endsWith('.sql'))
          .map(f => [f, hash(readFileSync(join(migrationsDir, f), 'utf8').replace(/\r\n/g, '\n'))]),
      );
      for (const row of applied) {
        const expected = knownFiles.get(String(row.name));
        if (!expected) {
          throw failValidation(
            `The backup was created by a newer application version (unknown migration ${row.name}). Update the application before restoring this file.`,
            'NEWER_SCHEMA_VERSION',
          );
        }
        if (expected !== String(row.checksum)) {
          throw failValidation(
            `Migration checksum mismatch for ${row.name}. The backup schema is incompatible.`,
            'INCOMPATIBLE_SCHEMA',
          );
        }
      }
    }

    const counts = {
      clients: Number(checkDb.prepare('SELECT count(*) AS n FROM inv_clients').get().n),
      invoices: Number(checkDb.prepare('SELECT count(*) AS n FROM inv_invoices').get().n),
      quotations: Number(checkDb.prepare('SELECT count(*) AS n FROM inv_quotations').get().n),
      pos_customers: Number(checkDb.prepare('SELECT count(*) AS n FROM inv_pos_customers').get().n),
    };

    return {
      valid: true,
      size_bytes: stat.size,
      migrations: applied.map(row => String(row.name)),
      counts,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw failValidation(`Unable to read backup database: ${error.message}`, 'INVALID_BACKUP');
  } finally {
    try { checkDb?.close(); } catch { /* ignore */ }
  }
}

/**
 * Creates a consistent online backup of the live SQLite database using the
 * native SQLite backup API and verifies the resulting file before returning.
 */
export async function createBackup(db, destinationPath, { migrationsDir } = {}) {
  if (db.driver !== 'sqlite') {
    throw new HttpError(400, 'Local file backup is only available when running on the local SQLite database.',
      'UNSUPPORTED_DRIVER');
  }
  mkdirSync(dirname(destinationPath), { recursive: true });
  if (existsSync(destinationPath)) rmSync(destinationPath, { force: true });

  await db.backupTo(destinationPath);
  const verification = validateBackupFile(destinationPath, { migrationsDir });
  return {
    path: destinationPath,
    size_bytes: verification.size_bytes,
    counts: verification.counts,
    created_at: new Date().toISOString(),
  };
}

/**
 * Safely restores a database from `candidatePath`:
 * 1. Validates the candidate backup file and confirms schema compatibility.
 * 2. Copies it to a staging path and verifies integrity on the staged copy.
 * 3. Creates an automatic safety backup of the current live database.
 * 4. Atomically swaps the staged database into place and reloads the connection.
 */
export async function restoreBackup(db, candidatePath, { backupDir, migrationsDir } = {}) {
  if (db.driver !== 'sqlite' || typeof db.replaceWith !== 'function') {
    throw new HttpError(400, 'Local file restore is only available when running on the local SQLite database.',
      'UNSUPPORTED_DRIVER');
  }

  // 1. Validate candidate before touching anything.
  const precheck = validateBackupFile(candidatePath, { migrationsDir });

  // 2. Stage a copy next to the target database and verify the staged copy.
  const targetFile = db.file;
  const stageFile = `${targetFile}.restore-stage-${Date.now()}.sqlite`;
  const safetyDir = backupDir || join(dirname(targetFile), 'backups');
  mkdirSync(safetyDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safetyFile = join(safetyDir, `pre-restore-safety-${stamp}.sqlite`);

  try {
    copyFileSync(candidatePath, stageFile);
    const stagedCheck = validateBackupFile(stageFile, { migrationsDir });

    // 3. Create automatic safety backup of the current database.
    await createBackup(db, safetyFile, { migrationsDir });

    // 4. Switch the live database connection to the verified staged file.
    await db.replaceWith(stageFile);

    return {
      restored: true,
      safety_backup_path: safetyFile,
      size_bytes: stagedCheck.size_bytes,
      counts: precheck.counts,
      restored_at: new Date().toISOString(),
    };
  } finally {
    if (existsSync(stageFile)) {
      try { rmSync(stageFile, { force: true }); } catch { /* ignore */ }
    }
  }
}

/**
 * Returns storage footprint, WAL state, and record counts for the Settings view.
 */
export async function inspectDatabase(db) {
  const countsRow = (await db.query(`
    SELECT
      (SELECT count(*)::int FROM inv.clients) AS clients,
      (SELECT count(*)::int FROM inv.products) AS products,
      (SELECT count(*)::int FROM inv.quotations) AS quotations,
      (SELECT count(*)::int FROM inv.invoices) AS invoices,
      (SELECT count(*)::int FROM inv.payments) AS payments,
      (SELECT count(*)::int FROM inv.pos_customers) AS pos_customers,
      (SELECT count(*)::int FROM inv.pos_subscriptions) AS pos_subscriptions,
      (SELECT count(*)::int FROM inv.custom_field_definitions) AS custom_fields,
      (SELECT count(*)::int FROM inv.pos_shares) AS shares,
      (SELECT count(*)::int FROM inv.audit_logs) AS audit_events
  `)).rows[0];

  const migrations = (await db.query('SELECT name, applied_at FROM inv.schema_migrations ORDER BY name')).rows;

  let sizeBytes = 0;
  let walBytes = 0;
  if (db.driver === 'sqlite' && db.file && db.file !== ':memory:' && existsSync(db.file)) {
    sizeBytes = statSync(db.file).size;
    if (existsSync(`${db.file}-wal`)) walBytes = statSync(`${db.file}-wal`).size;
  }

  return {
    driver: db.driver,
    file: db.driver === 'sqlite' ? db.file : null,
    size_bytes: sizeBytes,
    wal_bytes: walBytes,
    total_bytes: sizeBytes + walBytes,
    counts: countsRow,
    migrations,
  };
}
