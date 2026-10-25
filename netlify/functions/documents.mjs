import { getDatabase } from '../../server/db.js';
import { configuration, createAPI } from '../../server/api.js';

let handler;

export default async (request, context) => {
  try {
    // Hosted functions always require production cookie, origin and secret
    // configuration. Local development uses server/local.js rather than
    // weakening this adapter.
    handler ||= createAPI(getDatabase(), configuration({ ...process.env, NODE_ENV: 'production' }));
    return await handler(request, { ip: context.ip || 'unknown' });
  } catch {
    return Response.json({ error: 'The invoicing service is awaiting server configuration.', code: 'UNAVAILABLE' },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
};

export const config = { path: '/api/*' };
