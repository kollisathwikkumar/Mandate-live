import { createHash, randomUUID } from 'node:crypto';
import { TypedDataEncoder } from 'ethers';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import { PolicyRevisionSchema } from '../../../policy/src/schema.js';
import { hashPolicyRevision } from '../../../policy/src/canonical.js';
import type {
  FinalizePolicyActivationInput,
  FinalizePolicyActivationOutcome,
  PolicyActivationRecord,
  PolicyActivationRepository,
  PolicyActivationSource,
  RecordPolicyActivationSubmissionInput,
  RecordPolicyActivationSubmissionResult,
  MarkPolicyActivationReconciliationInput,
  RecordPolicyActivationReceiptInput,
  PolicyActivationOperationSubmission,
  SavePolicyActivationPlanInput,
  SavedPolicyActivationPlan,
} from '../../../ports/src/policy-activation-repository.js';
import { safePolicyActivationRequestFingerprint, type SafePolicyActivationPlan } from '../../../chain/src/safe-policy-activation-plan.js';
import type { FinalizedPolicyActivation, FinalizedSafeTransaction } from '../../../ports/src/policy-activation-finalizer.js';
import { RepositoryAccessError } from '../../../ports/src/repository-errors.js';
import { PolicyConflictError } from './policy-store.js';

interface ActivationSourceRow {
  readonly policy_id: string;
  readonly current_revision: number;
  readonly policy_state: 'DRAFT' | 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  readonly revision_hash: string;
  readonly canonical_json: unknown;
  readonly agent_status: 'ACTIVE' | 'REVOKED';
  readonly agent_key_version: number;
  readonly account_id: string;
  readonly account_status: 'PROVISIONING' | 'PAUSED' | 'ACTIVE' | 'UNSUPPORTED';
  readonly account_address: string;
  readonly chain_id: string;
  readonly guard_address: string | null;
  readonly module_address: string | null;
  readonly verified_at: Date | null;
}

interface IdempotencyRow { readonly request_hash: string; readonly response_json: unknown; }
interface ExistingPlanRow { readonly id: string; readonly plan_json: unknown; }
interface ActivationRecordRow extends ActivationSourceRow {
  readonly plan_id: string;
  readonly plan_state: PolicyActivationRecord['planState'];
  readonly plan_json: unknown;
}

function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function normalizeAddress(value: string | null): string | null { return value?.trim().toLowerCase() ?? null; }
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

const ActivationReceiptSchema = z.object({
  safeTxHash: z.string(), transactionHash: z.string(), blockNumber: z.string(), blockHash: z.string(),
  transactionIndex: z.number().int(), confirmations: z.number().int(), status: z.literal('FINAL'),
}).strict();

function sameActivationReceipt(value: unknown, expected: FinalizedSafeTransaction): boolean {
  const parsed = ActivationReceiptSchema.safeParse(value);
  if (!parsed.success) return false;
  const saved = parsed.data;
  return saved.safeTxHash.toLowerCase() === expected.safeTxHash.toLowerCase()
    && saved.transactionHash.toLowerCase() === expected.transactionHash.toLowerCase()
    && saved.blockNumber === expected.blockNumber && saved.blockHash.toLowerCase() === expected.blockHash.toLowerCase()
    && saved.transactionIndex === expected.transactionIndex && saved.confirmations === expected.confirmations
    && saved.status === expected.status;
}

function sourceFromRow(row: ActivationSourceRow): PolicyActivationSource {
  const revision = PolicyRevisionSchema.parse(row.canonical_json);
  const revisionHash = row.revision_hash.trim().toLowerCase();
  if (hashPolicyRevision(revision) !== revisionHash || revision.chainId !== Number(row.chain_id)) {
    throw new PolicyConflictError('Stored canonical policy hash does not match its immutable revision record');
  }
  return {
    policyId: row.policy_id,
    currentRevision: row.current_revision,
    state: row.policy_state,
    revisionHash,
    revision,
    agentStatus: row.agent_status,
    agentKeyVersion: row.agent_key_version,
    accountId: row.account_id,
    accountStatus: row.account_status,
    accountAddress: row.account_address.trim().toLowerCase(),
    guardAddress: normalizeAddress(row.guard_address),
    moduleAddress: normalizeAddress(row.module_address),
    verifiedAt: row.verified_at?.toISOString() ?? null,
  };
}

function planFromUnknown(value: unknown): SafePolicyActivationPlan {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Persisted activation plan is malformed');
  return value as SafePolicyActivationPlan;
}

function assertPlanMatchesSource(source: PolicyActivationSource, plan: SafePolicyActivationPlan): void {
  const purposes = plan.calls.map(({ purpose }) => purpose);
  const order = ['BIND_MODULE', 'REGISTER_AGENT', 'ENABLE_MODULE', 'INSTALL_GUARD', 'INSTALL_MODULE_GUARD', 'CONFIGURE_POLICY'] as const;
  let previousOrder = -1;
  if (plan.chainId !== source.revision.chainId || plan.safeAddress !== source.accountAddress
    || plan.guardAddress !== source.guardAddress || plan.moduleAddress !== source.moduleAddress
    || plan.agentAddress !== source.revision.agentAddress || plan.agentKeyVersion !== source.revision.agentKeyVersion
    || plan.revisionHash.toLowerCase() !== source.revisionHash
    || plan.expectedPolicyEpoch !== String(source.revision.nonceEpoch)
    || plan.resultingPolicyEpoch !== String(source.revision.nonceEpoch + 1)
    || plan.compiledConfiguration.revisionHash.toLowerCase() !== source.revisionHash
    || plan.compiledConfiguration.nextEpoch !== plan.resultingPolicyEpoch
    || purposes.at(-1) !== 'CONFIGURE_POLICY' || purposes.filter((purpose) => purpose === 'CONFIGURE_POLICY').length !== 1
    || plan.calls.length < 1 || plan.calls.length > 6
    || plan.calls.some(({ purpose, safeTxHash, requestFingerprint, nonce, data, to, signingPayload }, index) => {
      const purposeOrder = order.indexOf(purpose);
      const expectedTarget = purpose === 'REGISTER_AGENT' ? plan.moduleAddress
        : purpose === 'ENABLE_MODULE' || purpose === 'INSTALL_GUARD' || purpose === 'INSTALL_MODULE_GUARD'
          ? plan.safeAddress : purpose === 'BIND_MODULE' || purpose === 'CONFIGURE_POLICY' ? plan.guardAddress : '';
      const message = signingPayload.message;
      const signingHash = TypedDataEncoder.hash(signingPayload.domain, signingPayload.types, message);
      const valid = purposeOrder >= 0 && purposeOrder > previousOrder && (previousOrder = purposeOrder) >= 0
        && to.toLowerCase() === expectedTarget && signingPayload.domain.chainId === plan.chainId
        && signingPayload.domain.verifyingContract.toLowerCase() === plan.safeAddress
        && message.to.toLowerCase() === to.toLowerCase() && message.data.toLowerCase() === data.toLowerCase()
        && message.value === '0' && message.operation === 0 && message.nonce === nonce
        && signingHash.toLowerCase() === safeTxHash.toLowerCase()
        && /^0x[0-9a-f]{64}$/i.test(safeTxHash) && /^0x[0-9a-f]{64}$/i.test(requestFingerprint)
        && requestFingerprint.toLowerCase() === safePolicyActivationRequestFingerprint({
          chainId: plan.chainId, safeAddress: plan.safeAddress, to, value: message.value,
          data, operation: message.operation, nonce, safeTxHash,
        }).toLowerCase()
        && /^\d+$/.test(nonce) && (index === 0 || BigInt(nonce) === BigInt(plan.calls[index - 1]?.nonce ?? '-1') + 1n)
        && /^0x[0-9a-fA-F]+$/.test(data);
      return !valid;
    })) {
    throw new PolicyConflictError('Persisted activation plan no longer matches the canonical policy/account');
  }
}

