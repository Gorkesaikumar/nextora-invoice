import { financialYear } from './words.js';

/**
 * Document numbers are allocated inside the caller's transaction by a single
 * atomic UPDATE on the sequence row. Two concurrent issues can never receive the
 * same number: the second waits for the first to commit and then increments.
 */
export async function allocateNumber(tx, { docType, prefix, date }) {
  const year = financialYear(date);
  const { rows } = await tx.query(`
    INSERT INTO inv.document_sequences(doc_type, financial_year, prefix, next_number)
    VALUES($1, $2, $3, 2)
    ON CONFLICT (doc_type, financial_year) DO UPDATE
      SET next_number = inv.document_sequences.next_number + 1, updated_at = now()
    RETURNING next_number - 1 AS allocated, prefix`, [docType, year, prefix]);
  const { allocated, prefix: activePrefix } = rows[0];
  return {
    number: `${activePrefix}/${year}/${String(allocated).padStart(4, '0')}`,
    financial_year: year,
    sequence: Number(allocated),
    // Surfaced so the UI can warn when a settings change cannot renumber mid-year.
    prefix_mismatch: activePrefix !== prefix ? { active: activePrefix, configured: prefix } : null,
  };
}

export function previewNumber(prefix, date, sequence = 1) {
  const year = financialYear(date);
  return `${prefix}/${year}/${String(sequence).padStart(4, '0')}`;
}
