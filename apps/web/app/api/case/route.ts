import { service } from '../../../lib/service';
import type { CommandInput } from '../../../lib/model';
import { requireLocalOrigin } from '../../../lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() { return Response.json(await service.read(), { headers: { 'Cache-Control': 'no-store' } }); }
export async function POST(request: Request) {
  try { requireLocalOrigin(request); } catch (error) { return Response.json({ error: (error as Error).message }, { status: 403 }); }
  try {
    const input = await request.json() as CommandInput;
    if (!Number.isInteger(input.expectedRevision)) throw new Error('A case revision is required.');
    return Response.json(await service.command(input));
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 409 }); }
}
