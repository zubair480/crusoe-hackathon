import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { localCorsHeaders } from '../../../lib/http';

export async function GET(request: Request) {
  const crusoe = process.env.THERMALDESK_ANALYSIS_MODE === 'crusoe' ? (process.env.CRUSOE_LIVE_REQUESTS_ENABLED !== 'true' ? 'live_requests_disabled' : process.env.CRUSOE_API_KEY ? 'configured-unverified' : 'not_configured') : 'simulated';
  return Response.json({ status: 'ok', mode: 'local-demo', integrations: { crusoe, plaud: existsSync(join(process.cwd(), '../../packages/intake/.plaud-pull/plaud-pull.json')) ? 'live-pulled' : 'simulated', coordination: 'simulated', excel: 'live-local-file' } }, { headers: localCorsHeaders(request) });
}
