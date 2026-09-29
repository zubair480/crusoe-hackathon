import {
  ACTION_TYPES,
  INTEGRATION_MODES,
  RECOMMENDATION_STATUSES,
  SCHEMA_VERSION,
  type Authority,
  type Recommendation,
} from './contract.js';
import { ApprovalError, ContractViolationError } from './errors.js';
import type { ApprovedScope } from './types.js';
import { clone, fingerprint, normaliseSpecification, parseTime } from './util.js';

function requireText(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ContractViolationError('invalid_field', `${field} must be a non-empty string.`);
  }
}

function requireOneOf(value: unknown, allowed: readonly string[], field: string): void {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ContractViolationError('invalid_field', `${field} must be one of: ${allowed.join(', ')}.`);
  }
}

/** Checks the parts of a Recommendation the coordinator relies on. */
export function assertRecommendationShape(recommendation: Recommendation): void {
  if (recommendation === null || typeof recommendation !== 'object') {
    throw new ContractViolationError('invalid_recommendation', 'recommendation must be an object.');
  }
  if (recommendation.schema_version !== SCHEMA_VERSION) {
    throw new ContractViolationError(
      'unsupported_schema_version',
      `recommendation.schema_version must be "${SCHEMA_VERSION}".`,
    );
  }
  requireText(recommendation.case_id, 'recommendation.case_id');
  requireText(recommendation.site_id, 'recommendation.site_id');
  requireText(recommendation.asset_id, 'recommendation.asset_id');
  requireText(recommendation.recommendation_id, 'recommendation.recommendation_id');
  requireOneOf(recommendation.status, RECOMMENDATION_STATUSES, 'recommendation.status');
  if (!Number.isInteger(recommendation.version) || recommendation.version < 1) {
    throw new ContractViolationError('invalid_field', 'recommendation.version must be a positive integer.');
  }
  if (typeof recommendation.repair_scope !== 'string') {
    throw new ContractViolationError('invalid_field', 'recommendation.repair_scope must be a string.');
  }
  if (!Array.isArray(recommendation.findings) || !Array.isArray(recommendation.parts)) {
    throw new ContractViolationError('invalid_field', 'recommendation.findings and parts must be arrays.');
  }
  const seen = new Set<string>();
  recommendation.parts.forEach((part, index) => {
    const field = `recommendation.parts[${index}]`;
    requireText(part.part_id, `${field}.part_id`);
    if (seen.has(part.part_id)) {
      throw new ContractViolationError('duplicate_part', `${field}.part_id "${part.part_id}" is listed twice.`);
    }
    seen.add(part.part_id);
    if (typeof part.approved_specification !== 'string') {
      throw new ContractViolationError('invalid_field', `${field}.approved_specification must be a string.`);
    }
    if (typeof part.quantity !== 'number' || !Number.isFinite(part.quantity) || part.quantity <= 0) {
      throw new ContractViolationError('invalid_field', `${field}.quantity must be greater than 0.`);
    }
    if (typeof part.requires_specification_review !== 'boolean') {
      throw new ContractViolationError('invalid_field', `${field}.requires_specification_review must be a boolean.`);
    }
  });
  recommendation.findings.forEach((finding, index) => {
    requireText(finding.id, `recommendation.findings[${index}].id`);
  });
}

/**
 * Throws unless the recommendation is approved and the approval names this exact version.
 * An approval for an earlier version does not cover a later one.
 */
export function assertApproved(recommendation: Recommendation): void {
  assertRecommendationShape(recommendation);
  if (recommendation.status !== 'approved') {
    throw new ApprovalError(
      'recommendation_not_approved',
      `Recommendation ${recommendation.recommendation_id} v${recommendation.version} is "${recommendation.status}", not approved.`,
    );
  }
  const approval = recommendation.approval;
  if (approval === null || typeof approval !== 'object') {
    throw new ApprovalError(
      'approval_missing',
      `Recommendation ${recommendation.recommendation_id} v${recommendation.version} has no approval record.`,
    );
  }
  requireText(approval.reviewer_id, 'recommendation.approval.reviewer_id');
  requireOneOf(approval.mode, INTEGRATION_MODES, 'recommendation.approval.mode');
  parseTime(approval.approved_at, 'recommendation.approval.approved_at');
  if (approval.recommendation_version !== recommendation.version) {
    throw new ApprovalError(
      'approval_version_mismatch',
      `The approval is for version ${approval.recommendation_version}, but recommendation ${recommendation.recommendation_id} is at version ${recommendation.version}. A changed recommendation needs a new approval.`,
    );
  }
}

export function assertAuthorityShape(authority: Authority): void {
  if (authority === null || typeof authority !== 'object') {
    throw new ContractViolationError('invalid_authority', 'authority must be an object.');
  }
  requireText(authority.authority_id, 'authority.authority_id');
  requireOneOf(authority.mode, INTEGRATION_MODES, 'authority.mode');
  if (typeof authority.currency !== 'string' || !/^[A-Z]{3}$/.test(authority.currency)) {
    throw new ContractViolationError('invalid_field', 'authority.currency must be three capital letters.');
  }
  if (!Number.isInteger(authority.max_total_minor) || authority.max_total_minor < 0) {
    throw new ContractViolationError('invalid_field', 'authority.max_total_minor must be a non-negative integer.');
  }
  if (!Array.isArray(authority.allowed_actions)) {
    throw new ContractViolationError('invalid_field', 'authority.allowed_actions must be an array.');
  }
  authority.allowed_actions.forEach((action, index) => {
    requireOneOf(action, ACTION_TYPES, `authority.allowed_actions[${index}]`);
  });
  parseTime(authority.expires_at, 'authority.expires_at');
}

/**
 * Hash of what a reviewer approved: the asset, the repair scope, the findings addressed and
 * every part with its specification and quantity. Version, status and timestamps are left
 * out on purpose, so a silent change under an unchanged version number is still detected.
 */
export function scopeFingerprint(recommendation: Recommendation): string {
  return fingerprint({
    recommendation_id: recommendation.recommendation_id,
    case_id: recommendation.case_id,
    site_id: recommendation.site_id,
    asset_id: recommendation.asset_id,
    repair_scope: recommendation.repair_scope.trim(),
    finding_ids: recommendation.findings.map((finding) => finding.id).sort(),
    parts: [...recommendation.parts]
      .sort((a, b) => a.part_id.localeCompare(b.part_id))
      .map((part) => ({
        part_id: part.part_id,
        approved_specification: normaliseSpecification(part.approved_specification),
        quantity: part.quantity,
        unit: part.unit.trim().toLowerCase(),
        requires_specification_review: part.requires_specification_review,
      })),
  });
}

export function snapshotScope(recommendation: Recommendation): ApprovedScope {
  assertApproved(recommendation);
  return {
    recommendation_id: recommendation.recommendation_id,
    version: recommendation.version,
    scope_fingerprint: scopeFingerprint(recommendation),
    repair_scope: recommendation.repair_scope,
    parts: clone(recommendation.parts),
    findings: clone(recommendation.findings),
    approval: clone(recommendation.approval!),
  };
}