function validateFinalizedEvidence(plan: SafePolicyActivationPlan, finalized: FinalizedPolicyActivation, planId: string, revisionHash: string): void {
  if (finalized.planId !== planId || finalized.revisionHash.toLowerCase() !== revisionHash.toLowerCase()
    || finalized.policyEpoch !== plan.resultingPolicyEpoch || finalized.receipts.length !== plan.calls.length
    || !/^\d+$/.test(finalized.finalizedBlockNumber)) throw new PolicyConflictError('Finalized activation evidence does not match the stored plan');
  const seenTransactionHashes = new Set<string>();
  let previousBlock = -1;
  let previousIndex = -1;
  for (let index = 0; index < plan.calls.length; index += 1) {
    const expected = plan.calls[index];
    const receipt = finalized.receipts[index];
    if (expected === undefined || receipt === undefined || receipt.status !== 'FINAL'
      || receipt.safeTxHash.toLowerCase() !== expected.safeTxHash.toLowerCase()
      || !/^0x[0-9a-f]{64}$/.test(receipt.transactionHash) || !/^0x[0-9a-f]{64}$/.test(receipt.blockHash)
      || !/^\d+$/.test(receipt.blockNumber) || !Number.isSafeInteger(Number(receipt.blockNumber))
      || Number(receipt.blockNumber) > Number(finalized.finalizedBlockNumber)
      || !Number.isSafeInteger(receipt.transactionIndex) || receipt.transactionIndex < 0
      || !Number.isSafeInteger(receipt.confirmations) || receipt.confirmations < 1) {
      throw new PolicyConflictError('Activation receipt evidence is incomplete or out of order');
    }
    if (seenTransactionHashes.has(receipt.transactionHash) || Number(receipt.blockNumber) < previousBlock
      || (Number(receipt.blockNumber) === previousBlock && receipt.transactionIndex <= previousIndex)) {
      throw new PolicyConflictError('Activation receipt evidence is duplicated or out of order');
    }
    seenTransactionHashes.add(receipt.transactionHash);
    previousBlock = Number(receipt.blockNumber);
    previousIndex = receipt.transactionIndex;
  }
}

async function authorizeOwner(client: PoolClient, organizationId: string, principalId: string): Promise<void> {
  const result = await client.query<{ role: string }>(
    'SELECT role FROM members WHERE organization_id = $1 AND subject = $2 FOR UPDATE', [organizationId, principalId],
  );
  const role = result.rows[0]?.role;
  if (role === undefined) throw new RepositoryAccessError(404);
  if (role !== 'OWNER') throw new RepositoryAccessError(403);
}

async function writeActivationAudit(client: PoolClient, input: SavePolicyActivationPlanInput, planId: string): Promise<void> {
  await client.query('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', [input.organizationId]);
  const lastEvent = await client.query<{ event_hash: string }>(
    'SELECT event_hash FROM audit_events WHERE organization_id = $1 ORDER BY sequence DESC LIMIT 1', [input.organizationId],
  );
  const previousHash = lastEvent.rows[0]?.event_hash.trim() ?? null;
  const payload = { policyId: input.policyId, revisionHash: input.revisionHash, activationPlanId: planId, state: 'AWAITING_SAFE_OWNER_SIGNATURES' };
  const payloadText = JSON.stringify(payload);
  const eventHash = `0x${sha256(`${previousHash ?? ''}|${input.organizationId}|${input.principalId}|POLICY_ACTIVATION_PLAN_CREATED|${payloadText}`)}`;
  await client.query(
    `INSERT INTO audit_events (organization_id, actor_type, actor_id, event_type, subject_type, subject_id, correlation_id, payload, previous_hash, event_hash)
     VALUES ($1, 'HUMAN', $2, 'POLICY_ACTIVATION_PLAN_CREATED', 'POLICY', $3, $4, $5::jsonb, $6, $7)`,
    [input.organizationId, input.principalId, input.policyId, input.idempotencyKey, payloadText, previousHash, eventHash],
  );
  await client.query(
    `INSERT INTO outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, 'POLICY', $2, 'POLICY_ACTIVATION_PLAN_CREATED', $3::jsonb)`,
    [input.organizationId, input.policyId, payloadText],
  );
}

export class PolicyActivationStore implements PolicyActivationRepository {
  public constructor(private readonly pool: Pool) {}

  public async getHumanRole(organizationId: string, subject: string): Promise<string | null> {
    const result = await this.pool.query<{ role: string }>(
      'SELECT role FROM members WHERE organization_id = $1 AND subject = $2', [organizationId, subject],
    );
    return result.rows[0]?.role ?? null;
  }

