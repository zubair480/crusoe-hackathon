# Excel schedule adapter

Isaac's coordinator can inject `createScheduleAdapter({workbookPath, getExpectedFingerprint, onConfirmed})`. Its `mode` is `live` (local file only); `syncSchedule(request)` matches the request published in Isaac's handoff, including the job, row, idempotency key and reason. The adapter checks that the proposed row matches the canonical job before writing. `last_updated_at` is the actual write time, not the caller's proposed timestamp.

`getExpectedFingerprint` must return the last accepted fingerprint from persisted application state; use null only for an expected new workbook. Do not reread the disk in that callback to bypass conflict detection. `onConfirmed(snapshot, receipt)` receives the verified snapshot for persistence in the caller's existing transaction. Do not reacquire the same case-store lock inside that callback. Failed writes do not advance this baseline; exceptions must remain visible as failed actions. Isaac's coordinator is not yet published, so this bridge is checked locally against its announced interface.

`syncSchedule({workbookPath, job, idempotencyKey, expectedFingerprint})` returns a schema-compatible ActionReceipt. `readSchedule(workbookPath)` returns `{fingerprint, rows}`. Import from `@thermaldesk/excel` within the npm workspace.

The Schedule sheet uses the agreed v1 column names. Dates are real date cells in UTC and read back as normalized ISO strings. Rows match `job_id`, not their position. Unrelated rows, extra columns, common cell formatting and formulas are preserved in the supported simple workbook. A formula in a managed target cell is rejected rather than overwritten. No macro, chart, pivot or complex-workbook round-trip support is claimed; use the dedicated plain schedule workbook for this demo.

Cooperating writers use an exclusive lock file. SHA-256 fingerprints detect external changes before saving. A temporary workbook is read back before atomic replacement, then the final file is read again. An internal hidden sheet stores idempotency receipts; duplicate keys with altered payloads fail. Retry checks the actual current row before returning a prior receipt. Uncooperative external applications cannot participate in the lock protocol; keep Excel closed while the app writes, and reconcile reported edits explicitly.

This is a real local `.xlsx` operation, not Microsoft 365 synchronization. The calling coordinator must inspect `status`, including failed updates, before telling a manager the workbook was updated. The job store remains the canonical job state.

Known dependency advisory at initial install: ExcelJS 4.4.0 depends on an older uuid package with a buffer bounds advisory in v3/v5/v6. This adapter does not expose those APIs, uses Node's randomUUID for its own IDs, and currently handles only a local demo workbook. Reassess dependency remediation before deployment or expanding untrusted workbook handling.
