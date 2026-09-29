/** Every error the package throws carries a stable `code` that a web route can map. */
export class CoordinationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** An input does not satisfy the shared contract or an invariant built on it. */
export class ContractViolationError extends CoordinationError {}

/** The recommendation is not covered by a valid, version-matched approval. */
export class ApprovalError extends CoordinationError {}

export class JobNotFoundError extends CoordinationError {
  constructor(job_id: string) {
    super('job_not_found', `No repair job with id "${job_id}" exists in the repository.`);
  }
}

export class DuplicateJobError extends CoordinationError {}

/** Another writer changed the job first. Reload and retry. */
export class ConcurrencyError extends CoordinationError {}

/**
 * A workflow event was recorded in the job history as rejected and changed nothing else.
 * Re-sending the same event id raises the same error.
 */
export class EventRejectedError extends CoordinationError {
  readonly job_id: string;
  readonly event_id: string;

  constructor(job_id: string, event_id: string, code: string, message: string) {
    super(code, message);
    this.job_id = job_id;
    this.event_id = event_id;
  }
}