  public async getActivationSource(organizationId: string, policyId: string): Promise<PolicyActivationSource | null> {
    const result = await this.pool.query<ActivationSourceRow>(
      `SELECT p.id AS policy_id, p.current_revision, p.state AS policy_state, r.revision_hash, r.canonical_json,
              ag.status AS agent_status, ag.key_version AS agent_key_version,
              a.id AS account_id, a.status AS account_status, btrim(a.address) AS account_address, a.chain_id::text,
              a.guard_address, a.module_address, a.verified_at
       FROM policies p
       JOIN policy_revisions r ON r.organization_id = p.organization_id AND r.policy_id = p.id AND r.revision = p.current_revision
       JOIN agents ag ON ag.organization_id = r.organization_id AND ag.id = r.canonical_json->>'agentId'
       JOIN accounts a ON a.organization_id = p.organization_id AND a.id = p.account_id
       WHERE p.organization_id = $1 AND p.id = $2`,
      [organizationId, policyId],
    );
    const row = result.rows[0];
    return row === undefined ? null : sourceFromRow(row);
  }

  public async getActivationRecord(organizationId: string, policyId: string, planId: string): Promise<PolicyActivationRecord | null> {
    const result = await this.pool.query<ActivationRecordRow>(
      `SELECT p.id AS policy_id, p.current_revision, p.state AS policy_state, r.revision_hash, r.canonical_json,
              ag.status AS agent_status, ag.key_version AS agent_key_version,
              a.id AS account_id, a.status AS account_status, btrim(a.address) AS account_address, a.chain_id::text,
              a.guard_address, a.module_address, a.verified_at, ap.id::text AS plan_id, ap.state AS plan_state, ap.plan_json
       FROM policy_activation_plans ap
       JOIN policies p ON p.organization_id = ap.organization_id AND p.id = ap.policy_id
       JOIN policy_revisions r ON r.organization_id = ap.organization_id AND r.policy_id = ap.policy_id AND r.revision = ap.policy_revision
       JOIN agents ag ON ag.organization_id = r.organization_id AND ag.id = r.canonical_json->>'agentId'
       JOIN accounts a ON a.organization_id = p.organization_id AND a.id = p.account_id
       WHERE ap.organization_id = $1 AND ap.policy_id = $2 AND ap.id = $3`,
      [organizationId, policyId, planId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const source = sourceFromRow(row);
    const plan = planFromUnknown(row.plan_json);
    assertPlanMatchesSource(source, plan);
    return { planId: row.plan_id, planState: row.plan_state, source, plan };
  }

  public async getActivationOperationSubmission(
    organizationId: string, policyId: string, planId: string, operationIndex: number,
  ): Promise<PolicyActivationOperationSubmission | null> {
    const result = await this.pool.query<PolicyActivationOperationSubmission>(
      `SELECT operation.operation_index AS "operationIndex", operation.safe_tx_hash AS "safeTxHash",
              operation.transaction_hash AS "transactionHash", operation.state
       FROM policy_activation_operations operation
       JOIN policy_activation_plans plan ON plan.id = operation.plan_id
       WHERE plan.organization_id = $1 AND plan.policy_id = $2 AND plan.id = $3 AND operation.operation_index = $4`,
      [organizationId, policyId, planId, operationIndex],
    );
    return result.rows[0] ?? null;
  }

  public async saveActivationPlan(input: SavePolicyActivationPlanInput): Promise<SavedPolicyActivationPlan> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await authorizeOwner(client, input.organizationId, input.principalId);
      const scope = 'policy.activate.plan';
      const lockKey = `${input.organizationId}|${input.principalId}|${scope}|${input.idempotencyKey}`;
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
      await client.query(
        `DELETE FROM command_idempotency WHERE organization_id = $1 AND principal_id = $2 AND scope = $3 AND idempotency_key = $4 AND expires_at <= now()`,
        [input.organizationId, input.principalId, scope, input.idempotencyKey],
      );
      const requestHash = `0x${sha256(`${input.policyId}|${input.revisionHash}|${input.plan.calls.map(({ requestFingerprint }) => requestFingerprint).join(',')}`)}`;
      const previousIdempotency = await client.query<IdempotencyRow>(
        `SELECT request_hash, response_json FROM command_idempotency
         WHERE organization_id = $1 AND principal_id = $2 AND scope = $3 AND idempotency_key = $4 AND expires_at > now()`,
        [input.organizationId, input.principalId, scope, input.idempotencyKey],
      );
      const idempotency = previousIdempotency.rows[0];
      if (idempotency !== undefined) {
        if (idempotency.request_hash.trim() !== requestHash) throw new PolicyConflictError('Idempotency key was already used for a different activation plan', 'IDEMPOTENCY_CONFLICT');
        const saved = idempotency.response_json as { readonly planId?: unknown; readonly plan?: unknown };
        if (typeof saved.planId !== 'string') throw new Error('Persisted idempotency response is malformed');
        const replay = { kind: 'REPLAY' as const, planId: saved.planId, plan: planFromUnknown(saved.plan) };
        await client.query('COMMIT');
        return replay;
      }

      const selected = await client.query<ActivationSourceRow>(
        `SELECT p.id AS policy_id, p.current_revision, p.state AS policy_state, r.revision_hash, r.canonical_json,
                ag.status AS agent_status, ag.key_version AS agent_key_version,
                a.id AS account_id, a.status AS account_status, btrim(a.address) AS account_address, a.chain_id::text,
                a.guard_address, a.module_address, a.verified_at
         FROM policies p JOIN policy_revisions r ON r.organization_id = p.organization_id AND r.policy_id = p.id AND r.revision = p.current_revision
         JOIN agents ag ON ag.organization_id = r.organization_id AND ag.id = r.canonical_json->>'agentId'
         JOIN accounts a ON a.organization_id = p.organization_id AND a.id = p.account_id
         WHERE p.organization_id = $1 AND p.id = $2 FOR UPDATE OF p, a`,
        [input.organizationId, input.policyId],
      );
      const row = selected.rows[0];
      if (row === undefined) throw new RepositoryAccessError(404);
      const source = sourceFromRow(row);
      if (source.state !== 'DRAFT' || source.revisionHash !== input.revisionHash || source.currentRevision !== source.revision.revision) {
        throw new PolicyConflictError('Policy revision changed or is not a draft');
      }
      if (source.agentStatus !== 'ACTIVE' || source.agentKeyVersion !== source.revision.agentKeyVersion) {
        throw new PolicyConflictError('The policy agent must remain active at the exact registered key version');
      }
      if (source.accountStatus === 'ACTIVE' && (source.guardAddress === null || source.moduleAddress === null || source.verifiedAt === null)) {
        throw new PolicyConflictError('Active account is missing verified Safe enrollment metadata');
      }
      if (source.accountStatus !== 'ACTIVE' && source.accountStatus !== 'PROVISIONING') {
        throw new PolicyConflictError('Paused or unsupported accounts cannot prepare an activation plan');
      }
      if (input.plan.revisionHash !== source.revisionHash || input.plan.safeAddress !== source.accountAddress
        || (source.guardAddress !== null && input.plan.guardAddress !== source.guardAddress)
        || (source.moduleAddress !== null && input.plan.moduleAddress !== source.moduleAddress)
        || (source.accountStatus === 'ACTIVE' && (input.plan.guardAddress !== source.guardAddress || input.plan.moduleAddress !== source.moduleAddress))) {
        throw new PolicyConflictError('Activation plan does not match the current stored policy and account');
      }
      if (source.accountStatus === 'PROVISIONING') {
        const bindings = await client.query(
          `UPDATE accounts SET guard_address = $1, module_address = $2
           WHERE organization_id = $3 AND id = $4 AND status = 'PROVISIONING'
             AND (guard_address IS NULL OR lower(btrim(guard_address)) = $1)
             AND (module_address IS NULL OR lower(btrim(module_address)) = $2)`,
          [input.plan.guardAddress, input.plan.moduleAddress, input.organizationId, source.accountId],
        );
        if (bindings.rowCount !== 1) throw new PolicyConflictError('Provisioning deployment bindings changed before activation plan persistence');
      }
      const existing = await client.query<ExistingPlanRow>(
        `SELECT id, plan_json FROM policy_activation_plans
         WHERE organization_id = $1 AND policy_id = $2 AND policy_revision = $3`,
        [input.organizationId, input.policyId, source.currentRevision],
      );
      if (existing.rows[0] !== undefined) throw new PolicyConflictError('This policy revision already has an activation plan');

      const planId = randomUUID();
      const planJson = JSON.stringify(input.plan);
      await client.query(
        `INSERT INTO policy_activation_plans (id, organization_id, policy_id, policy_revision, revision_hash, created_by, state, plan_json)
         VALUES ($1, $2, $3, $4, $5, $6, 'AWAITING_SAFE_OWNER_SIGNATURES', $7::jsonb)`,
        [planId, input.organizationId, input.policyId, source.currentRevision, input.revisionHash, input.principalId, planJson],
      );
      for (const [operationIndex, call] of input.plan.calls.entries()) {
        await client.query(
          `INSERT INTO policy_activation_operations
           (plan_id, operation_index, chain_id, safe_tx_hash, request_fingerprint, state)
           VALUES ($1, $2, $3, $4, $5, 'PREPARED')`,
          [planId, operationIndex, input.plan.chainId, call.safeTxHash, call.requestFingerprint],
        );
      }
      await client.query(
        `INSERT INTO policy_grants (organization_id, policy_id, policy_revision, account_id, adapter, grant_reference, state)
         VALUES ($1, $2, $3, $4, 'evm-smart-account', $5, 'PENDING')`,
        [input.organizationId, input.policyId, source.currentRevision, source.accountId, planId],
      );
      const response = { planId, plan: input.plan };
      await client.query(
        `INSERT INTO command_idempotency (organization_id, principal_id, scope, idempotency_key, request_hash, response_json)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [input.organizationId, input.principalId, scope, input.idempotencyKey, requestHash, JSON.stringify(response)],
      );
      await writeActivationAudit(client, input, planId);
      await client.query('COMMIT');
      return { kind: 'CREATED', ...response };
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) throw new PolicyConflictError('Activation plan identifier, idempotency key, or receipt hash already exists');
      throw error;
    } finally {
      client.release();
    }
  }

  public async recordActivationSubmission(input: RecordPolicyActivationSubmissionInput): Promise<RecordPolicyActivationSubmissionResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await authorizeOwner(client, input.organizationId, input.principalId);
      const scope = 'policy.activate.submit';
      const lockKey = `${input.organizationId}|${input.principalId}|${scope}|${input.idempotencyKey}`;
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
      const requestHash = `0x${sha256(`${input.planId}|${input.operationIndex}|${input.safeTxHash.toLowerCase()}|${input.transactionHash.toLowerCase()}`)}`;
      const previousIdempotency = await client.query<IdempotencyRow>(
        `SELECT request_hash, response_json FROM command_idempotency
         WHERE organization_id = $1 AND principal_id = $2 AND scope = $3 AND idempotency_key = $4 AND expires_at > now()`,
        [input.organizationId, input.principalId, scope, input.idempotencyKey],
      );
      const prior = previousIdempotency.rows[0];
      if (prior !== undefined) {
        if (prior.request_hash.trim() !== requestHash) throw new PolicyConflictError('Idempotency key was used for a different activation submission', 'IDEMPOTENCY_CONFLICT');
        const replay = prior.response_json as RecordPolicyActivationSubmissionResult;
        await client.query('COMMIT');
        return replay;
      }
      const selected = await client.query<{ plan_json: unknown; state: PolicyActivationRecord['planState'] }>(
        `SELECT plan_json, state FROM policy_activation_plans
         WHERE organization_id = $1 AND policy_id = $2 AND id = $3 FOR UPDATE`,
        [input.organizationId, input.policyId, input.planId],
      );
      const planRow = selected.rows[0];
      if (planRow === undefined) throw new RepositoryAccessError(404);
      if (!['AWAITING_SAFE_OWNER_SIGNATURES', 'SUBMITTED'].includes(planRow.state)) {
        throw new PolicyConflictError('Activation plan is not accepting transaction submissions');
      }
      const plan = planFromUnknown(planRow.plan_json);
      const call = plan.calls[input.operationIndex];
      if (!Number.isSafeInteger(input.operationIndex) || input.operationIndex < 0 || call === undefined
        || call.safeTxHash.toLowerCase() !== input.safeTxHash.toLowerCase()
        || !/^0x[0-9a-f]{64}$/i.test(input.transactionHash)) {
        throw new PolicyConflictError('Submitted transaction does not match a persisted Safe operation');
      }
      if (input.operationIndex > 0) {
        const previous = await client.query<{ state: string; transaction_hash: string | null }>(
          `SELECT state, transaction_hash FROM policy_activation_operations
           WHERE plan_id = $1 AND operation_index = $2 FOR UPDATE`, [input.planId, input.operationIndex - 1],
        );
        const prior = previous.rows[0];
        if (prior === undefined || prior.transaction_hash === null || prior.state !== 'FINAL') {
          throw new PolicyConflictError('Safe operations must be submitted in persisted nonce order');
        }
      }
      const existing = await client.query<{ transaction_hash: string | null; safe_tx_hash: string; state: string }>(
        `SELECT transaction_hash, safe_tx_hash, state FROM policy_activation_operations
         WHERE plan_id = $1 AND operation_index = $2 FOR UPDATE`,
        [input.planId, input.operationIndex],
      );
      const operation = existing.rows[0];
      if (operation === undefined || operation.safe_tx_hash.trim().toLowerCase() !== call.safeTxHash.toLowerCase()) {
        throw new PolicyConflictError('Persisted activation operation journal is incomplete');
      }
      if (operation.transaction_hash !== null) {
        if (operation.transaction_hash.trim().toLowerCase() !== input.transactionHash.toLowerCase()) {
          throw new PolicyConflictError('A different transaction hash is already recorded for this Safe operation');
        }
        const replay = { planId: input.planId, operationIndex: input.operationIndex, safeTxHash: call.safeTxHash, transactionHash: input.transactionHash.toLowerCase(), state: 'SUBMITTED' as const };
        await client.query(
          `INSERT INTO command_idempotency (organization_id, principal_id, scope, idempotency_key, request_hash, response_json)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [input.organizationId, input.principalId, scope, input.idempotencyKey, requestHash, JSON.stringify(replay)],
        );
        await client.query('COMMIT');
        return replay;
      }
      await client.query(
        `UPDATE policy_activation_operations SET state = 'SUBMITTED', transaction_hash = $1, updated_at = now()
         WHERE plan_id = $2 AND operation_index = $3 AND state = 'PREPARED'`,
        [input.transactionHash.toLowerCase(), input.planId, input.operationIndex],
      );
      await client.query(
        `UPDATE policy_activation_plans SET state = 'SUBMITTED', updated_at = now()
         WHERE id = $1 AND organization_id = $2 AND policy_id = $3`,
        [input.planId, input.organizationId, input.policyId],
      );
      const payload = { policyId: input.policyId, planId: input.planId, operationIndex: input.operationIndex, safeTxHash: call.safeTxHash, transactionHash: input.transactionHash.toLowerCase() };
      const payloadText = JSON.stringify(payload);
      await client.query('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', [input.organizationId]);
      const lastAuditEvent = await client.query<{ event_hash: string }>(
        'SELECT event_hash FROM audit_events WHERE organization_id = $1 ORDER BY sequence DESC LIMIT 1', [input.organizationId],
      );
      const previousHash = lastAuditEvent.rows[0]?.event_hash.trim() ?? null;
      const eventHash = `0x${sha256(`${previousHash ?? ''}|${input.organizationId}|${input.principalId}|POLICY_ACTIVATION_OPERATION_SUBMITTED|${payloadText}`)}`;
      await client.query(
        `INSERT INTO audit_events (organization_id, actor_type, actor_id, event_type, subject_type, subject_id, correlation_id, payload, previous_hash, event_hash)
         VALUES ($1, 'HUMAN', $2, 'POLICY_ACTIVATION_OPERATION_SUBMITTED', 'POLICY', $3, $4, $5::jsonb, $6, $7)`,
        [input.organizationId, input.principalId, input.policyId, `${input.planId}:${input.operationIndex}`, payloadText, previousHash, eventHash],
      );
      await client.query(
        `INSERT INTO outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'POLICY', $2, 'POLICY_ACTIVATION_OPERATION_SUBMITTED', $3::jsonb)`,
        [input.organizationId, input.policyId, payloadText],
      );
      const response = { planId: input.planId, operationIndex: input.operationIndex, safeTxHash: call.safeTxHash, transactionHash: input.transactionHash.toLowerCase(), state: 'SUBMITTED' as const };
      await client.query(
        `INSERT INTO command_idempotency (organization_id, principal_id, scope, idempotency_key, request_hash, response_json)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [input.organizationId, input.principalId, scope, input.idempotencyKey, requestHash, JSON.stringify(response)],
      );
      await client.query('COMMIT');
      return response;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) throw new PolicyConflictError('Transaction hash is already recorded for another activation operation');
      throw error;
    } finally {
      client.release();
    }
  }

  public async markActivationReconciliationRequired(input: MarkPolicyActivationReconciliationInput): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await authorizeOwner(client, input.organizationId, input.principalId);
      const plan = await client.query<{ state: PolicyActivationRecord['planState'] }>(
        `SELECT state FROM policy_activation_plans
         WHERE organization_id = $1 AND policy_id = $2 AND id = $3 FOR UPDATE`,
        [input.organizationId, input.policyId, input.planId],
      );
      const planState = plan.rows[0]?.state;
      if (planState === undefined) throw new RepositoryAccessError(404);
      if (planState === 'CONFIRMED' || planState === 'FAILED' || planState === 'SUPERSEDED') {
        throw new PolicyConflictError('Terminal activation plan cannot enter reconciliation');
      }
      const submitted = await client.query<{ operation_index: number; state: string }>(
        `SELECT operation_index, state FROM policy_activation_operations
         WHERE plan_id = $1 AND state IN ('SUBMITTED', 'FINAL', 'RECONCILIATION_REQUIRED') FOR UPDATE`, [input.planId],
      );
      if (submitted.rowCount === 0) throw new PolicyConflictError('Reconciliation requires a durably submitted activation operation');
      if (planState === 'RECONCILIATION_REQUIRED' && submitted.rows.every(({ state }) => state !== 'SUBMITTED')) {
        await client.query('COMMIT');
        return;
      }
      await client.query(
        `UPDATE policy_activation_operations SET state = 'RECONCILIATION_REQUIRED', updated_at = now()
         WHERE plan_id = $1 AND state = 'SUBMITTED'`, [input.planId],
      );
      await client.query(
        `UPDATE policy_activation_plans SET state = 'RECONCILIATION_REQUIRED', updated_at = now()
         WHERE organization_id = $1 AND policy_id = $2 AND id = $3`,
        [input.organizationId, input.policyId, input.planId],
      );
      const payloadText = JSON.stringify({
        policyId: input.policyId, planId: input.planId, reasonCode: input.reasonCode,
        operationIndexes: submitted.rows.map(({ operation_index }) => operation_index),
      });
      await client.query('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', [input.organizationId]);
      const lastEvent = await client.query<{ event_hash: string }>(
        'SELECT event_hash FROM audit_events WHERE organization_id = $1 ORDER BY sequence DESC LIMIT 1', [input.organizationId],
      );
      const previousHash = lastEvent.rows[0]?.event_hash.trim() ?? null;
      const eventHash = `0x${sha256(`${previousHash ?? ''}|${input.organizationId}|${input.principalId}|POLICY_ACTIVATION_RECONCILIATION_REQUIRED|${payloadText}`)}`;
      await client.query(
        `INSERT INTO audit_events (organization_id, actor_type, actor_id, event_type, subject_type, subject_id, correlation_id, payload, previous_hash, event_hash)
         VALUES ($1, 'HUMAN', $2, 'POLICY_ACTIVATION_RECONCILIATION_REQUIRED', 'POLICY', $3, $4, $5::jsonb, $6, $7)`,
        [input.organizationId, input.principalId, input.policyId, input.planId, payloadText, previousHash, eventHash],
      );
      await client.query(
        `INSERT INTO outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'POLICY', $2, 'POLICY_ACTIVATION_RECONCILIATION_REQUIRED', $3::jsonb)`,
        [input.organizationId, input.policyId, payloadText],
      );
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async recordActivationReceipt(input: RecordPolicyActivationReceiptInput): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await authorizeOwner(client, input.organizationId, input.principalId);
      const scope = 'policy.activate.receipt';
      const lockKey = `${input.organizationId}|${input.principalId}|${scope}|${input.idempotencyKey}`;
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
      const receipt = input.receipt;
      const requestHash = `0x${sha256(`${input.planId}|${input.operationIndex}|${receipt.safeTxHash.toLowerCase()}|${receipt.transactionHash.toLowerCase()}|${receipt.blockHash.toLowerCase()}|${receipt.blockNumber}`)}`;
      const previous = await client.query<IdempotencyRow>(
        `SELECT request_hash, response_json FROM command_idempotency
         WHERE organization_id = $1 AND principal_id = $2 AND scope = $3 AND idempotency_key = $4 AND expires_at > now()`,
        [input.organizationId, input.principalId, scope, input.idempotencyKey],
      );
      if (previous.rows[0] !== undefined) {
        if (previous.rows[0].request_hash.trim() !== requestHash) throw new PolicyConflictError('Idempotency key was used for a different activation receipt', 'IDEMPOTENCY_CONFLICT');
        await client.query('COMMIT');
        return;
      }
      const planResult = await client.query<{ state: PolicyActivationRecord['planState']; plan_json: unknown }>(
        `SELECT state, plan_json FROM policy_activation_plans
         WHERE organization_id = $1 AND policy_id = $2 AND id = $3 FOR UPDATE`,
        [input.organizationId, input.policyId, input.planId],
      );
      const planRow = planResult.rows[0];
      if (planRow === undefined) throw new RepositoryAccessError(404);
      if (!['SUBMITTED', 'RECONCILIATION_REQUIRED'].includes(planRow.state)) throw new PolicyConflictError('Activation plan is not accepting receipts');
      const plan = planFromUnknown(planRow.plan_json);
      const call = plan.calls[input.operationIndex];
      if (call === undefined || call.safeTxHash.toLowerCase() !== receipt.safeTxHash.toLowerCase()
        || receipt.status !== 'FINAL' || !/^0x[0-9a-f]{64}$/i.test(receipt.transactionHash)
        || !/^0x[0-9a-f]{64}$/i.test(receipt.blockHash) || !/^\d+$/.test(receipt.blockNumber)
        || !Number.isSafeInteger(receipt.transactionIndex) || receipt.transactionIndex < 0
        || !Number.isSafeInteger(receipt.confirmations) || receipt.confirmations < 1) {
        throw new PolicyConflictError('Verified activation receipt does not match its persisted operation');
      }
      const operationResult = await client.query<{ state: string; transaction_hash: string | null; receipt_json: unknown }>(
        `SELECT state, transaction_hash, receipt_json FROM policy_activation_operations
         WHERE plan_id = $1 AND operation_index = $2 FOR UPDATE`, [input.planId, input.operationIndex],
      );
      const operation = operationResult.rows[0];
      if (operation === undefined || operation.transaction_hash?.trim().toLowerCase() !== receipt.transactionHash.toLowerCase()) {
        throw new PolicyConflictError('Activation receipt transaction hash does not match the recorded submission');
      }
      if (operation.state === 'FINAL') {
        if (!sameActivationReceipt(operation.receipt_json, receipt)) throw new PolicyConflictError('Activation receipt is immutable once recorded');
      } else {
        if (!['SUBMITTED', 'RECONCILIATION_REQUIRED'].includes(operation.state)) throw new PolicyConflictError('Operation is not awaiting a verified receipt');
        await client.query(
          `UPDATE policy_activation_operations SET state = 'FINAL', receipt_json = $1::jsonb, updated_at = now()
           WHERE plan_id = $2 AND operation_index = $3`,
          [JSON.stringify(receipt), input.planId, input.operationIndex],
        );
      }
      const payloadText = JSON.stringify({ policyId: input.policyId, planId: input.planId, operationIndex: input.operationIndex, receipt });
      await client.query('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', [input.organizationId]);
      const lastEvent = await client.query<{ event_hash: string }>(
        'SELECT event_hash FROM audit_events WHERE organization_id = $1 ORDER BY sequence DESC LIMIT 1', [input.organizationId],
      );
      const previousHash = lastEvent.rows[0]?.event_hash.trim() ?? null;
      const eventHash = `0x${sha256(`${previousHash ?? ''}|${input.organizationId}|${input.principalId}|POLICY_ACTIVATION_OPERATION_RECEIPT_FINAL|${payloadText}`)}`;
      await client.query(
        `INSERT INTO audit_events (organization_id, actor_type, actor_id, event_type, subject_type, subject_id, correlation_id, payload, previous_hash, event_hash)
         VALUES ($1, 'HUMAN', $2, 'POLICY_ACTIVATION_OPERATION_RECEIPT_FINAL', 'POLICY', $3, $4, $5::jsonb, $6, $7)`,
        [input.organizationId, input.principalId, input.policyId, `${input.planId}:${input.operationIndex}`, payloadText, previousHash, eventHash],
      );
      await client.query(
        `INSERT INTO outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'POLICY', $2, 'POLICY_ACTIVATION_OPERATION_RECEIPT_FINAL', $3::jsonb)`,
        [input.organizationId, input.policyId, payloadText],
      );
      await client.query(
        `INSERT INTO command_idempotency (organization_id, principal_id, scope, idempotency_key, request_hash, response_json)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [input.organizationId, input.principalId, scope, input.idempotencyKey, requestHash, JSON.stringify({ planId: input.planId, operationIndex: input.operationIndex, receipt })],
      );
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) throw new PolicyConflictError('Activation receipt is already recorded for another operation');
      throw error;
    } finally {
      client.release();
    }
  }

  public async finalizeActivation(input: FinalizePolicyActivationInput): Promise<FinalizePolicyActivationOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await authorizeOwner(client, input.organizationId, input.principalId);
      const scope = 'policy.activate.finalize';
      const lockKey = `${input.organizationId}|${input.principalId}|${scope}|${input.idempotencyKey}`;
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
      await client.query(
        `DELETE FROM command_idempotency WHERE organization_id = $1 AND principal_id = $2 AND scope = $3 AND idempotency_key = $4 AND expires_at <= now()`,
        [input.organizationId, input.principalId, scope, input.idempotencyKey],
      );
      const previous = await client.query<IdempotencyRow>(
        `SELECT request_hash, response_json FROM command_idempotency
         WHERE organization_id = $1 AND principal_id = $2 AND scope = $3 AND idempotency_key = $4 AND expires_at > now()`,
        [input.organizationId, input.principalId, scope, input.idempotencyKey],
      );
      const requestHash = `0x${sha256(`${input.policyId}|${input.planId}|${JSON.stringify(input.finalized.receipts.map(({ transactionHash }) => transactionHash.toLowerCase()))}`)}`;
      const prior = previous.rows[0];
      if (prior !== undefined) {
        if (prior.request_hash.trim() !== requestHash) throw new PolicyConflictError('Idempotency key was already used for different activation receipts', 'IDEMPOTENCY_CONFLICT');
        const result = prior.response_json as FinalizePolicyActivationOutcome['result'];
        await client.query('COMMIT');
        return { kind: 'REPLAY', result };
      }

      const selected = await client.query<ActivationRecordRow>(
        `SELECT p.id AS policy_id, p.current_revision, p.state AS policy_state, r.revision_hash, r.canonical_json,
                ag.status AS agent_status, ag.key_version AS agent_key_version,
                a.id AS account_id, a.status AS account_status, btrim(a.address) AS account_address, a.chain_id::text,
                a.guard_address, a.module_address, a.verified_at, ap.id::text AS plan_id, ap.state AS plan_state, ap.plan_json
         FROM policy_activation_plans ap
         JOIN policies p ON p.organization_id = ap.organization_id AND p.id = ap.policy_id
         JOIN policy_revisions r ON r.organization_id = ap.organization_id AND r.policy_id = ap.policy_id AND r.revision = ap.policy_revision
         JOIN agents ag ON ag.organization_id = r.organization_id AND ag.id = r.canonical_json->>'agentId'
         JOIN accounts a ON a.organization_id = p.organization_id AND a.id = p.account_id
         WHERE ap.organization_id = $1 AND ap.policy_id = $2 AND ap.id = $3
         FOR UPDATE OF ap, p, a`,
        [input.organizationId, input.policyId, input.planId],
      );
      const row = selected.rows[0];
      if (row === undefined) throw new RepositoryAccessError(404);
      const source = sourceFromRow(row);
      const plan = planFromUnknown(row.plan_json);
      assertPlanMatchesSource(source, plan);
      const proof = input.enrollmentProof;
      if (proof.safeAddress.toLowerCase() !== plan.safeAddress || proof.guardAddress.toLowerCase() !== plan.guardAddress
        || proof.moduleAddress.toLowerCase() !== plan.moduleAddress || !/^\d+$/.test(proof.verifiedBlockNumber)
        || !/^0x[0-9a-f]{64}$/i.test(proof.verifiedBlockHash)) {
        throw new PolicyConflictError('Pinned enrollment proof does not match the persisted Safe activation plan');
      }
      if (!['AWAITING_SAFE_OWNER_SIGNATURES', 'SUBMITTED', 'RECONCILIATION_REQUIRED'].includes(row.plan_state) || source.state !== 'DRAFT'
        || source.agentStatus !== 'ACTIVE' || source.agentKeyVersion !== source.revision.agentKeyVersion
        || source.currentRevision !== source.revision.revision || source.revisionHash !== plan.revisionHash.toLowerCase()) {
        throw new PolicyConflictError('Activation plan or policy is no longer pending');
      }
      validateFinalizedEvidence(plan, input.finalized, input.planId, source.revisionHash);
      const submissions = await client.query<{ operation_index: number; transaction_hash: string | null; safe_tx_hash: string; state: string }>(
        `SELECT operation_index, transaction_hash, safe_tx_hash, state FROM policy_activation_operations
         WHERE plan_id = $1 ORDER BY operation_index FOR UPDATE`, [input.planId],
      );
      if (submissions.rows.length !== plan.calls.length || submissions.rows.some((operation, index) => {
        const expectedCall = plan.calls[index];
        const finalizedReceipt = input.finalized.receipts[index];
        return expectedCall === undefined || finalizedReceipt === undefined || operation.operation_index !== index
          || operation.state !== 'FINAL' || operation.safe_tx_hash.trim().toLowerCase() !== expectedCall.safeTxHash.toLowerCase()
          || operation.transaction_hash?.trim().toLowerCase() !== finalizedReceipt.transactionHash.toLowerCase();
      })) throw new PolicyConflictError('Finalization requires the exact durably recorded transaction hash for every Safe operation');
      const activatedAccount = await client.query(
        `UPDATE accounts SET status = 'ACTIVE', guard_address = $1, module_address = $2, verified_at = now()
         WHERE organization_id = $3 AND id = $4 AND status = 'PROVISIONING'
           AND (guard_address IS NULL OR lower(btrim(guard_address)) = $1)
           AND (module_address IS NULL OR lower(btrim(module_address)) = $2)`,
        [plan.guardAddress, plan.moduleAddress, input.organizationId, source.accountId],
      );
      if (source.accountStatus === 'PROVISIONING' && activatedAccount.rowCount !== 1) {
        throw new PolicyConflictError('Provisioning account changed before atomic activation finalization');
      }
      if (source.accountStatus !== 'PROVISIONING' && source.accountStatus !== 'ACTIVE') {
        throw new PolicyConflictError('Paused or unsupported account cannot be activated by a policy plan');
      }
      const grants = await client.query<{ id: string }>(
        `UPDATE policy_grants SET state = 'ACTIVE', granted_at = now()
         WHERE organization_id = $1 AND policy_id = $2 AND policy_revision = $3 AND account_id = $4
           AND grant_reference = $5 AND state = 'PENDING' RETURNING id::text`,
        [input.organizationId, input.policyId, source.currentRevision, source.accountId, input.planId],
      );
      if (grants.rowCount !== 1) throw new PolicyConflictError('Pending policy grant was not found for this activation plan');
      const activatedPolicy = await client.query(
        `UPDATE policies SET state = 'ACTIVE', updated_at = now()
         WHERE organization_id = $1 AND id = $2 AND current_revision = $3 AND state = 'DRAFT'`,
        [input.organizationId, input.policyId, source.currentRevision],
      );
      if (activatedPolicy.rowCount !== 1) throw new PolicyConflictError('Policy revision changed while activation was being finalized');
      const confirmedPlan = await client.query(
        `UPDATE policy_activation_plans SET state = 'CONFIRMED', finalized_block_number = $1,
          finalized_receipts = $2::jsonb, confirmed_at = now(), updated_at = now()
         WHERE id = $3 AND organization_id = $4 AND state IN ('AWAITING_SAFE_OWNER_SIGNATURES', 'SUBMITTED', 'RECONCILIATION_REQUIRED')`,
        [input.finalized.finalizedBlockNumber, JSON.stringify({ ...input.finalized, enrollmentProof: proof }), input.planId, input.organizationId],
      );
      if (confirmedPlan.rowCount !== 1) throw new PolicyConflictError('Activation plan changed while finalization was being recorded');
      const receipts = input.finalized.receipts;
      for (const receipt of receipts) {
        await client.query(
          `INSERT INTO policy_activation_receipts
           (plan_id, chain_id, safe_tx_hash, transaction_hash, block_number, block_hash, transaction_index, confirmations, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'FINAL')`,
          [input.planId, source.revision.chainId, receipt.safeTxHash, receipt.transactionHash, receipt.blockNumber, receipt.blockHash, receipt.transactionIndex, receipt.confirmations],
        );
      }
      for (const [operationIndex, receipt] of receipts.entries()) {
        await client.query(
          `UPDATE policy_activation_operations SET state = 'FINAL', receipt_json = $1::jsonb, updated_at = now()
           WHERE plan_id = $2 AND operation_index = $3 AND state IN ('SUBMITTED', 'RECONCILIATION_REQUIRED') AND transaction_hash = $4`,
          [JSON.stringify(receipt), input.planId, operationIndex, receipt.transactionHash],
        );
      }
      const result = {
        planId: input.planId, policyId: input.policyId, policyRevision: source.currentRevision,
        revisionHash: source.revisionHash, policyState: 'ACTIVE' as const, grantState: 'ACTIVE' as const,
        finalized: input.finalized,
      };
      await client.query(
        `INSERT INTO command_idempotency (organization_id, principal_id, scope, idempotency_key, request_hash, response_json)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [input.organizationId, input.principalId, scope, input.idempotencyKey, requestHash, JSON.stringify(result)],
      );
      await client.query('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', [input.organizationId]);
      const lastEvent = await client.query<{ event_hash: string }>(
        'SELECT event_hash FROM audit_events WHERE organization_id = $1 ORDER BY sequence DESC LIMIT 1', [input.organizationId],
      );
      const previousHash = lastEvent.rows[0]?.event_hash.trim() ?? null;
      const payload = { policyId: input.policyId, policyRevision: source.currentRevision, revisionHash: source.revisionHash, activationPlanId: input.planId, finalizedBlockNumber: input.finalized.finalizedBlockNumber, transactionHashes: receipts.map(({ transactionHash }) => transactionHash) };
      const payloadText = JSON.stringify(payload);
      const eventHash = `0x${sha256(`${previousHash ?? ''}|${input.organizationId}|${input.principalId}|POLICY_ACTIVATED|${payloadText}`)}`;
      await client.query(
        `INSERT INTO audit_events (organization_id, actor_type, actor_id, event_type, subject_type, subject_id, correlation_id, payload, previous_hash, event_hash)
         VALUES ($1, 'HUMAN', $2, 'POLICY_ACTIVATED', 'POLICY', $3, $4, $5::jsonb, $6, $7)`,
        [input.organizationId, input.principalId, input.policyId, input.idempotencyKey, payloadText, previousHash, eventHash],
      );
      await client.query(
        `INSERT INTO outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'POLICY', $2, 'POLICY_ACTIVATED', $3::jsonb)`,
        [input.organizationId, input.policyId, payloadText],
      );
      await client.query('COMMIT');
      return { kind: 'FINALIZED', result };
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) throw new PolicyConflictError('Activation transaction receipt hash or idempotency key already exists');
      throw error;
    } finally {
      client.release();
    }
  }
}
