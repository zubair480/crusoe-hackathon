// Keeps the local Plaud cache fresh for the demo. This is a polling fallback
// because Plaud MCP currently exposes listing/transcript tools rather than a
// recording-created webhook.
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectPlaudMcp, pullPlaudRecordings } from '../src/plaud.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', '.plaud-pull');
const outFile = resolve(outDir, 'plaud-pull.json');
const intervalMs = Math.max(5_000, Number(process.env.PLAUD_WATCH_INTERVAL_MS ?? 10_000));
const delay = (ms: number) => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
let stopping = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopping = true; });

await mkdir(outDir, { recursive: true });
console.log(`Plaud watcher active; refreshing every ${Math.round(intervalMs / 1000)}s.`);

while (!stopping) {
  let session: Awaited<ReturnType<typeof connectPlaudMcp>> | null = null;
  try {
    session = await connectPlaudMcp();
    const result = await pullPlaudRecordings(session, { known_asset_ids: ['DEMO-A', 'DEMO-B'] });
    const temporary = `${outFile}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    await rename(temporary, outFile);
    const newest = result.recordings.map(item => item.detail.recording.start_at).filter(Boolean).sort().at(-1) ?? 'none';
    console.log(`${new Date().toISOString()} refreshed=${result.recordings.length} skipped=${result.skipped.length} newest=${newest}`);
  } catch (error) {
    console.error(`${new Date().toISOString()} refresh failed: ${(error as Error).message}`);
  } finally {
    await session?.close().catch(() => undefined);
  }
  if (!stopping) await delay(intervalMs);
}

console.log('Plaud watcher stopped.');
