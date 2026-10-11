import type { Principal } from '../../domain/src/principal.js';
import type { AccountEnrollmentVerifier } from '../../ports/src/account-enrollment-verifier.js';
import type { FinalizePolicyActivationOutcome, PolicyActivationRepository, RecordPolicyActivationSubmissionResult, SavedPolicyActivationPlan } from '../../ports/src/policy-activation-repository.js';
import type { SafePolicyActivationReader } from '../../ports/src/safe-policy-activation-reader.js';
import type { SafePolicyActivationState } from '../../ports/src/safe-policy-activation-reader.js';
import type { FinalizedSafeTransaction, PolicyActivationFinalizer } from '../../ports/src/policy-activation-finalizer.js';
import { PolicyActivationFinalizationError } from '../../ports/src/policy-activation-finalizer.js';
import { buildSafePolicyActivationPlan } from '../../chain/src/safe-policy-activation-plan.js';
import { ApplicationAccessError } from './agent-service.js';
import { RepositoryAccessError } from '../../ports/src/repository-errors.js';

export class PolicyActivationConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PolicyActivationConflictError';
  }
}

export class PolicyActivationApplicationService {
  public constructor(
    private readonly repository: PolicyActivationRepository,
    private readonly enrollmentVerifier: AccountEnrollmentVerifier,
    private readonly chainReader: SafePolicyActivationReader,
    private readonly finalizer: PolicyActivationFinalizer,
    private readonly confirmationsByChain: Readonly<Record<number, number>>,
  ) {}

  public async recordSubmission(
    principal: Principal,
    organizationId: string,
    policyId: string,
    planId: string,
    idempotencyKey: string,
    operationIndex: number,
    safeTxHash: string,
    transactionHash: string,
  ): Promise<RecordPolicyActivationSubmissionResult> {
    if (principal.type !== 'HUMAN') throw new ApplicationAccessError(403, 'FORBIDDEN');
    try {
      const role = await this.repository.getHumanRole(organizationId, principal.subject);
      if (role === null) throw new ApplicationAccessError(404, 'RESOURCE_NOT_FOUND');
      if (role !== 'OWNER') throw new ApplicationAccessError(403, 'FORBIDDEN');
      const record = await this.repository.getActivationRecord(organizationId, policyId, planId);
      if (record === null) throw new ApplicationAccessError(404, 'RESOURCE_NOT_FOUND');
      const call = record.plan.calls[operationIndex];
      if (call === undefined || call.safeTxHash.toLowerCase() !== safeTxHash.toLowerCase()) {
        throw new PolicyActivationConflictError('Submission does not identify a planned Safe operation');
      }
      const savedSubmission = await this.repository.getActivationOperationSubmission(organizationId, policyId, planId, operationIndex);
      if (savedSubmission !== null && savedSubmission.transactionHash !== null) {
        if (savedSubmission.transactionHash.toLowerCase() !== transactionHash.toLowerCase()) {
          throw new PolicyActivationConflictError('A different transaction hash is already recorded for this Safe operation');
        }
        return await this.repository.recordActivationSubmission({
          organizationId, principalId: principal.subject, policyId, planId, idempotencyKey, operationIndex, safeTxHash, transactionHash,
        });
      }
      const { source, plan } = record;
      if (source.guardAddress === null || source.moduleAddress === null) throw new PolicyActivationConflictError('Activation plan deployment bindings are incomplete');
      // This endpoint is called after the external Safe-owner flow has submitted
      // the transaction. Persist its known hash before any chain/RPC read so an
      // RPC outage cannot leave an already-broadcast operation looking PREPARED.
      const submission = await this.repository.recordActivationSubmission({
        organizationId, principalId: principal.subject, policyId, planId, idempotencyKey, operationIndex, safeTxHash, transactionHash,
      });
      try {
        const chainState = source.accountStatus === 'PROVISIONING'
          ? await this.chainReader.readProvisioningState({
            chainId: plan.chainId, safeAddress: plan.safeAddress, guardAddress: plan.guardAddress,
            moduleAddress: plan.moduleAddress, agentAddress: plan.agentAddress,
          })
          : await this.chainReader.readState({
            chainId: plan.chainId, safeAddress: plan.safeAddress, guardAddress: plan.guardAddress,
            moduleAddress: plan.moduleAddress, agentAddress: plan.agentAddress,
          });
        const expectedNonce = BigInt(call.nonce);
        if (chainState.safeNonce < expectedNonce || chainState.safeNonce > expectedNonce + 1n) {
          throw new PolicyActivationConflictError('Safe nonce does not reconcile with the planned operation');
        }
        await this.finalizer.verifySubmittedOperation({ plan, operationIndex, transactionHash });
      } catch (verificationError: unknown) {
        await this.repository.markActivationReconciliationRequired({
          organizationId, principalId: principal.subject, policyId, planId, reasonCode: 'CHAIN_VERIFICATION_FAILED',
        });
        if (verificationError instanceof PolicyActivationConflictError) {
          throw new PolicyActivationConflictError(`${verificationError.message}; transaction hash was preserved and the plan requires reconciliation`);
        }
        throw new PolicyActivationConflictError('Submitted transaction did not match the persisted Safe operation; transaction hash was preserved and the plan requires reconciliation');
      }
      return submission;
    } catch (error: unknown) {
      if (error instanceof RepositoryAccessError) throw new ApplicationAccessError(error.statusCode, error.statusCode === 403 ? 'FORBIDDEN' : 'RESOURCE_NOT_FOUND');
      throw error;
    }
  }

