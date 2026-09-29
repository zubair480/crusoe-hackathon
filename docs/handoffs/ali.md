# Ali handoff

Updated: 2026-09-29 ~21:45 UTC. Owner: Ali. Branch: `codex/ali-plaud-intake`. Latest pushed implementation commit: see branch head (this update ships with it).

## Status

Increment 1 done: **live Plaud access proven through the Plaud MCP server, callable from app code.** Increments 2–3 reuse the intake operations Zubair placed in `packages/intake/src/index.ts` (kept unchanged; Plaud module added alongside).

## Plaud access (actual)

- Interface: official Plaud MCP server `@plaud-ai/mcp` 0.3.13 over stdio, tools `get_current_user`, `list_files`, `get_file`, `get_transcript`, `get_note`. OAuth via the MCP `login` tool; no Plaud secret in the repo.
- Account: Ali's Plaud account. A physical Plaud device is bound (serial `8821B50319408251` on the device recordings).
- Live pull from `node` (not only from an AI assistant): 6 recordings listed, 5 transcripts pulled (1–269 segments, speaker labels, ms timestamps), 1 skipped by Plaud's own reason (`transaction` block not available; highlight marks only). Listing complete.
- One real device recording converted to a schema-valid `InspectionPackage` (`source: plaud`, `mode: live`, `provider_record_id`, UTC `captured_at`, segment IDs linked from the observation), validated by `assertContract` in the integration workspace.
- Existing recordings are test chatter and Plaud's sample recordings, **not** the scripted repair statements yet. Next: record "The repair is complete on panel DEMO-A", "The part has not arrived; we have not completed the repair", and a wrong-equipment statement on the device.

## Exported interface (`@thermaldesk/intake`, re-exported from `src/index.ts`; also `@thermaldesk/intake/plaud`)

```ts
connectPlaudMcp(opts?: { command?: string; args?: string[]; env?: Record<string, string> }): Promise<PlaudMcpSession>
pullPlaudRecordings(caller: PlaudToolCaller, opts?: {
  query?: string; date_from?: string; date_to?: string; page_size?: number; max_pages?: number;
  file_ids?: string[]; asset_by_file_id?: Record<string, string>; known_asset_ids?: string[];
}): Promise<PlaudPullResult>
// PlaudPullResult = { mode: 'live', pulled_at, account: {id, nickname}, listing_complete,
//   recordings: { detail, transcript: TranscriptInput(source 'plaud', mode 'live'), asset_mentions }[],
//   skipped: { recording, reason }[] }
listPlaudRecordings, fetchPlaudRecording, getPlaudAccount, plaudTranscriptInput, findAssetMentions, parsePlaudPayload
createInspectionPackage(input: CreateInspectionPackageInput): InspectionPackage       // unchanged from integration branch
collectCompletionEvidence(input: CollectCompletionEvidenceInput): CompletionEvidence  // unchanged from integration branch
```

`pullPlaudRecordings(...).recordings[i].transcript` plugs directly into `transcript` of both operations. Unassigned recordings keep `asset_id: null` for review; asset is never guessed.

## Checks performed

- In a worktree of `origin/codex/zubair-app-integration` with this package copied in: `npm test --workspace @thermaldesk/intake` 10/10 pass (3 existing + 7 Plaud: wrapper parsing, UTC normalization, list/transcript paging, skip reasons, file-ID filter, auth abort, asset mentions). `tsc --noEmit` clean.
- `npm run plaud:pull --workspace @thermaldesk/intake` live, results above. Output goes to git-ignored `packages/intake/.plaud-pull/`.

## Requests

- **Zubair:** please add `@modelcontextprotocol/sdk@^1.31.0` to the root lockfile (dependency declared in `packages/intake/package.json`), and a thin server route (e.g. `POST /api/plaud/pull` → `connectPlaudMcp` + `pullPlaudRecordings`, then `createInspectionPackage` / `collectCompletionEvidence` with operator-selected recording + asset). The route must run server-side (spawns a process; needs the Plaud MCP login on that machine).
- `packages/intake/src/index.ts` differs from your copy only by `export * from './plaud.ts'`.

## Remaining

- Record the three scripted repair statements on the Plaud device and run them through `collectCompletionEvidence` (complete / not complete stays open / wrong asset).
- `reported_status` for completion is still supplied by the operator; not inferred from transcript text.
