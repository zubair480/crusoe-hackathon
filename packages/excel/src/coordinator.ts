import type { ActionReceipt, RepairJob } from '@thermaldesk/contracts';
import { readSchedule, syncSchedule, type ScheduleSnapshot } from './index';

/** Matches Isaac's published scheduling port; job remains canonical. */
export interface CoordinatorScheduleRequest {
  job_id: string;
  idempotency_key: string;
  reason: 'booking_confirmed' | 'booking_cancelled' | 'closure_verified' | 'job_cancelled';
  row: {
    job_id: string; asset_id: string; site_id: string;
    technician_id: string | null; technician_name: string | null;
    start_at: string | null; end_at: string | null;
    parts_status: string; job_status: string; last_updated_at: string;
  };
  job: RepairJob;
}

export interface CoordinatorScheduleOptions {
  workbookPath: string;
  /** Last accepted fingerprint in the caller's persisted state, never a fresh disk read. */
  getExpectedFingerprint: () => string | null | Promise<string | null>;
  /** Store within the existing caller transaction; do not acquire its lock again. */
  onConfirmed: (snapshot: ScheduleSnapshot, receipt: ActionReceipt) => void | Promise<void>;
}

export function createScheduleAdapter(options: CoordinatorScheduleOptions) {
  return {
    mode: 'live' as const,
    deduplicates_by_key: true,
    async syncSchedule(request: CoordinatorScheduleRequest): Promise<ActionReceipt> {
      const { job, row } = request;
      const sameTime = (a: string | null, b?: string) =>
        !a && !b || Boolean(a && b && new Date(a).getTime() === new Date(b).getTime());
      if (request.job_id !== job.job_id || row.job_id !== job.job_id || row.asset_id !== job.asset_id || row.site_id !== job.site_id ||
          row.job_status !== job.status || row.parts_status !== job.parts_status ||
          (row.technician_id ?? '') !== (job.booking?.technician_id ?? '') ||
          (row.technician_name ?? '') !== (job.booking?.technician_name ?? '') ||
          !sameTime(row.start_at, job.booking?.start_at) || !sameTime(row.end_at, job.booking?.end_at)) {
        throw new Error('Schedule request does not match the canonical repair job. No workbook write attempted.');
      }
      const receipt = await syncSchedule({
        workbookPath: options.workbookPath, job, idempotencyKey: request.idempotency_key,
        expectedFingerprint: await options.getExpectedFingerprint(),
      });
      if (receipt.status === 'confirmed') {
        const snapshot = await readSchedule(options.workbookPath);
        // Recheck the job after the write; external Excel processes don't honor our lock.
        const current = snapshot.rows.find(item => item.job_id === job.job_id);
        if (!current || current.last_updated_at !== receipt.recorded_at || current.asset_id !== job.asset_id || current.site_id !== job.site_id ||
            current.job_status !== job.status || current.parts_status !== job.parts_status ||
            current.technician_id !== (job.booking?.technician_id ?? '') || current.technician_name !== (job.booking?.technician_name ?? '') ||
            !sameTime(current.start_at, job.booking?.start_at) || !sameTime(current.end_at, job.booking?.end_at)) {
          throw new Error('Workbook changed after confirmation. Reconcile before continuing.');
        }
        await options.onConfirmed(snapshot, receipt);
      }
      return receipt;
    },
  };
}
