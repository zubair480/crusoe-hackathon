import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { service } from '../../../../lib/service';
export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}\.(png|jpg|pdf|txt)$/.test(id)) return new Response('Not found', { status: 404 });
  try { return new Response(await readFile(join(service.store.directory, 'evidence', id)), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${id}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } }); }
  catch { return new Response('Not found', { status: 404 }); }
}
