# @thermaldesk/intake

Offline intake boundary for inspection transcripts and repair completion evidence.

- `createInspectionPackage(input)` preserves source URI, provider record ID, segments and evidence asset identity.
- `collectCompletionEvidence(input)` preserves wrong-asset evidence and adds an unresolved item instead of rewriting it.
- Plaud provenance is accepted only when a live source record ID is supplied. Fixtures remain labelled synthetic/simulated.

This package makes no network request and performs no transcription. A future Plaud adapter can map a real provider export into `TranscriptInput` without changing the shared v1 records.
