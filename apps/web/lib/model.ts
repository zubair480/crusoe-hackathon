import type { InspectionPackage, Recommendation, RepairJob, CompletionEvidence, VerificationDraft, ActionReceipt } from '@thermaldesk/contracts';
import type { ScheduleSnapshot } from '@thermaldesk/excel';

export type { InspectionPackage, Recommendation, RepairJob, CompletionEvidence, VerificationDraft, ActionReceipt };
export interface Event { id: string; at: string; title: string; detail: string; mode: 'live' | 'simulated' }
export interface CaseState {
  revision: number;
  inspection: InspectionPackage;
  recommendation: Recommendation | null;
  job: RepairJob | null;
  completion: CompletionEvidence | null;
  verification: VerificationDraft | null;
  schedule: ScheduleSnapshot;
  events: Event[];
  scenarioLoaded: boolean;
}
export type Command = 'analyze' | 'load_demo_scope' | 'approve_scope' | 'coordinate' | 'sync_schedule' | 'reconcile_schedule' | 'notify_manager' | 'cancel_technician' | 'complete' | 'wrong_asset' | 'incomplete' | 'verify' | 'approve_closure' | 'reset_demo';
export interface CommandInput { command: Command; expectedRevision: number; reviewer?: string; expectedWorkbookFingerprint?: string }

/** Replace these demo ports with teammate package exports; keep UI/routes unchanged. */
export interface TeamPorts {
  analyzeInspection(input: InspectionPackage): Promise<Recommendation>;
  compareCompletion(job: RepairJob, recommendation: Recommendation, completion: CompletionEvidence): Promise<VerificationDraft>;
  coordinateRepair(recommendation: Recommendation, previous: RepairJob | null): Promise<RepairJob>;
  cancelBooking(job: RepairJob): Promise<RepairJob>;
  notifyManager(job: RepairJob, scheduleResult: ActionReceipt): Promise<RepairJob>;
  submitCompletion(job: RepairJob): Promise<RepairJob>;
  closeRepair(job: RepairJob, review: NonNullable<RepairJob['closure_review']>): Promise<RepairJob>;
  collectCompletionEvidence(job: RepairJob, scenario: 'complete' | 'wrong_asset' | 'incomplete', version: number): Promise<CompletionEvidence>;
}
