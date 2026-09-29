import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Evidence } from '@thermaldesk/contracts';
import type { CaseService } from './service';
import { localCorsHeaders, requireLocalOrigin } from './http';

const MAX_BYTES = 8 * 1024 * 1024;
const types: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf', 'text/plain': 'txt' };

function validFile(type: string, bytes: Buffer) {
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  return type === 'text/plain' && !bytes.includes(0);
}

export async function uploadCompletion(request: Request, service: CaseService): Promise<Response> {
  const headers = { ...localCorsHeaders(request), 'Cache-Control': 'no-store' };
  try { requireLocalOrigin(request); } catch { return Response.json({ error: 'Local application origin required.' }, { status: 403, headers }); }
  const written: string[] = [];
  let submissionStarted = false;
  try {
    // Bound the actual body too: Content-Length can be absent or inaccurate.
    const reader = request.body?.getReader();
    if (!reader) throw new Error('A multipart completion submission is required.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_BYTES + 128 * 1024) { await reader.cancel(); throw new Error('Maximum combined file size is 8 MB.'); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('content-type') ?? '' } }).formData();
    const field = (name: string, max: number) => {
      const value = form.get(name);
      if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${name} is required (maximum ${max} characters).`);
      return value.trim();
    };
    const revisionText = field('expectedRevision', 16);
    if (!/^\d+$/.test(revisionText) || !Number.isSafeInteger(Number(revisionText))) throw new Error('A case revision is required.');
    const expectedRevision = Number(revisionText);
    const technician_id = field('technician_id', 100);
    const asset_id = field('asset_id', 200);
    const comments = field('comments', 20000);
    const status = field('reported_status', 20);
    if (!['complete', 'incomplete', 'unknown'].includes(status)) throw new Error('reported_status must be complete, incomplete or unknown.');
    const documentKind = form.get('document_kind') ?? 'note';
    if (documentKind !== 'note' && documentKind !== 'receipt') throw new Error('document_kind must be note or receipt.');
    const files = form.getAll('file');
    if (!files.length || files.length > 6 || files.some(file => !(file instanceof File) || !file.size || !types[file.type])) throw new Error('Choose 1–6 PNG, JPEG, PDF or text files.');
    const uploads = files as File[];
    if (uploads.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES) throw new Error('Maximum combined file size is 8 MB.');
    const state = await service.read();
    if (state.revision !== expectedRevision) return Response.json({ error: 'Case changed. Refresh before uploading again.' }, { status: 409, headers });
    if (!state.job || !['scheduled', 'in_progress', 'awaiting_verification'].includes(state.job.status)) throw new Error('A booked or active job is required for completion evidence.');
    const directory = join(service.store.directory, 'evidence');
    await mkdir(directory, { recursive: true });
    const save = async (bytes: Buffer, extension: string) => {
      const name = `${randomUUID()}.${extension}`;
      const path = join(directory, name);
      await writeFile(path, bytes, { flag: 'wx' });
      written.push(path);
      return `local-evidence://${name}`;
    };
    const attachments: Evidence[] = [];
    for (const file of uploads) {
      const bytes = Buffer.from(await file.arrayBuffer());
      if (!validFile(file.type, bytes)) throw new Error('The file contents do not match the selected file type.');
      const uri = await save(bytes, types[file.type]);
      attachments.push({ id: `EV-${randomUUID()}`, kind: documentKind === 'receipt' ? 'receipt' : file.type.startsWith('image/') ? 'photo' : 'note',
        asset_id, source: 'upload', mode: 'live', captured_at: null, uri,
        text: file.type === 'text/plain' ? bytes.toString('utf8').slice(0, 20000) : `Uploaded completion attachment: ${file.name.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120)}. Contents require qualified review.` });
    }
    const statementUri = await save(Buffer.from(comments, 'utf8'), 'txt');
    submissionStarted = true;
    const result = await service.submitUploadedCompletion({ expectedRevision, technician_id,
      reported_status: status as 'complete' | 'incomplete' | 'unknown', comments, attachments,
      transcript: { text: comments, uri: statementUri, source: 'import', mode: 'live', asset_id } });
    return Response.json(result, { status: 201, headers });
  } catch (error) {
    // A coordinator may already have persisted a reference before a later failure.
    // Retain original files after dispatch; never delete potentially referenced evidence.
    if (!submissionStarted) await Promise.all(written.map(path => unlink(path).catch(() => undefined)));
    const message = (error as Error).message;
    return Response.json({ error: message }, { status: /Case changed/.test(message) ? 409 : 400, headers });
  }
}
