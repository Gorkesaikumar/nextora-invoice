import { randomUUID } from 'node:crypto';

/** Every important action is written to an append-only log inside the caller's transaction. */
export function audit(runner, event, { actorId = null, entityType = 'SYSTEM', entityId = null, metadata = {} } = {}) {
  return runner.query('INSERT INTO inv.audit_logs(id,event,actor_id,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), event, actorId, entityType, entityId, JSON.stringify(metadata)]);
}

export function statusChange(runner, { documentType, documentId, from, to, note = '', actorId = null }) {
  return runner.query(`INSERT INTO inv.document_status_history(id,document_type,document_id,from_status,to_status,note,actor_id)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), documentType, documentId, from, to, note, actorId]);
}
