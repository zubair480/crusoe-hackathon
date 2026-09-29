import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { assertContract, type Evidence } from '@thermaldesk/contracts';
import { readSchedule, syncSchedule } from '@thermaldesk/excel';
import { CaseStore, seed } from './store';
import { demoPorts, reviewableDemoScope } from './demo-ports';
import type { CaseState, CommandInput, TeamPorts } from './model';

export class CaseService {
  readonly workbookPath: string;
  constructor(readonly store: CaseStore, readonly ports: TeamPorts = demoPorts) {
    this.workbookPath = join(store.directory, 'demo-schedule.xlsx');
  }
  read() { return this.store.read(); }
  async command(input: CommandInput): Promise<CaseState> {
    return this.store.update(async state => {
      if (input.expectedRevision !== state.revision) throw new Error('This case changed. Refresh and review the current version.');
      const note = (title: string, detail: string, mode: 'live' | 'simulated' = 'simulated') => state.events.push({ id: randomUUID(), at: new Date().toISOString(), title, detail, mode });
      const reviewer = () => {
        const name = input.reviewer?.trim();
        if (!name || name.length > 100) throw new Error('Enter a reviewer name (1–100 characters).');
        return name;
      };
      const requireJob = () => { if (!state.job) throw new Error('Create a repair job first.'); return state.job; };
      const writeSchedule = async () => {
        const job = requireJob();
        const result = await syncSchedule({ workbookPath: this.workbookPath, job, idempotencyKey: `schedule:${job.job_id}:${job.state_version}`, expectedFingerprint: state.schedule.fingerprint });
        job.actions = job.actions.filter(a => !(a.action_type === 'schedule_sync' && a.idempotency_key === result.idempotency_key));
        job.actions.push(result);
        if (result.status === 'confirmed') state.schedule = await readSchedule(this.workbookPath);
        note(result.status === 'confirmed' ? 'Excel schedule updated' : 'Excel update needs attention', result.detail, 'live');
      };
      switch (input.command) {
        case 'analyze':
          if (state.job) throw new Error('An active repair exists. Start a new inspection separately.');
          state.recommendation = await this.ports.analyzeInspection(state.inspection);
          state.scenarioLoaded = false;
          note('Inspection reviewed by demo adapter', 'Missing thermal data remains unresolved. Crusoe inference is not connected yet.');
          break;
        case 'load_demo_scope':
          if (state.job) throw new Error('Reset the demo before changing its scope.');
          state.recommendation = reviewableDemoScope();
          state.scenarioLoaded = true;
          note('Synthetic repair scenario loaded', 'Separate training scope loaded to exercise execution. This is not a diagnosis of the incomplete inspection.');
          break;
        case 'approve_scope': {
          const rec = state.recommendation;
          if (!rec || rec.status !== 'draft' || rec.missing_information.length) throw new Error('Resolve missing information before approving the current draft.');
          if (!state.scenarioLoaded || rec.parts.some(p => p.requires_specification_review)) throw new Error('Technical scope is not ready for this demo approval.');
          rec.approval = { reviewer_id: reviewer(), recommendation_version: rec.version, approved_at: new Date().toISOString(), mode: 'simulated' };
          rec.status = 'approved';
          note('Repair scope approved in demo', `${rec.approval.reviewer_id} reviewed version ${rec.version}. No real repair authority granted.`);
          break;
        }
        case 'coordinate': {
          const rec = state.recommendation;
          if (!rec || rec.status !== 'approved' || rec.approval?.recommendation_version !== rec.version) throw new Error('Approve the current recommendation before coordination.');
          if (state.job && !['scheduled', 'blocked'].includes(state.job.status)) throw new Error('This job is already past scheduling.');
          state.job = await this.ports.coordinateRepair(rec, state.job);
          note('Parts and technician coordinated', 'Simulated supplier and technician responses recorded. No purchase, call, or booking occurred outside this demo.');
          await writeSchedule();
          break;
        }
        case 'sync_schedule': await writeSchedule(); break;
        case 'notify_manager': {
          const job = requireJob();
          const action = job.actions.find(a => a.idempotency_key === `schedule:${job.job_id}:${job.state_version}` && a.status === 'confirmed');
          const actual = await readSchedule(this.workbookPath);
          if (!action || actual.fingerprint !== state.schedule.fingerprint) throw new Error('Update and verify the current Excel schedule before notifying the manager.');
          state.job = await this.ports.notifyManager(job, action);
          note('Manager update recorded', 'Simulated message includes job, technician, parts and verified workbook outcome. No external message was sent.');
          break;
        }
        case 'cancel_technician':
          state.job = await this.ports.cancelBooking(requireJob());
          state.completion = null; state.verification = null;
          note('Technician cancelled', 'Appointment is blocked. The reserved demo part is retained for reassignment.');
          await writeSchedule();
          break;
        case 'complete': case 'wrong_asset': case 'incomplete': {
          const job = requireJob();
          if (!['scheduled', 'awaiting_verification'].includes(job.status)) throw new Error('A scheduled job is required for this completion scenario.');
          state.completion = await this.ports.collectCompletionEvidence(job, input.command, (state.completion?.version ?? 0) + 1);
          state.verification = null;
          state.job = await this.ports.submitCompletion(job);
          note('Completion statement received', state.completion.comments);
          await writeSchedule();
          break;
        }
        case 'verify': {
          const job = requireJob();
          if (!state.recommendation || !state.completion) throw new Error('Collect completion evidence before comparison.');
          if (job.status === 'closed') throw new Error('This job is already closed.');
          state.verification = await this.ports.compareCompletion(job, state.recommendation, state.completion);
          note('Completion compared', `Demo comparison: ${state.verification.result.replaceAll('_', ' ')}. A person must review before closure.`);
          break;
        }
        case 'approve_closure': {
          const job = requireJob(), verification = state.verification, completion = state.completion, rec = state.recommendation;
          if (!verification || !completion || !rec || job.status !== 'awaiting_verification') throw new Error('Current completion and verification are required.');
          if (verification.result !== 'ready_for_review' || verification.missing_information.length || verification.checks.some(c => c.result !== 'pass')) throw new Error('Verification has unresolved checks. Keep the job open.');
          if (completion.reported_status !== 'complete' || completion.unresolved_items.length || completion.asset_id !== job.asset_id || completion.evidence.some(e => e.asset_id !== job.asset_id)) throw new Error('Completion does not match this asset or still has open work.');
          if (verification.job_id !== job.job_id || completion.job_id !== job.job_id || verification.completion_id !== completion.completion_id || verification.completion_version !== completion.version || verification.recommendation_version !== rec.version || job.recommendation_version !== rec.version) throw new Error('Evidence changed after review. Repeat verification on current versions.');
          const review = { reviewer_id: reviewer(), verification_id: verification.verification_id, verification_version: verification.version, completion_version: completion.version, recommendation_version: rec.version, decision: 'approve_closure' as const, reviewed_at: new Date().toISOString(), mode: 'simulated' as const };
          state.job = await this.ports.closeRepair(job, review);
          note('Demo repair verified and closed', `${review.reviewer_id} accepted verification version ${verification.version}. This is a synthetic demonstration, not electrical certification.`);
          await writeSchedule();
          break;
        }
        case 'reset_demo': {
          await unlink(this.workbookPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
          const oldRevision = state.revision;
          state = seed(); state.revision = oldRevision;
          break;
        }
        default: throw new Error('Unknown action.');
      }
      assertContract('InspectionPackage', state.inspection);
      for (const [kind, value] of [['Recommendation', state.recommendation], ['RepairJob', state.job], ['CompletionEvidence', state.completion], ['VerificationDraft', state.verification]] as const) if (value) assertContract(kind, value);
      state.revision += 1;
      return { state, result: state };
    });
  }
  async addEvidence(evidence: Evidence, revision: number): Promise<CaseState> {
    return this.store.update(async state => {
      if (state.revision !== revision) throw new Error('Case changed. Refresh before uploading again.');
      if (state.job) throw new Error('Initial inspection is locked once the repair starts.');
      state.inspection.evidence.push(evidence);
      state.recommendation = null; state.scenarioLoaded = false;
      state.events.push({ id: randomUUID(), at: new Date().toISOString(), title: 'Inspection file added', detail: 'File stored locally. Previous draft invalidated; no automatic diagnosis performed.', mode: 'live' });
      assertContract('InspectionPackage', state.inspection);
      state.revision++;
      return { state, result: state };
    });
  }
}

// Demo-only composition root. Replace ports here after reviewing teammate PRs.
export const service = new CaseService(new CaseStore(join(process.cwd(), 'artifacts', 'thermaldesk-demo')));
