import type { SafePolicyActivationPlan } from '../../chain/src/safe-policy-activation-plan.js';

export type PolicyActivationFinalizationErrorCode =
  | 'UNSUPPORTED_CHAIN'
  | 'RPC_UNAVAILABLE'
  | 'INVALID_CONFIRMATION_CONFIGURATION'
  | 'RECEIPT_NOT_FOUND'
  | 'TRANSACTION_FAILED'
  | 'SAFE_EXECUTION_NOT_FOUND'
  | 'NOT_FINALIZED'
  | 'POLICY_STATE_MISMATCH';

export class PolicyActivationFinalizationError extends Error {
  public constructor(public readonly code: PolicyActivationFinalizationErrorCode) {
    super(code);
    this.name = 'PolicyActivationFinalizationError';
  }
}

export interface FinalizedSafeTransaction {
  readonly safeTxHash: string;
  readonly transactionHash: string;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly transactionIndex: number;
  readonly confirmations: number;
  readonly status: 'FINAL';
}

export interface FinalizedPolicyActivation {
  readonly planId: string;
  readonly revisionHash: string;
  readonly policyEpoch: string;
  readonly finalizedBlockNumber: string;
  readonly receipts: readonly FinalizedSafeTransaction[];
}

export interface PolicyActivationFinalizer {
  verifySubmittedOperation(input: {
    readonly plan: SafePolicyActivationPlan;
    readonly operationIndex: number;
    readonly transactionHash: string;
  }): Promise<void>;
  verifyOperationReceipt(input: {
    readonly plan: SafePolicyActivationPlan;
    readonly operationIndex: number;
    readonly transactionHash: string;
    readonly minimumConfirmations: number;
  }): Promise<FinalizedSafeTransaction>;
  verifyFinalizedActivation(input: {
    readonly planId: string;
    readonly plan: SafePolicyActivationPlan;
    readonly transactionHashes: readonly string[];
    readonly minimumConfirmations: number;
  }): Promise<FinalizedPolicyActivation>;
}
