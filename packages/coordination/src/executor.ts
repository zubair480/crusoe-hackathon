import {
  ACTION_STATUSES,
  modeCovers,
  type ActionReceipt,
  type ActionStatus,
  type ActionType,
  type IntegrationMode,
} from './contract.js';
import type { JobRun } from './run.js';
import type { AdapterOutcome, LedgerEntry } from './types.js';
import { describeError } from './util.js';

export interface ActionSpec {
  action_type: ActionType;
  /** Stable name of the logical action inside the job, for example `parts_order:P1:r1:SUP-A`. */
  logical_key: string;
  mode: IntegrationMode;
  summary: string;
  /** Purchases, outreach and bookings need a valid approval. Publishing state does not. */
  requires_approval: boolean;
  deduplicates_by_key: boolean;
  /** Start a new attempt when the previous one definitely failed. */
  retry_failed?: boolean;
  extra_evidence_ids?: string[];
  /** Band runtime: facts the critic needs to decide. Setting this makes the action gated. */
  verdict_details?: unknown;
  invoke: (idempotency_key: string) => Promise<AdapterOutcome & { data?: unknown }>;
}

export interface ActionRefusal {
  kind: 'refused';
  code: string;
  message: string;
}

export interface ActionRecorded {
  kind: 'recorded';
  receipt: ActionReceipt;
  /** Data the step stored with the outcome. Returned again when the action is replayed. */
  data: unknown;
  /** True when no adapter was called because the outcome was already known. */
  replayed: boolean;
  /** True when the adapter was interrupted and the real outcome is not known. */
  in_doubt: boolean;
}

export type ActionResult = ActionRefusal | ActionRecorded;

/** Free text must show that an outcome was not live, not only the `mode` field. */
export function labelDetail(mode: IntegrationMode, detail: string): string {
  if (mode === 'live') return detail;
  const label = mode === 'simulated' ? 'SIMULATED' : 'SANDBOX';
  return detail.toUpperCase().includes(label) ? detail : `[${label}] ${detail}`;
}

/** The authority and approval rules one action must satisfy before any adapter is called. */
export function checkActionAllowed(
  run: JobRun,
  action_type: ActionType,
  mode: IntegrationMode,
  requires_approval: boolean,
): ActionRefusal | null {
  const refuse = (code: string, message: string): ActionRefusal => ({ kind: 'refused', code, message });
  const authority = run.job.authority;
  if (!authority) {
    return refuse('authority_missing', `No authority is configured, so ${action_type} cannot run.`);
  }
  if (Date.parse(authority.expires_at) <= run.nowMs()) {
    return refuse(
      'authority_expired',
      `Authority ${authority.authority_id} expired at ${authority.expires_at}.`,
    );
  }
  if (!authority.allowed_actions.includes(action_type)) {
    return refuse(
      'action_not_authorized',
      `Authority ${authority.authority_id} does not allow ${action_type}.`,
    );
  }
  if (!modeCovers(authority.mode, mode)) {
    return refuse(
      'mode_not_authorized',
      `Authority ${authority.authority_id} is ${authority.mode} and does not cover a ${mode} ${action_type}.`,
    );
  }
  if (!requires_approval) return null;
  const { approval_state, approved_scope } = run.record;
  if (!approval_state.valid) {
    return refuse(
      'approval_invalid',
      `The approval no longer covers this job: ${approval_state.invalid_reason ?? 'unknown reason'}.`,
    );
  }
  if (approved_scope.approval.recommendation_version !== run.job.recommendation_version) {
    return refuse(
      'approval_version_mismatch',
      `The approval is for version ${approved_scope.approval.recommendation_version}, the job is at version ${run.job.recommendation_version}.`,
    );
  }
  if (!modeCovers(approved_scope.approval.mode, mode)) {
    return refuse(
      'approval_mode_insufficient',
      `The approval is ${approved_scope.approval.mode} and does not cover a ${mode} ${action_type}.`,
    );
  }
  return null;
}

