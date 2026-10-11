import type { PolicyRevision } from '../../policy/src/schema.js';
import type { SafePolicyActivationPlan } from '../../chain/src/safe-policy-activation-plan.js';
import type { FinalizedPolicyActivation, FinalizedSafeTransaction } from './policy-activation-finalizer.js';
import type { AccountEnrollmentProof } from './account-enrollment-verifier.js';

export interface PolicyActivationSource {
  readonly policyId: string;
  readonly currentRevision: number;
  readonly state: 'DRAFT' | 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  readonly revisionHash: string;
  readonly revision: PolicyRevision;
  readonly agentStatus: 'ACTIVE' | 'REVOKED';
  readonly agentKeyVersion: number;
  readonly accountId: string;
  readonly accountStatus: 'PROVISIONING' | 'PAUSED' | 'ACTIVE' | 'UNSUPPORTED';
  readonly accountAddress: string;
  readonly guardAddress: string | null;
  readonly moduleAddress: string | null;
  readonly verifiedAt: string | null;
}

export interface SavePolicyActivationPlanInput {
  readonly organizationId: string;
  readonly principalId: string;
  readonly idempotencyKey: string;
  readonly policyId: string;
  readonly revisionHash: string;
  readonly plan: SafePolicyActivationPlan;
}

export interface PolicyActivationRecord {
  readonly planId: string;
  readonly planState: 'AWAITING_SAFE_OWNER_SIGNATURES' | 'SUBMITTED' | 'RECONCILIATION_REQUIRED' | 'CONFIRMED' | 'FAILED' | 'SUPERSEDED';
  readonly source: PolicyActivationSource;
  readonly plan: SafePolicyActivationPlan;
}

export interface RecordPolicyActivationSubmissionInput {
  readonly organizationId: string;
  readonly principalId: string;
  readonly policyId: string;
  readonly planId: string;
  readonly idempotencyKey: string;
  readonly operationIndex: number;
  readonly safeTxHash: string;
  readonly transactionHash: string;
}

export interface RecordPolicyActivationSubmissionResult {
  readonly planId: string;
  readonly operationIndex: number;
  readonly safeTxHash: string;
  readonly transactionHash: string;
  readonly state: 'SUBMITTED';
}

export interface PolicyActivationOperationSubmission {
  readonly operationIndex: number;
  readonly safeTxHash: string;
  readonly transactionHash: string | null;
  readonly state: 'PREPARED' | 'SUBMITTED' | 'FINAL' | 'RECONCILIATION_REQUIRED' | 'FAILED';
}

export interface MarkPolicyActivationReconciliationInput {
  readonly organizationId: string;
  readonly principalId: string;
  readonly policyId: string;
  readonly planId: string;
  readonly reasonCode: 'CHAIN_VERIFICATION_FAILED';
}

export interface RecordPolicyActivationReceiptInput {
  readonly organizationId: string;
  readonly principalId: string;
  readonly policyId: string;
  readonly planId: string;
  readonly idempotencyKey: string;
  readonly operationIndex: number;
  readonly receipt: FinalizedSafeTransaction;
}

export interface FinalizePolicyActivationInput {
  readonly organizationId: string;
  readonly principalId: string;
  readonly idempotencyKey: string;
  readonly policyId: string;
  readonly planId: string;
  readonly finalized: FinalizedPolicyActivation;
  readonly enrollmentProof: AccountEnrollmentProof;
}

export interface FinalizedPolicyActivationResult {
  readonly planId: string;
  readonly policyId: string;
  readonly policyRevision: number;
  readonly revisionHash: string;
  readonly policyState: 'ACTIVE';
  readonly grantState: 'ACTIVE';
  readonly finalized: FinalizedPolicyActivation;
}

export type FinalizePolicyActivationOutcome =
  | { readonly kind: 'FINALIZED'; readonly result: FinalizedPolicyActivationResult }
  | { readonly kind: 'REPLAY'; readonly result: FinalizedPolicyActivationResult };

export type SavedPolicyActivationPlan =
  | { readonly kind: 'CREATED'; readonly planId: string; readonly plan: SafePolicyActivationPlan }
  | { readonly kind: 'REPLAY'; readonly planId: string; readonly plan: SafePolicyActivationPlan };

export interface PolicyActivationRepository {
  getHumanRole(organizationId: string, subject: string): Promise<string | null>;
  getActivationSource(organizationId: string, policyId: string): Promise<PolicyActivationSource | null>;
  saveActivationPlan(input: SavePolicyActivationPlanInput): Promise<SavedPolicyActivationPlan>;
  recordActivationSubmission(input: RecordPolicyActivationSubmissionInput): Promise<RecordPolicyActivationSubmissionResult>;
  markActivationReconciliationRequired(input: MarkPolicyActivationReconciliationInput): Promise<void>;
  recordActivationReceipt(input: RecordPolicyActivationReceiptInput): Promise<void>;
  getActivationRecord(organizationId: string, policyId: string, planId: string): Promise<PolicyActivationRecord | null>;
  getActivationOperationSubmission(organizationId: string, policyId: string, planId: string, operationIndex: number): Promise<PolicyActivationOperationSubmission | null>;
  finalizeActivation(input: FinalizePolicyActivationInput): Promise<FinalizePolicyActivationOutcome>;
}
