import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { service } from '../../../lib/service';
import { requireLocalOrigin } from '../../../lib/http';
export const runtime = 'nodejs';
const types: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf', 'text/plain': 'txt' };
export async function POST(request: Request) {
  try { requireLocalOrigin(request); } catch { return Response.json({ error: 'Local application origin required.' }, { status: 403 }); }
  let path: string | undefined;
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 9 * 1024 * 1024) throw new Error('Maximum file size is 8 MB.');
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > 8 * 1024 * 1024 || !types[file.type]) throw new Error('Choose a PNG, JPEG, PDF or text file up to 8 MB.');
    const revision = Number(form.get('expectedRevision'));
    const state = await service.read();
    const id = `${randomUUID()}.${types[file.type]}`;
    const directory = join(service.store.directory, 'evidence');
    await mkdir(directory, { recursive: true });
    path = join(directory, id);
    const content = Buffer.from(await file.arrayBuffer());
    await writeFile(path, content, { flag: 'wx' });
    const result = await service.addEvidence({ id, kind: file.type.startsWith('image/') ? 'thermal_image' : 'note', asset_id: state.inspection.asset_id, source: 'upload', mode: 'live', uri: `local-evidence://${id}`, captured_at: null, text: file.type === 'text/plain' ? content.toString('utf8').slice(0, 20000) : `Uploaded ${file.name}; content not yet interpreted.` }, revision);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (path) await unlink(path).catch(() => undefined);
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
