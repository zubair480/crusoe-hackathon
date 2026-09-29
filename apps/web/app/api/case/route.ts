import { service } from '../../../lib/service';
import type { CommandInput } from '../../../lib/model';
import { localCorsHeaders, requireLocalOrigin } from '../../../lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return Response.json(await service.read(), { headers: { 'Cache-Control': 'no-store', ...localCorsHeaders(request) } }); }
export async function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: localCorsHeaders(request) }); }
export async function POST(request: Request) {
  const headers = localCorsHeaders(request);
  try { requireLocalOrigin(request); } catch (error) { return Response.json({ error: (error as Error).message }, { status: 403, headers }); }
  try {
    const input = await request.json() as CommandInput;
    if (!Number.isInteger(input.expectedRevision)) throw new Error('A case revision is required.');
    return Response.json(await service.command(input), { headers });
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 409, headers }); }
}