function isActionStatus(value: unknown): value is ActionStatus {
  return typeof value === 'string' && (ACTION_STATUSES as readonly string[]).includes(value);
}

/**
 * Runs one external action at most once.
 *
 * The intent is persisted before the adapter is called and the outcome after it returns. A
 * known outcome is replayed without calling the adapter. An interrupted call is repeated
 * only when the provider deduplicates on the idempotency key; otherwise it stays `pending`
 * and is escalated, because repeating it could buy, book or notify twice.
 */
export async function executeAction(run: JobRun, spec: ActionSpec): Promise<ActionResult> {
  const attempts = run.record.ledger
    .filter((entry) => entry.logical_key === spec.logical_key)
    .sort((a, b) => a.attempt - b.attempt);
  const last = attempts[attempts.length - 1];
  let attempt = 1;

  if (last) {
    if (last.state === 'intent') {
      if (spec.deduplicates_by_key) return invokeAndRecord(run, spec, last);
      return recordUnknownOutcome(run, spec, last, 'The previous run stopped before the outcome was recorded.');
    }
    const failed = last.status === 'failed' || last.status === 'not_configured';
    const retry = failed && spec.retry_failed === true && last.attempt < run.config.max_action_attempts;
    if (!retry) {
      return {
        kind: 'recorded',
        receipt: run.receipt(last.action_id),
        data: last.data,
        replayed: true,
        in_doubt: false,
      };
    }
    attempt = last.attempt + 1;
  }

  const refusal = checkActionAllowed(run, spec.action_type, spec.mode, spec.requires_approval);
  if (refusal) {
    run.emit({
      type: 'action_refused',
      summary: `Not executed, ${spec.summary}: ${refusal.message}`,
      mode: spec.mode,
      data: { action_type: spec.action_type, logical_key: spec.logical_key, code: refusal.code },
    });
    return refusal;
  }

  if (run.requiresVerdicts && spec.verdict_details !== undefined) {
    const verdict = run.verdictFor(spec.logical_key, spec.action_type, spec.summary, spec.verdict_details);
    if (verdict.status === 'pending') {
      await run.persist();
      return {
        kind: 'refused',
        code: 'verdict_pending',
        message: `Waiting for the critic's verdict ${verdict.request_id} before: ${spec.summary}`,
      };
    }
    if (verdict.status === 'blocked') {
      return {
        kind: 'refused',
        code: 'verdict_blocked',
        message: `The critic blocked (${verdict.request_id}): ${verdict.reason ?? 'no reason given'}`,
      };
    }
  }

  const action_id = run.nextActionId();
  const now = run.nowIso();
  const entry: LedgerEntry = {
    idempotency_key: `${run.job.job_id}:${spec.logical_key}:a${attempt}`,
    logical_key: spec.logical_key,
    attempt,
    action_id,
    action_type: spec.action_type,
    state: 'intent',
    requested_at: now,
    recorded_at: null,
    status: null,
    data: null,
  };
  run.record.ledger.push(entry);
  run.job.actions.push({
    action_id,
    job_id: run.job.job_id,
    action_type: spec.action_type,
    idempotency_key: entry.idempotency_key,
    mode: spec.mode,
    status: 'requested',
    provider_reference: null,
    evidence_ids: [...(spec.extra_evidence_ids ?? [])],
    detail: labelDetail(spec.mode, `Request prepared, outcome not yet known: ${spec.summary}`),
    recorded_at: now,
  });
  run.emit({
    type: 'action_requested',
    summary: `${spec.summary} (attempt ${attempt})`,
    action_id,
    mode: spec.mode,
    data: { action_type: spec.action_type, idempotency_key: entry.idempotency_key },
  });
  await run.persist();
  return invokeAndRecord(run, spec, entry);
}

