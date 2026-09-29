import type { ActionReceipt, IntegrationMode } from './contract.js';
import type { JobRecord } from './types.js';
import { activeSourcing } from './planning.js';
import { formatMoney } from './util.js';

export interface ManagerUpdate {
  subject: string;
  body: string;
}

const LABEL: Record<IntegrationMode, string> = { live: 'live', sandbox: 'SANDBOX', simulated: 'SIMULATED' };

function latestReceipt(record: JobRecord, action_type: ActionReceipt['action_type']): ActionReceipt | null {
  const receipts = record.job.actions.filter((receipt) => receipt.action_type === action_type);
  return receipts[receipts.length - 1] ?? null;
}

/**
 * Builds the manager update from recorded receipts only. Nothing is reported as done unless
 * a receipt says so, and every unsuccessful or unknown action is listed.
 */
export function composeManagerUpdate(record: JobRecord, headline: string): ManagerUpdate {
  const { job, approved_scope } = record;
  const modes = new Set(job.actions.map((receipt) => receipt.mode));
  const prefix = modes.has('live') ? '' : modes.has('sandbox') ? '[SANDBOX] ' : '[SIMULATED] ';
  const lines: string[] = [];

  lines.push(headline, '');
  lines.push(`Job ${job.job_id}, asset ${job.asset_id}, site ${job.site_id}. Status: ${job.status}.`, '');

  lines.push('Finding:');
  for (const finding of approved_scope.findings) {
    lines.push(`- ${finding.id} (severity ${finding.severity}): ${finding.description}`);
  }
  if (approved_scope.findings.length === 0) lines.push('- none recorded');

  const approval = approved_scope.approval;
  lines.push(
    '',
    `Approved action (recommendation ${approved_scope.recommendation_id} v${approved_scope.version}, reviewer ${approval.reviewer_id}, ${LABEL[approval.mode]} approval):`,
    approved_scope.repair_scope,
  );
  if (!record.approval_state.valid) {
    lines.push(`This approval no longer covers the job: ${record.approval_state.invalid_reason}`);
  }

  lines.push('', `Parts (${job.parts_status}):`);
  const sourcing = activeSourcing(record);
  if (approved_scope.parts.length === 0) lines.push('- no parts required');
  for (const part of approved_scope.parts) {
    const entry = sourcing.find((item) => item.part_id === part.part_id);
    if (!entry) {
      lines.push(`- ${part.part_id} x${part.quantity} ${part.unit}: not sourced yet`);
      continue;
    }
    const order = entry.order;
    if (!order) {
      lines.push(`- ${part.part_id} x${part.quantity} ${part.unit}: ${entry.status}. ${entry.status_detail}`);
      continue;
    }
    lines.push(
      `- ${part.part_id} x${part.quantity} ${part.unit} from ${order.supplier_name} (${LABEL[order.mode]})`,
      `  price: ${formatMoney(order.total_minor, order.currency)}`,
      `  availability at quote: ${order.quantity_available_at_quote} ${part.unit}`,
      `  delivery estimate: ${order.estimated_delivery_at ?? 'not given'}${order.delivered_at ? `, delivered ${order.delivered_at}` : ''}`,
      `  purchase outcome: ${order.purchase_outcome}${order.provider_reference ? ` (reference ${order.provider_reference})` : ''}`,
    );
  }

  lines.push('', 'Technician and schedule:');
  const booking = job.booking;
  if (!booking) {
    lines.push('- no technician is booked');
  } else {
    const confirmation = booking.confirmation_action_id
      ? job.actions.find((receipt) => receipt.action_id === booking.confirmation_action_id)
      : null;
    lines.push(
      `- ${booking.technician_name} (${booking.technician_id}), booking ${booking.status}${confirmation ? ` (${LABEL[confirmation.mode]})` : ''}`,
      `- ${booking.start_at} to ${booking.end_at}`,
    );
  }

  const sync = latestReceipt(record, 'schedule_sync');
  lines.push('', 'Schedule workbook:');
  if (!sync) {
    lines.push('- no update has been requested');
  } else if (sync.status === 'confirmed') {
    lines.push(`- updated (${LABEL[sync.mode]}${sync.provider_reference ? `, reference ${sync.provider_reference}` : ''})`);
  } else {
    lines.push(`- NOT updated. The schedule adapter reported ${sync.status}: ${sync.detail}`);
  }

  const unsuccessful = job.actions.filter(
    (receipt) => receipt.status === 'failed' || receipt.status === 'not_configured' || receipt.status === 'pending',
  );
  lines.push('', 'Unsuccessful or unconfirmed actions:');
  if (unsuccessful.length === 0) lines.push('- none');
  for (const receipt of unsuccessful) {
    lines.push(`- ${receipt.action_type} ${receipt.action_id}: ${receipt.status}. ${receipt.detail}`);
  }

  const open = record.escalations.filter((item) => item.resolved_at === null);
  lines.push('', 'Needs attention:');
  if (open.length === 0) lines.push('- nothing');
  for (const escalation of open) {
    lines.push(`- ${escalation.code} (for ${escalation.to}): ${escalation.detail}`);
  }

  if (job.unresolved_findings.length > 0) {
    lines.push('', `Unresolved findings: ${job.unresolved_findings.join(', ')}`);
  }

  return { subject: `${prefix}ThermalDesk repair ${job.job_id}: ${headline}`, body: lines.join('\n') };
}
