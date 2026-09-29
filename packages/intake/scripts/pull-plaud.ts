// Pull Plaud recordings through the Plaud MCP server into ThermalDesk intake records.
//
//   npm run plaud:pull --workspace @thermaldesk/intake
//   npm run plaud:pull --workspace @thermaldesk/intake -- --file of_xxx --case DEMO-CASE-001 --site DEMO-SITE --asset DEMO-A
//
// Writes the full pull (transcripts + notes) to packages/intake/.plaud-pull/ (git-ignored:
// it contains real recording content). Prints only a summary.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { connectPlaudMcp, pullPlaudRecordings, PlaudToolError } from '../src/plaud.ts';

const { values } = parseArgs({
  options: {
    file: { type: 'string', multiple: true },
    query: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    case: { type: 'string' },
    site: { type: 'string' },
    asset: { type: 'string' },
    'known-assets': { type: 'string', default: 'DEMO-A,DEMO-B' },
    out: { type: 'string' },
  },
});

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', '.plaud-pull');
const knownAssets = values['known-assets']!.split(',').map(s => s.trim()).filter(Boolean);
const assetByFile = values.asset && values.file ? Object.fromEntries(values.file.map(id => [id, values.asset!])) : undefined;

const session = await connectPlaudMcp();
try {
  const result = await pullPlaudRecordings(session, {
    file_ids: values.file,
    query: values.query,
    date_from: values.from,
    date_to: values.to,
    known_asset_ids: knownAssets,
    asset_by_file_id: assetByFile,
  });

  await mkdir(outDir, { recursive: true });
  const outFile = values.out ? resolve(values.out) : resolve(outDir, 'plaud-pull.json');
  await writeFile(outFile, `${JSON.stringify(result, null, 2)}\n`);

  console.log(`Plaud account: ${result.account.nickname ?? '?'} (${result.account.id ?? '?'}) — mode ${result.mode}`);
  console.log(`Listing complete: ${result.listing_complete}. Pulled ${result.recordings.length}, skipped ${result.skipped.length}.`);
  for (const r of result.recordings) {
    const d = r.detail;
    console.log(`  ✓ ${d.recording.id}  ${d.recording.start_at ?? '-'}  ${Math.round((d.recording.duration_ms ?? 0) / 1000)}s  segments=${d.segments.length} notes=${d.notes.length} device=${d.device_serial ?? 'none'} asset=${r.transcript.asset_id ?? 'unassigned'} mentions=[${r.asset_mentions.join(',')}]  "${d.recording.name}"`);
  }
  for (const s of result.skipped) console.log(`  – ${s.recording.id}  skipped: ${s.reason}`);
  console.log(`Wrote ${outFile}`);

  if (values.case && values.site && values.asset) {
    const target = result.recordings.find(r => r.transcript.asset_id === values.asset);
    if (!target) throw new Error('No pulled recording is assigned to --asset; pass --file <plaud id> with --asset.');
    const { createInspectionPackage } = await import('../src/index.ts');
    const pkg = createInspectionPackage({ case_id: values.case, site_id: values.site, asset_id: values.asset, transcript: target.transcript });
    const pkgFile = resolve(outDir, `inspection-${values.case}.json`);
    await writeFile(pkgFile, `${JSON.stringify({ kind: 'InspectionPackage', data: pkg }, null, 2)}\n`);
    console.log(`Schema-valid InspectionPackage from Plaud ${target.transcript.provider_record_id} -> ${pkgFile}`);
  }
} catch (error) {
  if (error instanceof PlaudToolError && error.authRequired) {
    console.error('Plaud is not signed in. Call the Plaud MCP `login` tool (browser OAuth; e.g. from Claude Code) and retry.');
  }
  throw error;
} finally {
  await session.close();
}
