/**
 * @thermaldesk/coordination: repair coordinator, canonical repair-job state, persisted
 * event history and external action adapters.
 */
export {
  advanceRepairJob,
  coordinateRepair,
  createRepairJob,
  getJobDetail,
  getJobTimeline,
  getRepairJob,
  listRepairJobs,
  processDueFollowUps,
  runWorkerTick,
} from './engine.js';
export { createFileJobRepository, createInMemoryJobRepository } from './repository.js';
export type { FileJobRepositoryOptions } from './repository.js';
export { createTestClock, systemClock } from './clock.js';
export type { TestClock } from './clock.js';
export {
  createSimulatedCommunication,
  createSimulatedRoster,
  createSimulatedSchedule,
  createSimulatedSupplier,
} from './adapters/simulated.js';
export type {
  SimulatedCatalogEntry,
  SimulatedCommunication,
  SimulatedSchedule,
  SimulatedSupplier,
  SimulatedSupplierOptions,
} from './adapters/simulated.js';
export { assertApproved, scopeFingerprint } from './gate.js';
export { composeManagerUpdate } from './manager.js';
export {
  ApprovalError,
  ConcurrencyError,
  ContractViolationError,
  CoordinationError,
  DuplicateJobError,
  EventRejectedError,
  JobNotFoundError,
} from './errors.js';
export * from './contract.js';
export * from './types.js';

/** Which runtime executes coordination. BAND is not used. */
export const COORDINATION_RUNTIME = 'job_queue' as const;
