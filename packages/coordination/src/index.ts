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
  selectCoordinationRuntime,
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

export {
  BAND_ROLES,
  ROLE_CONFIG_KEYS,
  ROLE_DESCRIPTIONS,
  decodeEnvelope,
  encodeEnvelope,
} from './band/protocol.js';
export type { BandRole, Envelope, RoomMessage, RoomParticipant, RoomTools } from './band/protocol.js';
export { createCrewHandler } from './band/crew.js';
export type { CrewDeps, CrewHandler, CriticPolicy } from './band/crew.js';
export { startBandCrew } from './band/live.js';
export type { LiveCrew, LiveCrewOptions } from './band/live.js';
export { createMemoryRoom } from './band/memory-room.js';
export type { MemoryRoom, RoomLogEntry } from './band/memory-room.js';

/** The runtimes a job can run on. Each job records the one it uses. */
export const COORDINATION_RUNTIMES = ['job_queue', 'band'] as const;
