export interface PolicyDraftAgentReference {
  readonly id: string;
  readonly status: 'ACTIVE' | 'REVOKED';
}

export interface PolicyDraftAccountReference {
  readonly chainId: number;
  readonly address: string;
  readonly adapter: 'evm-smart-account';
  readonly status: 'PROVISIONING' | 'ACTIVE' | 'PAUSED' | 'UNSUPPORTED';
}

export interface PolicyDraftSelection {
  readonly agentId: string;
  readonly chainId: number;
  readonly account: string;
  readonly adapter: 'evm-smart-account';
}

export type PolicyDraftReferenceValidation = 'ready' | 'ready-provisioning' | 'agent-unavailable' | 'account-unavailable';

export function validatePolicyDraftReferences(
  selection: PolicyDraftSelection,
  agents: readonly PolicyDraftAgentReference[],
  accounts: readonly PolicyDraftAccountReference[],
): PolicyDraftReferenceValidation {
  const agent = agents.find((candidate) => candidate.id === selection.agentId && candidate.status === 'ACTIVE');
  if (agent === undefined) return 'agent-unavailable';

  const account = accounts.find((candidate) => candidate.chainId === selection.chainId
    && candidate.adapter === selection.adapter
    && candidate.address.toLowerCase() === selection.account.toLowerCase());
  if (account === undefined) return 'account-unavailable';
  if (account.status === 'ACTIVE') return 'ready';
  if (account.status === 'PROVISIONING') return 'ready-provisioning';
  return 'account-unavailable';
}