  public async recordReceipt(
    principal: Principal,
    organizationId: string,
    policyId: string,
    planId: string,
    idempotencyKey: string,
    operationIndex: number,
    transactionHash: string,
  ): Promise<void> {
    if (principal.type !== 'HUMAN') throw new ApplicationAccessError(403, 'FORBIDDEN');
    try {
      const role = await this.repository.getHumanRole(organizationId, principal.subject);
      if (role === null) throw new ApplicationAccessError(404, 'RESOURCE_NOT_FOUND');
      if (role !== 'OWNER') throw new ApplicationAccessError(403, 'FORBIDDEN');
      const record = await this.repository.getActivationRecord(organizationId, policyId, planId);
      if (record === null) throw new ApplicationAccessError(404, 'RESOURCE_NOT_FOUND');
      const call = record.plan.calls[operationIndex];
      if (call === undefined || !/^0x[0-9a-f]{64}$/i.test(transactionHash)) throw new PolicyActivationConflictError('Receipt does not identify a planned activation operation');
      const submission = await this.repository.getActivationOperationSubmission(organizationId, policyId, planId, operationIndex);
      if (submission === null || submission.transactionHash?.toLowerCase() !== transactionHash.toLowerCase()) {
        throw new PolicyActivationConflictError('Receipt transaction hash does not match the durably submitted operation');
      }
      const confirmations = this.confirmationsByChain[record.plan.chainId];
      if (confirmations === undefined) throw new PolicyActivationFinalizationError('UNSUPPORTED_CHAIN');
      let receipt: FinalizedSafeTransaction;
      try {
        receipt = await this.finalizer.verifyOperationReceipt({
          plan: record.plan, operationIndex, transactionHash, minimumConfirmations: confirmations,
        });
      } catch (error: unknown) {
        if (error instanceof PolicyActivationFinalizationError
          && !['NOT_FINALIZED', 'RECEIPT_NOT_FOUND', 'RPC_UNAVAILABLE', 'UNSUPPORTED_CHAIN'].includes(error.code)) {
          await this.repository.markActivationReconciliationRequired({
            organizationId, principalId: principal.subject, policyId, planId, reasonCode: 'CHAIN_VERIFICATION_FAILED',
          });
        }
        throw error;
      }
      return await this.repository.recordActivationReceipt({
        organizationId, principalId: principal.subject, policyId, planId, idempotencyKey, operationIndex, receipt,
      });
    } catch (error: unknown) {
      if (error instanceof RepositoryAccessError) throw new ApplicationAccessError(error.statusCode, error.statusCode === 403 ? 'FORBIDDEN' : 'RESOURCE_NOT_FOUND');
      throw error;
    }
  }

