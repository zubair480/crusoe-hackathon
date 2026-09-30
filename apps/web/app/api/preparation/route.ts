import { preparation } from '../../../lib/coordination-api';
import type { PreparationCommand } from '../../../lib/repair-preparation';
import { localCorsHeaders, requireLocalOrigin } from '../../../lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store', ...localCorsHeaders(request) };
  try {
    const url = new URL(request.url), kind = url.searchParams.get('draft');
    if (kind) return new Response(await preparation.draft(kind, url.searchParams.get('id') ?? ''), {
      headers: { ...headers, 'Content-Type': 'message/rfc822', 'Content-Disposition': 'attachment; filename="repair-enquiry.eml"' },
    });
    return Response.json(await preparation.read(), { headers });
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 409, headers }); }
}
export async function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: localCorsHeaders(request) }); }
export async function POST(request: Request) {
  const headers = localCorsHeaders(request);
  try { requireLocalOrigin(request); } catch { return Response.json({ error: 'An approved local origin is required.' }, { status: 403, headers }); }
  try { return Response.json(await preparation.command(await request.json() as PreparationCommand), { headers }); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 409, headers }); }
}
