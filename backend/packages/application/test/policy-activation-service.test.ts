import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PolicyRevisionSchema } from '../../policy/src/schema.js';
import type { PolicyActivationRecord, PolicyActivationRepository } from '../../ports/src/policy-activation-repository.js';
import type { SafePolicyActivationReader, SafePolicyActivationState } from '../../ports/src/safe-policy-activation-reader.js';
import type { AccountEnrollmentVerifier } from '../../ports/src/account-enrollment-verifier.js';
import type { PolicyActivationFinalizer } from '../../ports/src/policy-activation-finalizer.js';
import { buildSafePolicyActivationPlan } from '../../chain/src/safe-policy-activation-plan.js';
import { PolicyActivationApplicationService } from '../src/policy-activation-service.js';

const organizationId = 'org-activation-test';
const policyId = 'policy-activation-test';
const planId = '00000000-0000-4000-8000-000000000001';
const transactionHash = `0x${'a'.repeat(64)}`;
const safeAddress = '0x1111111111111111111111111111111111111111';
const guardAddress = '0x2222222222222222222222222222222222222222';
const moduleAddress = '0x3333333333333333333333333333333333333333';

const revision = PolicyRevisionSchema.parse({
  schemaVersion: 1,
  policyId,
  revision: 1,
  organizationId,
  owner: '0x4444444444444444444444444444444444444444',
  account: safeAddress,
  agentId: 'agent-activation-test',
  agentAddress: '0x5555555555555555555555555555555555555555',
  agentKeyVersion: 1,
  chainId: 10143,
  adapter: 'evm-smart-account',
  target: '0x6666666666666666666666666666666666666666',
  selectors: ['0xa9059cbb'],
  asset: '0x6666666666666666666666666666666666666666',
  recipients: ['0x7777777777777777777777777777777777777777'],
  limits: { perAction: '100', cumulative: '1000', windowSeconds: 3600 },
  validAfter: 1,
  expiresAt: 4102444800,
  nonceEpoch: 0,
});

const chainState: SafePolicyActivationState = {
  safeAddress,
  guardAddress,
  moduleAddress,
  chainId: 10143,
  timestampSeconds: 2,
  safeNonce: 0n,
  safeOwners: ['0x8888888888888888888888888888888888888888'],
  safeThreshold: 1n,
  policyEpoch: 0n,
  policyEnabled: false,
  policyRevisionHash: `0x${'0'.repeat(64)}`,
  agentKeyVersion: 1n,
  agentActive: true,
  safeModuleEnabled: true,
  safeTransactionGuardInstalled: true,
  safeModuleGuardInstalled: true,
  guardModuleConfigured: true,
};

const plan = buildSafePolicyActivationPlan(revision, chainState);
const source: PolicyActivationRecord['source'] = {
  policyId,
  currentRevision: revision.revision,
  state: 'DRAFT',
  revisionHash: plan.revisionHash,
  revision,
  agentStatus: 'ACTIVE',
  agentKeyVersion: revision.agentKeyVersion,
  accountId: 'account-activation-test',
  accountStatus: 'PROVISIONING',
  accountAddress: safeAddress,
  guardAddress,
  moduleAddress,
  verifiedAt: null,
};
const activationRecord: PolicyActivationRecord = {
  planId,
  planState: 'AWAITING_SAFE_OWNER_SIGNATURES',
  source,
  plan,
};

interface Harness {
  readonly events: string[];
  readonly service: PolicyActivationApplicationService;
  readonly recordSubmission: ReturnType<typeof vi.fn<PolicyActivationRepository['recordActivationSubmission']>>;
  readonly readProvisioningState: ReturnType<typeof vi.fn<SafePolicyActivationReader['readProvisioningState']>>;
  readonly markReconciliation: ReturnType<typeof vi.fn<PolicyActivationRepository['markActivationReconciliationRequired']>>;
}

