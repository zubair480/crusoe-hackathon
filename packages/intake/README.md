# @thermaldesk/intake

Evidence intake for inspection transcripts and repair completion evidence, with a live Plaud connection through the official Plaud MCP server.

## Contract operations (`src/index.ts`)

- `createInspectionPackage(input)` preserves source URI, provider record ID, segments and evidence asset identity.
- `collectCompletionEvidence(input)` preserves wrong-asset evidence and adds an unresolved item instead of rewriting it.
- Plaud provenance is accepted only when a live source record ID is supplied. Fixtures remain labelled synthetic/simulated.

## Plaud via MCP (`src/plaud.ts`, also re-exported from the package root)

The app spawns `npx -y @plaud-ai/mcp` over stdio (MCP client from `@modelcontextprotocol/sdk`) and calls its tools `get_current_user`, `list_files`, `get_file`, `get_transcript` (block `transaction`, cursor-paged) and `get_note`. It reuses the Plaud OAuth session created by the Plaud MCP `login` tool; no Plaud key is stored in this repo.

```ts
import { connectPlaudMcp, pullPlaudRecordings, createInspectionPackage } from '@thermaldesk/intake';

const plaud = await connectPlaudMcp();
try {
  const pull = await pullPlaudRecordings(plaud, {
    asset_by_file_id: { of_xxx: 'DEMO-A' },   // operator-assigned; others stay asset_id: null
    known_asset_ids: ['DEMO-A', 'DEMO-B'],    // advisory asset_mentions only
  });
  const rec = pull.recordings.find(r => r.transcript.provider_record_id === 'of_xxx')!;
  const pkg = createInspectionPackage({ case_id: 'DEMO-CASE-001', site_id: 'DEMO-SITE', asset_id: 'DEMO-A', transcript: rec.transcript });
} finally {
  await plaud.close();
}
```

| Export | Purpose |
|---|---|
| `connectPlaudMcp(opts?) => Promise<PlaudMcpSession>` | Spawn the Plaud MCP server; `callTool` + `close`. Override with `PLAUD_MCP_COMMAND` / `PLAUD_MCP_ARGS`. |
| `pullPlaudRecordings(caller, opts?) => Promise<PlaudPullResult>` | List every recording (paged), fetch transcript segments, device serial and Plaud notes, map each to a `TranscriptInput`. |
| `listPlaudRecordings`, `fetchPlaudRecording`, `getPlaudAccount` | Lower-level steps. |
| `plaudTranscriptInput(detail, asset_id)` | `source: 'plaud'`, `mode: 'live'`, `uri: plaud://file/<id>#transaction`, `provider_record_id`, UTC `captured_at`, segment IDs `<id>-seg-0001`, seconds, speaker. |
| `PlaudToolCaller` | Injection point: tests use a fake caller; a hosted connector can implement it too. |

Behaviour:

- Recordings without a transcript (e.g. highlight-only) are returned in `skipped` with Plaud's own reason — never filled in.
- Authentication errors abort the pull (`PlaudToolError.authRequired`) instead of being reported as skipped.
- Asset association is never guessed; `asset_mentions` only flags known IDs spoken in the transcript for review.
- Plaud timestamps are naive UTC and are normalized with a `Z` suffix.

## Commands

```bash
npm test --workspace @thermaldesk/intake
npm run plaud:pull --workspace @thermaldesk/intake
npm run plaud:pull --workspace @thermaldesk/intake -- --file of_xxx --case DEMO-CASE-001 --site DEMO-SITE --asset DEMO-A
```

`plaud:pull` writes real recording content to `packages/intake/.plaud-pull/` (git-ignored) and prints a summary. With `--case/--site/--asset/--file` it also writes a schema-valid `InspectionPackage`.
