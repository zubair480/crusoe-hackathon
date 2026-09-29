import { coordinationCommand, coordinationStatus, type CoordinationInput } from '../../../lib/coordination-api';
import { localCorsHeaders, requireLocalOrigin } from '../../../lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { return Response.json(await coordinationStatus(), { headers: { 'Cache-Control': 'no-store', ...localCorsHeaders(request) } }); }
  catch { return Response.json({ error: 'Unable to read coordination status.' }, { status: 500 }); }
}
export async function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: localCorsHeaders(request) }); }
export async function POST(request: Request) {
  const headers = localCorsHeaders(request);
  try { requireLocalOrigin(request); }
  catch { return Response.json({ error: 'Coordination requires an approved local application origin.' }, { status: 403, headers }); }
  try { return Response.json(await coordinationCommand(await request.json() as CoordinationInput), { headers }); }
  catch (error) {
    // Band transport errors are sanitized by the gateway before they reach HTTP.
    return Response.json({ error: error instanceof Error ? error.message : 'Coordination request failed.' }, { status: 409, headers });
  }
}