function makeHarness(options: {
  readonly priorTransactionHash?: string | null;
  readonly persistFailure?: boolean;
  readonly readerFailure?: boolean;
} = {}): Harness {
  const events: string[] = [];
  const recordSubmission = vi.fn<PolicyActivationRepository['recordActivationSubmission']>(async (input) => {
    events.push('persist');
    if (options.persistFailure === true) throw new Error('database unavailable');
    return {
      planId: input.planId,
      operationIndex: input.operationIndex,
      safeTxHash: input.safeTxHash,
      transactionHash: input.transactionHash,
      state: 'SUBMITTED',
    };
  });
  const markReconciliation = vi.fn<PolicyActivationRepository['markActivationReconciliationRequired']>(async () => {
    events.push('reconciliation');
  });
  const repository: PolicyActivationRepository = {
    getHumanRole: async () => 'OWNER',
    getActivationSource: async () => source,
    saveActivationPlan: async () => ({ kind: 'CREATED', planId, plan }),
    recordActivationSubmission: recordSubmission,
    markActivationReconciliationRequired: markReconciliation,
    recordActivationReceipt: async () => undefined,
    getActivationRecord: async () => activationRecord,
    getActivationOperationSubmission: async () => options.priorTransactionHash === undefined
      ? null
      : { operationIndex: 0, safeTxHash: plan.calls[0]?.safeTxHash ?? '', transactionHash: options.priorTransactionHash, state: 'SUBMITTED' },
    finalizeActivation: async () => { throw new Error('unused'); },
  };
  const readProvisioningState = vi.fn<SafePolicyActivationReader['readProvisioningState']>(async () => {
    events.push('chain-read');
    if (options.readerFailure === true) throw new Error('RPC unavailable');
    return chainState;
  });
  const reader: SafePolicyActivationReader = {
    readState: async () => chainState,
    readProvisioningState,
  };
  const enrollmentVerifier: AccountEnrollmentVerifier = {
    verify: async () => { throw new Error('unused'); },
  };
  const finalizer: PolicyActivationFinalizer = {
    verifySubmittedOperation: async () => { events.push('transaction-check'); },
    verifyOperationReceipt: async () => { throw new Error('unused'); },
    verifyFinalizedActivation: async () => { throw new Error('unused'); },
  };
  return {
    events,
    service: new PolicyActivationApplicationService(repository, enrollmentVerifier, reader, finalizer, { 10143: 2 }),
    recordSubmission,
    readProvisioningState,
    markReconciliation,
  };
}

