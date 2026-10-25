import { randomUUID } from 'node:crypto';
import { getDatabase } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { migrate } from './migrate.js';

/**
 * One-time bootstrap for the owner account. The password is read from the
 * environment so it never lands in shell history or the repository.
 */
const email = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
const password = process.env.OWNER_PASSWORD || '';
const displayName = process.env.OWNER_NAME || 'Nextora Creations Owner';

if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) throw new Error('OWNER_EMAIL is required and must be a valid address.');
if (password.length < 12) throw new Error('OWNER_PASSWORD is required and must be at least 12 characters.');

const db = getDatabase();
try {
  await migrate(db);
  const existing = (await db.query('SELECT id FROM inv.users WHERE email=$1', [email])).rows[0];
  const passwordHash = await hashPassword(password);
  if (existing) {
    await db.query('UPDATE inv.users SET password_hash=$2, disabled=false, must_change_password=false WHERE id=$1', [existing.id, passwordHash]);
    await db.query('DELETE FROM inv.sessions WHERE user_id=$1', [existing.id]);
    console.log(`Password reset for ${email}. Remove OWNER_PASSWORD from your environment now.`);
  } else {
    const id = randomUUID();
    await db.query(`INSERT INTO inv.users(id,email,password_hash,role,display_name,must_change_password)
      VALUES($1,$2,$3,'OWNER',$4,false)`, [id, email, passwordHash, displayName]);
    console.log(`Owner account created for ${email}. Remove OWNER_PASSWORD from your environment now.`);
  }
} finally {
  await db.close();
}