async function invokeAndRecord(run: JobRun, spec: ActionSpec, entry: LedgerEntry): Promise<ActionResult> {
  let outcome: AdapterOutcome & { data?: unknown };
  try {
    outcome = await spec.invoke(entry.idempotency_key);
  } catch (error) {
    const described = describeError(error);
    run.addEvidence('adapter_error', spec.mode, described, entry.action_id);
    if (!spec.deduplicates_by_key) {
      return recordUnknownOutcome(run, spec, entry, `The adapter raised: ${described.message}`);
    }
    const receipt = run.receipt(entry.action_id);
    receipt.status = 'pending';
    receipt.recorded_at = run.nowIso();
    receipt.detail = labelDetail(
      spec.mode,
      `Outcome unknown. The adapter raised: ${described.message}. It will be repeated with the same idempotency key.`,
    );
    run.emit({
      type: 'action_interrupted',
      summary: `${spec.summary}: outcome unknown (${described.message})`,
      action_id: entry.action_id,
      mode: spec.mode,
      data: described,
    });
    await run.persist();
    return { kind: 'recorded', receipt, data: null, replayed: false, in_doubt: true };
  }

  const status: ActionStatus = isActionStatus(outcome.status) ? outcome.status : 'failed';
  const detail = isActionStatus(outcome.status)
    ? outcome.detail
    : `The adapter returned an unknown status "${String(outcome.status)}". ${outcome.detail ?? ''}`.trim();
  const evidence = run.addEvidence(
    'provider_response',
    spec.mode,
    outcome.raw ?? { status, provider_reference: outcome.provider_reference, detail },
    entry.action_id,
  );
  const receipt = run.receipt(entry.action_id);
  receipt.status = status;
  receipt.provider_reference = outcome.provider_reference ?? null;
  receipt.detail = labelDetail(spec.mode, detail);
  receipt.evidence_ids = [...(spec.extra_evidence_ids ?? []), evidence.evidence_id];
  receipt.recorded_at = run.nowIso();
  entry.state = 'recorded';
  entry.status = status;
  entry.recorded_at = receipt.recorded_at;
  entry.data = outcome.data === undefined ? null : outcome.data;
  run.emit({
    type: 'action_recorded',
    summary: `${spec.summary}: ${status}`,
    action_id: entry.action_id,
    mode: spec.mode,
    data: {
      action_type: spec.action_type,
      status,
      provider_reference: receipt.provider_reference,
      idempotency_key: entry.idempotency_key,
      evidence_ids: receipt.evidence_ids,
    },
  });
  await run.persist();
  return { kind: 'recorded', receipt, data: entry.data, replayed: false, in_doubt: false };
}

async function recordUnknownOutcome(
  run: JobRun,
  spec: ActionSpec,
  entry: LedgerEntry,
  cause: string,
): Promise<ActionResult> {
  const receipt = run.receipt(entry.action_id);
  receipt.status = 'pending';
  receipt.recorded_at = run.nowIso();
  receipt.detail = labelDetail(
    spec.mode,
    `Outcome unknown. ${cause} It is not repeated automatically, to avoid a duplicate. Confirm the outcome manually.`,
  );
  entry.state = 'recorded';
  entry.status = 'pending';
  entry.recorded_at = receipt.recorded_at;
  run.emit({
    type: 'action_outcome_unknown',
    summary: `${spec.summary}: outcome unknown, not repeated`,
    action_id: entry.action_id,
    mode: spec.mode,
    data: { cause },
  });
  run.escalate(
    'action_outcome_unknown',
    'manager',
    entry.logical_key,
    `The outcome of "${spec.summary}" is unknown (${cause}). Confirm it with the provider before anything is repeated.`,
  );
  await run.persist();
  return { kind: 'recorded', receipt, data: null, replayed: false, in_doubt: true };
}

/** Records that an integration is absent. No adapter is called. */
export async function recordNotConfigured(
  run: JobRun,
  action_type: ActionType,
  logical_key: string,
  summary: string,
  detail: string,
): Promise<ActionResult> {
  return executeAction(run, {
    action_type,
    logical_key,
    mode: run.job.authority?.mode ?? 'simulated',
    summary,
    requires_approval: false,
    deduplicates_by_key: true,
    invoke: async () => ({ status: 'not_configured', provider_reference: null, detail }),
  });
}