describe('PolicyActivationApplicationService.recordSubmission journaling order', () => {
  beforeEach(() => vi.clearAllMocks());

  it('durably records the hash before the next chain read', async () => {
    const harness = makeHarness();
    const call = plan.calls[0];
    if (call === undefined) throw new Error('test plan contains no operation');

    const result = await harness.service.recordSubmission(
      { type: 'HUMAN', subject: 'owner-subject' }, organizationId, policyId, planId,
      'submit-attempt-1', 0, call.safeTxHash, transactionHash,
    );

    expect(result.transactionHash).toBe(transactionHash);
    expect(result.state).toBe('SUBMITTED');
    expect(harness.events).toEqual(['persist', 'chain-read', 'transaction-check']);
    expect(harness.recordSubmission).toHaveBeenCalledWith(expect.objectContaining({ organizationId, planId, transactionHash }));
  });

  it('preserves the submitted hash and marks reconciliation when a later RPC read fails', async () => {
    const harness = makeHarness({ readerFailure: true });
    const call = plan.calls[0];
    if (call === undefined) throw new Error('test plan contains no operation');

    await expect(harness.service.recordSubmission(
      { type: 'HUMAN', subject: 'owner-subject' }, organizationId, policyId, planId,
      'submit-attempt-2', 0, call.safeTxHash, transactionHash,
    )).rejects.toThrow('transaction hash was preserved');

    expect(harness.events).toEqual(['persist', 'chain-read', 'reconciliation']);
    expect(harness.recordSubmission).toHaveBeenCalledTimes(1);
    expect(harness.markReconciliation).toHaveBeenCalledWith(expect.objectContaining({ organizationId, planId }));
  });

  it('does not call the chain reader or report success when hash persistence fails', async () => {
    const harness = makeHarness({ persistFailure: true });
    const call = plan.calls[0];
    if (call === undefined) throw new Error('test plan contains no operation');

    await expect(harness.service.recordSubmission(
      { type: 'HUMAN', subject: 'owner-subject' }, organizationId, policyId, planId,
      'submit-attempt-3', 0, call.safeTxHash, transactionHash,
    )).rejects.toThrow('database unavailable');

    expect(harness.events).toEqual(['persist']);
    expect(harness.readProvisioningState).not.toHaveBeenCalled();
    expect(harness.markReconciliation).not.toHaveBeenCalled();
  });

  it('rejects replay of a known hash against a different planned Safe operation before persistence or chain reads', async () => {
    const harness = makeHarness({ priorTransactionHash: transactionHash });
    const differentSafeTxHash = `0x${'f'.repeat(64)}`;

    await expect(harness.service.recordSubmission(
      { type: 'HUMAN', subject: 'owner-subject' }, organizationId, policyId, planId,
      'replayed-operation', 0, differentSafeTxHash, transactionHash,
    )).rejects.toThrow('Submission does not identify a planned Safe operation');

    expect(harness.recordSubmission).not.toHaveBeenCalled();
    expect(harness.readProvisioningState).not.toHaveBeenCalled();
    expect(harness.events).toEqual([]);
  });

  it('does not re-record or re-read chain state when retrying the exact already-journaled hash', async () => {
    const harness = makeHarness({ priorTransactionHash: transactionHash });
    const call = plan.calls[0];
    if (call === undefined) throw new Error('test plan contains no operation');

    const result = await harness.service.recordSubmission(
      { type: 'HUMAN', subject: 'owner-subject' }, organizationId, policyId, planId,
      'submit-attempt-4', 0, call.safeTxHash, transactionHash,
    );

    expect(result.transactionHash).toBe(transactionHash);
    expect(harness.recordSubmission).toHaveBeenCalledTimes(1);
    expect(harness.readProvisioningState).not.toHaveBeenCalled();
  });

  it('rejects a different hash for an operation whose earlier submission is already journaled', async () => {
    const harness = makeHarness({ priorTransactionHash: transactionHash });
    const call = plan.calls[0];
    if (call === undefined) throw new Error('test plan contains no operation');

    await expect(harness.service.recordSubmission(
      { type: 'HUMAN', subject: 'owner-subject' }, organizationId, policyId, planId,
      'submit-attempt-different', 0, call.safeTxHash, `0x${'b'.repeat(64)}`,
    )).rejects.toThrow('A different transaction hash is already recorded');
    expect(harness.recordSubmission).not.toHaveBeenCalled();
    expect(harness.readProvisioningState).not.toHaveBeenCalled();
  });
});

describe('PolicyActivationApplicationService.prepare address invariants', () => {
  it.each([
    ['zero Guard', `0x${'0'.repeat(40)}`, moduleAddress, 'Provisioning Guard and Module addresses'],
    ['zero Module', guardAddress, `0x${'0'.repeat(40)}`, 'Provisioning Guard and Module addresses'],
    ['same Guard and Module', guardAddress, guardAddress, 'Provisioning Guard and Module addresses'],
    ['malformed Guard', 'not-an-address', moduleAddress, 'Provisioning activation requires deployed Guard and Module addresses'],
    ['malformed Module', guardAddress, 'not-an-address', 'Provisioning activation requires deployed Guard and Module addresses'],
  ])('rejects %s before chain reads or plan persistence', async (_label, invalidGuard, invalidModule, expectedError) => {
    const harness = makeHarness();
    await expect(harness.service.prepare(
      { type: 'HUMAN', subject: 'owner-subject' }, organizationId, policyId, 'prepare-invalid-address',
      { guardAddress: invalidGuard, moduleAddress: invalidModule },
    )).rejects.toThrow(expectedError);
    expect(harness.readProvisioningState).not.toHaveBeenCalled();
    expect(harness.events).toEqual([]);
  });
});
