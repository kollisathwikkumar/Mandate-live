import { Interface, TypedDataEncoder, ZeroAddress, keccak256, toUtf8Bytes } from 'ethers';
import { compileEvmSafePolicy } from './evm-safe-policy-compiler.js';
import type { PolicyRevision } from '../../policy/src/schema.js';
import type { SafePolicyActivationState } from '../../ports/src/safe-policy-activation-reader.js';

export const safeTransactionTypes = { SafeTx: [
  { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' },
  { name: 'operation', type: 'uint8' }, { name: 'safeTxGas', type: 'uint256' }, { name: 'baseGas', type: 'uint256' },
  { name: 'gasPrice', type: 'uint256' }, { name: 'gasToken', type: 'address' },
  { name: 'refundReceiver', type: 'address' }, { name: 'nonce', type: 'uint256' },
] };

const moduleInterface = new Interface(['function setAgent(address agent,uint64 keyVersion,bool active)']);
const guardInterface = new Interface([
  'function setAgentModule(address module)',
  'function configurePolicy((bytes32 revisionHash,uint64 nextEpoch,uint64 policyValidUntil,uint32 windowDuration,uint32 actionCountLimit,address[] assets,uint256[] perActionLimits,uint256[] perWindowLimits,uint256[] approvalThresholds,bool[] approvalRequired,address[] recipients) config)',
]);
const safeInterface = new Interface([
  'function enableModule(address module)', 'function setGuard(address guard)', 'function setModuleGuard(address guard)',
]);

export function safePolicyActivationRequestFingerprint(input: {
  readonly chainId: number;
  readonly safeAddress: string;
  readonly to: string;
  readonly value: string;
  readonly data: string;
  readonly operation: number;
  readonly nonce: string;
  readonly safeTxHash: string;
}): string {
  const material = [input.chainId, input.safeAddress.toLowerCase(), input.to.toLowerCase(), input.value,
    input.data.toLowerCase(), input.operation, input.nonce, input.safeTxHash.toLowerCase()].join('|');
  return keccak256(toUtf8Bytes(material));
}

export type SafePolicyActivationErrorCode = 'STALE_POLICY_EPOCH' | 'AGENT_KEY_VERSION_AHEAD' | 'POLICY_NOT_ACTIVE' | 'POLICY_EPOCH_EXHAUSTED';

export class SafePolicyActivationError extends Error {
  public constructor(public readonly code: SafePolicyActivationErrorCode) {
    super(code);
    this.name = 'SafePolicyActivationError';
  }
}

export interface SafeTransactionSigningPayload {
  readonly domain: { readonly chainId: number; readonly verifyingContract: string };
  readonly types: typeof safeTransactionTypes;
  readonly primaryType: 'SafeTx';
  readonly message: {
    readonly to: string;
    readonly value: string;
    readonly data: string;
    readonly operation: number;
    readonly safeTxGas: string;
    readonly baseGas: string;
    readonly gasPrice: string;
    readonly gasToken: string;
    readonly refundReceiver: string;
    readonly nonce: string;
  };
}

export interface SafePolicyActivationCall {
  readonly purpose: 'BIND_MODULE' | 'REGISTER_AGENT' | 'ENABLE_MODULE' | 'INSTALL_GUARD' | 'INSTALL_MODULE_GUARD' | 'CONFIGURE_POLICY';
  readonly to: string;
  readonly data: string;
  readonly nonce: string;
  readonly safeTxHash: string;
  readonly requestFingerprint: string;
  readonly signingPayload: SafeTransactionSigningPayload;
}

export interface SafePolicyActivationPlan {
  readonly chainId: number;
  readonly safeAddress: string;
  readonly guardAddress: string;
  readonly moduleAddress: string;
  readonly agentAddress: string;
  readonly agentKeyVersion: number;
  readonly ownerAddresses: readonly string[];
  readonly ownerThreshold: number;
  readonly revisionHash: string;
  readonly expectedPolicyEpoch: string;
  readonly resultingPolicyEpoch: string;
  readonly compiledConfiguration: {
    readonly revisionHash: string;
    readonly nextEpoch: string;
    readonly policyValidUntil: string;
    readonly windowDuration: number;
    readonly actionCountLimit: number;
    readonly assets: readonly string[];
    readonly perActionLimits: readonly string[];
    readonly perWindowLimits: readonly string[];
    readonly approvalThresholds: readonly string[];
    readonly approvalRequired: readonly boolean[];
    readonly recipients: readonly string[];
  };
  readonly calls: readonly SafePolicyActivationCall[];
  readonly status: 'AWAITING_SAFE_OWNER_SIGNATURES';
}

/** Creates exact owner-signed Safe calls; planning never submits a transaction or activates a DB grant. */
export function buildSafePolicyActivationPlan(revision: PolicyRevision, state: SafePolicyActivationState): SafePolicyActivationPlan {
  if (BigInt(revision.chainId) !== BigInt(state.chainId)
    || revision.account.toLowerCase() !== state.safeAddress.toLowerCase()) {
    throw new RangeError('Policy account does not match the verified Safe');
  }
  if (state.safeOwners.length === 0 || state.safeThreshold < 1n || state.safeThreshold > BigInt(state.safeOwners.length)) {
    throw new RangeError('Safe owner threshold is invalid');
  }
  if (BigInt(revision.nonceEpoch) !== state.policyEpoch) throw new SafePolicyActivationError('STALE_POLICY_EPOCH');
  if (state.agentKeyVersion > BigInt(revision.agentKeyVersion)) throw new SafePolicyActivationError('AGENT_KEY_VERSION_AHEAD');

  const compiled = compileEvmSafePolicy(revision, state.timestampSeconds);
  const calls: Omit<SafePolicyActivationCall, 'nonce' | 'safeTxHash' | 'requestFingerprint' | 'signingPayload'>[] = [];
  if (!(state.guardModuleConfigured ?? true)) calls.push({
    purpose: 'BIND_MODULE', to: state.guardAddress.toLowerCase(),
    data: guardInterface.encodeFunctionData('setAgentModule', [state.moduleAddress]),
  });
  if (!state.agentActive || state.agentKeyVersion !== BigInt(revision.agentKeyVersion)) {
    calls.push({
      purpose: 'REGISTER_AGENT',
      to: state.moduleAddress.toLowerCase(),
      data: moduleInterface.encodeFunctionData('setAgent', [revision.agentAddress, revision.agentKeyVersion, true]),
    });
  }
  if (!(state.safeModuleEnabled ?? true)) calls.push({
    purpose: 'ENABLE_MODULE', to: state.safeAddress.toLowerCase(),
    data: safeInterface.encodeFunctionData('enableModule', [state.moduleAddress]),
  });
  if (!(state.safeTransactionGuardInstalled ?? true)) calls.push({
    purpose: 'INSTALL_GUARD', to: state.safeAddress.toLowerCase(),
    data: safeInterface.encodeFunctionData('setGuard', [state.guardAddress]),
  });
  if (!(state.safeModuleGuardInstalled ?? true)) calls.push({
    purpose: 'INSTALL_MODULE_GUARD', to: state.safeAddress.toLowerCase(),
    data: safeInterface.encodeFunctionData('setModuleGuard', [state.guardAddress]),
  });
  calls.push({
    purpose: 'CONFIGURE_POLICY',
    to: state.guardAddress.toLowerCase(),
    data: compiled.configurePolicyCalldata,
  });

  const signedCalls = calls.map((call, index): SafePolicyActivationCall => {
    const nonce = state.safeNonce + BigInt(index);
    const message = {
      to: call.to,
      value: '0',
      data: call.data,
      operation: 0,
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: ZeroAddress,
      refundReceiver: ZeroAddress,
      nonce: nonce.toString(),
    };
    const domain = { chainId: state.chainId, verifyingContract: state.safeAddress.toLowerCase() };
    const safeTxHash = TypedDataEncoder.hash(domain, safeTransactionTypes, message);
    const signingPayload = { domain, types: safeTransactionTypes, primaryType: 'SafeTx' as const, message };
    const requestFingerprint = safePolicyActivationRequestFingerprint({
      chainId: state.chainId, safeAddress: state.safeAddress, to: call.to, value: message.value,
      data: call.data, operation: message.operation, nonce: message.nonce, safeTxHash,
    });
    return { ...call, nonce: nonce.toString(), safeTxHash, requestFingerprint, signingPayload };
  });

  return {
    chainId: state.chainId,
    safeAddress: state.safeAddress.toLowerCase(),
    guardAddress: state.guardAddress.toLowerCase(),
    moduleAddress: state.moduleAddress.toLowerCase(),
    agentAddress: revision.agentAddress,
    agentKeyVersion: revision.agentKeyVersion,
    ownerAddresses: state.safeOwners.map((owner) => owner.toLowerCase()),
    ownerThreshold: Number(state.safeThreshold),
    revisionHash: compiled.revisionHash,
    expectedPolicyEpoch: state.policyEpoch.toString(),
    resultingPolicyEpoch: compiled.configuration.nextEpoch.toString(),
    compiledConfiguration: {
      revisionHash: compiled.configuration.revisionHash,
      nextEpoch: compiled.configuration.nextEpoch.toString(),
      policyValidUntil: compiled.configuration.policyValidUntil.toString(),
      windowDuration: compiled.configuration.windowDuration,
      actionCountLimit: compiled.configuration.actionCountLimit,
      assets: compiled.configuration.assets,
      perActionLimits: compiled.configuration.perActionLimits.map(String),
      perWindowLimits: compiled.configuration.perWindowLimits.map(String),
      approvalThresholds: compiled.configuration.approvalThresholds.map(String),
      approvalRequired: compiled.configuration.approvalRequired,
      recipients: compiled.configuration.recipients,
    },
    calls: signedCalls,
    status: 'AWAITING_SAFE_OWNER_SIGNATURES',
  };
}
