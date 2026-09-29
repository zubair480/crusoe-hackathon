import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Evidence } from '@thermaldesk/contracts';
import { service } from '../../../lib/service';
import { localCorsHeaders, requireLocalOrigin } from '../../../lib/http';
export const runtime = 'nodejs';
const types: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf', 'text/plain': 'txt' };
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_PDF_PAGES = 3;
const temperature = /-?\d+(?:\.\d+)?\s*(?:°\s*)?(?:C|F|K|celsius|fahrenheit|kelvin)\b/i;

function verifySignature(type: string, content: Buffer): void {
  const valid = type === 'image/png' ? content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : type === 'image/jpeg' ? content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff
      : type === 'application/pdf' ? content.subarray(0, 5).toString('ascii') === '%PDF-'
        : type === 'text/plain' ? !content.subarray(0, 4096).includes(0)
          : false;
  if (!valid) throw new Error('The file contents do not match the selected file type.');
}

export async function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: localCorsHeaders(request) }); }
export async function POST(request: Request) {
  const headers = localCorsHeaders(request);
  try { requireLocalOrigin(request); } catch { return Response.json({ error: 'Local application origin required.' }, { status: 403, headers }); }
  const written: string[] = [];
  try {
    if (Number(request.headers.get('content-length') ?? 0) > MAX_FILE_BYTES + 1024 * 1024) throw new Error('Maximum file size is 8 MB.');
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > MAX_FILE_BYTES || !types[file.type]) throw new Error('Choose a PNG, JPEG, PDF or text file up to 8 MB.');
    const revision = Number(form.get('expectedRevision'));
    if (!Number.isInteger(revision)) throw new Error('A case revision is required.');
    const state = await service.read();
    const safeName = file.name.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120) || 'inspection-file';
    const storedName = `${randomUUID()}.${types[file.type]}`;
    const directory = join(service.store.directory, 'evidence');
    await mkdir(directory, { recursive: true });
    const content = Buffer.from(await file.arrayBuffer());
    verifySignature(file.type, content);
    const originalPath = join(directory, storedName);
    await writeFile(originalPath, content, { flag: 'wx' });
    written.push(originalPath);
    const evidence: Evidence[] = [];
    const base = { asset_id: state.inspection.asset_id, source: 'upload' as const, mode: 'live' as const, captured_at: null };

    if (file.type === 'application/pdf') {
      const { pdf } = await import('pdf-to-img');
      const document = await pdf(originalPath, { scale: 1.5 });
      try {
        const pages = Math.min(document.length, MAX_PDF_PAGES);
        if (!pages) throw new Error('The PDF contains no renderable pages.');
        evidence.push({ id: `EV-${randomUUID()}`, kind: 'note', ...base, uri: `local-evidence://${storedName}`, text: `Uploaded thermal inspection report ${safeName}. ${pages} of ${document.length} page(s) rendered for analysis.` });
        for (let page = 1; page <= pages; page++) {
          const renderedName = `${randomUUID()}.png`;
          const renderedPath = join(directory, renderedName);
          await writeFile(renderedPath, await document.getPage(page), { flag: 'wx' });
          written.push(renderedPath);
          evidence.push({ id: `EV-${randomUUID()}`, kind: 'photo', ...base, uri: `local-evidence://${renderedName}`, text: `Rendered page ${page} of thermal inspection report ${safeName}. Measurements and asset identity require qualified review.` });
        }
      } finally { await document.destroy(); }
    } else if (file.type.startsWith('image/')) {
      evidence.push({ id: `EV-${randomUUID()}`, kind: 'thermal_image', ...base, uri: `local-evidence://${storedName}`, text: `Uploaded thermal evidence ${safeName}. Temperature values must come from calibrated measurements or report text.` });
    } else {
      const text = content.toString('utf8').slice(0, 20_000);
      evidence.push({ id: `EV-${randomUUID()}`, kind: 'note', ...base, uri: `local-evidence://${storedName}`, text });
      if (temperature.test(text)) evidence.push({ id: `EV-${randomUUID()}`, kind: 'measurement', ...base, uri: `local-evidence://${storedName}`, text });
    }
    const result = await service.addEvidenceBatch(evidence, revision);
    return Response.json(result, { status: 201, headers });
  } catch (error) {
    await Promise.all(written.map(path => unlink(path).catch(() => undefined)));
    return Response.json({ error: (error as Error).message }, { status: 400, headers });
  }
}