  public async prepare(
    principal: Principal,
    organizationId: string,
    policyId: string,
    idempotencyKey: string,
    provisioningContracts?: { readonly guardAddress: string; readonly moduleAddress: string },
  ): Promise<SavedPolicyActivationPlan> {
    if (principal.type !== 'HUMAN') throw new ApplicationAccessError(403, 'FORBIDDEN');
    try {
      const role = await this.repository.getHumanRole(organizationId, principal.subject);
      if (role === null) throw new ApplicationAccessError(404, 'RESOURCE_NOT_FOUND');
      if (role !== 'OWNER') throw new ApplicationAccessError(403, 'FORBIDDEN');
      const source = await this.repository.getActivationSource(organizationId, policyId);
      if (source === null) throw new ApplicationAccessError(404, 'RESOURCE_NOT_FOUND');
      if (source.revision.organizationId !== organizationId) throw new ApplicationAccessError(404, 'RESOURCE_NOT_FOUND');
      if (source.state !== 'DRAFT') throw new PolicyActivationConflictError('Only a draft policy can be prepared for activation');
      if (source.agentStatus !== 'ACTIVE' || source.agentKeyVersion !== source.revision.agentKeyVersion) {
        throw new PolicyActivationConflictError('The registered policy agent must remain active at the exact key version');
      }
      let guardAddress: string;
      let moduleAddress: string;
      let state: SafePolicyActivationState;
      if (source.accountStatus === 'PROVISIONING') {
        if (provisioningContracts === undefined
          || !/^0x[0-9a-fA-F]{40}$/.test(provisioningContracts.guardAddress)
          || !/^0x[0-9a-fA-F]{40}$/.test(provisioningContracts.moduleAddress)) {
          throw new PolicyActivationConflictError('Provisioning activation requires deployed Guard and Module addresses');
        }
        guardAddress = provisioningContracts.guardAddress.toLowerCase();
        moduleAddress = provisioningContracts.moduleAddress.toLowerCase();
        const zeroAddress = `0x${'0'.repeat(40)}`;
        if (guardAddress === zeroAddress || moduleAddress === zeroAddress || guardAddress === moduleAddress) {
          throw new PolicyActivationConflictError('Provisioning Guard and Module addresses must be distinct, non-zero EVM addresses');
        }
        if ((source.guardAddress !== null && source.guardAddress !== guardAddress)
          || (source.moduleAddress !== null && source.moduleAddress !== moduleAddress)) {
          throw new PolicyActivationConflictError('Provisioning contract addresses differ from the persisted account bindings');
        }
        state = await this.chainReader.readProvisioningState({
          chainId: source.revision.chainId, safeAddress: source.accountAddress, guardAddress, moduleAddress,
          agentAddress: source.revision.agentAddress,
        });
        if (state.policyEnabled || state.policyEpoch !== 0n) {
          throw new PolicyActivationConflictError('Provisioning Safe already has policy state; reconcile it before preparing a new activation plan');
        }
      } else {
        if (source.accountStatus !== 'ACTIVE' || source.guardAddress === null || source.moduleAddress === null || source.verifiedAt === null) {
          throw new PolicyActivationConflictError('Verified active Safe enrollment is required before activation planning');
        }
        guardAddress = source.guardAddress;
        moduleAddress = source.moduleAddress;
        const proof = await this.enrollmentVerifier.verify({ chainId: source.revision.chainId, address: source.accountAddress });
        if (proof.safeAddress.toLowerCase() !== source.accountAddress
          || proof.guardAddress.toLowerCase() !== source.guardAddress
          || proof.moduleAddress.toLowerCase() !== source.moduleAddress) {
          throw new PolicyActivationConflictError('Current on-chain enrollment does not match the registered Safe');
        }
        state = await this.chainReader.readState({
          chainId: source.revision.chainId, safeAddress: source.accountAddress, guardAddress,
          moduleAddress, agentAddress: source.revision.agentAddress,
        });
      }
      if (state.safeAddress.toLowerCase() !== source.accountAddress || state.guardAddress.toLowerCase() !== guardAddress
        || state.moduleAddress.toLowerCase() !== moduleAddress || state.chainId !== source.revision.chainId) {
        throw new PolicyActivationConflictError('Current Safe state does not match the verified account and deployment bindings');
      }
      const plan = buildSafePolicyActivationPlan(source.revision, state);
      return await this.repository.saveActivationPlan({
        organizationId, principalId: principal.subject, idempotencyKey, policyId,
        revisionHash: source.revisionHash, plan,
      });
    } catch (error: unknown) {
      if (error instanceof RepositoryAccessError) throw new ApplicationAccessError(error.statusCode, error.statusCode === 403 ? 'FORBIDDEN' : 'RESOURCE_NOT_FOUND');
      throw error;
    }
  }

