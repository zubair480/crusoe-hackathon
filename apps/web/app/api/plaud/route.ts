import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { service } from '../../../lib/service';
import { localCorsHeaders, requireLocalOrigin } from '../../../lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Serves recordings pulled from the Plaud MCP server (packages/intake `plaud:pull`) and attaches
// a selected transcript to the current inspection as live Plaud evidence.
async function readPull() {
  for (const p of [join(process.cwd(), '../../packages/intake/.plaud-pull/plaud-pull.json'), join(process.cwd(), 'packages/intake/.plaud-pull/plaud-pull.json')]) {
    try { return JSON.parse(await readFile(p, 'utf8')); } catch { /* try next */ }
  }
  return null;
}

export async function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: localCorsHeaders(request) }); }

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store', ...localCorsHeaders(request) };
  const pull = await readPull();
  if (!pull) return Response.json({ available: false, recordings: [] }, { headers });
  const recordings = (pull.recordings ?? []).map((r: any) => ({
    id: r.transcript.provider_record_id ?? r.detail?.recording?.id, name: r.detail?.recording?.name ?? null,
    start_at: r.detail?.recording?.start_at ?? r.transcript.captured_at, duration_ms: r.detail?.recording?.duration_ms ?? null,
    text: String(r.transcript.text ?? '').slice(0, 2000), asset_mentions: r.asset_mentions ?? [], mode: r.transcript.mode,
  })).sort((a: any, b: any) => String(b.start_at ?? '').localeCompare(String(a.start_at ?? '')));
  return Response.json({ available: true, mode: pull.mode, pulled_at: pull.pulled_at, recordings }, { headers });
}

export async function POST(request: Request) {
  const headers = localCorsHeaders(request);
  try { requireLocalOrigin(request); } catch (error) { return Response.json({ error: (error as Error).message }, { status: 403, headers }); }
  try {
    const { recording_id, expectedRevision } = await request.json() as { recording_id: string; expectedRevision: number };
    if (!Number.isInteger(expectedRevision)) throw new Error('A case revision is required.');
    const pull = await readPull(); if (!pull) throw new Error('No Plaud pull found. Run the Plaud pull first.');
    const rec = (pull.recordings ?? []).find((r: any) => (r.transcript.provider_record_id ?? r.detail?.recording?.id) === recording_id);
    if (!rec) throw new Error('Recording not found in the latest Plaud pull.');
    const t = rec.transcript, state = await service.read();
    const evidence = {
      id: `EV-PLAUD-${String(recording_id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}`, kind: 'transcript' as const,
      asset_id: state.inspection.asset_id, source: 'plaud' as const, mode: t.mode === 'live' ? 'live' as const : 'simulated' as const,
      uri: String(t.uri ?? `plaud://file/${recording_id}`), captured_at: t.captured_at ?? null, text: String(t.text ?? '').slice(0, 20000),
      ...(t.provider_record_id ? { provider_record_id: String(t.provider_record_id) } : {}),
    };
    if (state.inspection.evidence.some(e => e.id === evidence.id)) return Response.json(state, { headers });
    return Response.json(await service.addEvidence(evidence, expectedRevision), { status: 201, headers });
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 400, headers }); }
}