  public async finalize(
    principal: Principal,
    organizationId: string,
    policyId: string,
    planId: string,
    idempotencyKey: string,
    transactionHashes: readonly string[],
  ): Promise<FinalizePolicyActivationOutcome> {
    if (principal.type !== 'HUMAN') throw new ApplicationAccessError(403, 'FORBIDDEN');
    try {
      const role = await this.repository.getHumanRole(organizationId, principal.subject);
      if (role === null) throw new ApplicationAccessError(404, 'RESOURCE_NOT_FOUND');
      if (role !== 'OWNER') throw new ApplicationAccessError(403, 'FORBIDDEN');
      const record = await this.repository.getActivationRecord(organizationId, policyId, planId);
      if (record === null) throw new ApplicationAccessError(404, 'RESOURCE_NOT_FOUND');
      if (record.planState === 'FAILED' || record.planState === 'SUPERSEDED') {
        throw new PolicyActivationConflictError('Activation plan is no longer finalizable');
      }
      const { source, plan } = record;
      try {
        const confirmations = this.confirmationsByChain[source.revision.chainId];
        if (confirmations === undefined) throw new PolicyActivationFinalizationError('UNSUPPORTED_CHAIN');
        const finalized = await this.finalizer.verifyFinalizedActivation({
          planId, plan, transactionHashes, minimumConfirmations: confirmations,
        });
        if (finalized.planId !== planId || finalized.revisionHash.toLowerCase() !== plan.revisionHash.toLowerCase()
          || finalized.policyEpoch !== plan.resultingPolicyEpoch) {
          throw new PolicyActivationConflictError('Finalized chain evidence does not match the stored activation plan');
        }
        const proof = await this.enrollmentVerifier.verify({ chainId: source.revision.chainId, address: source.accountAddress });
        if (proof.safeAddress.toLowerCase() !== source.accountAddress || proof.guardAddress.toLowerCase() !== source.guardAddress
          || proof.moduleAddress.toLowerCase() !== source.moduleAddress) {
          throw new PolicyActivationConflictError('Current on-chain enrollment does not match the stored activation plan');
        }
        return await this.repository.finalizeActivation({
          organizationId, principalId: principal.subject, idempotencyKey, policyId, planId, finalized, enrollmentProof: proof,
        });
      } catch (verificationError: unknown) {
        if (record.planState === 'SUBMITTED' || record.planState === 'RECONCILIATION_REQUIRED') {
          await this.repository.markActivationReconciliationRequired({
            organizationId, principalId: principal.subject, policyId, planId, reasonCode: 'CHAIN_VERIFICATION_FAILED',
          });
        }
        throw verificationError;
      }
    } catch (error: unknown) {
      if (error instanceof RepositoryAccessError) throw new ApplicationAccessError(error.statusCode, error.statusCode === 403 ? 'FORBIDDEN' : 'RESOURCE_NOT_FOUND');
      throw error;
    }
  }
}
