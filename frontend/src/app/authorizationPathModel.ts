import type { AccountList, ActionList, AgentList, PolicyList, Receipts } from '../api/schemas';

export type AuthorizationPathStep = {
  readonly key: 'agents' | 'policies' | 'accounts' | 'approvals' | 'execution' | 'evidence';
  readonly index: string;
  readonly title: string;
  readonly count: number | string;
  readonly status: 'ready' | 'attention' | 'evidence' | 'pending' | 'unknown';
  readonly statusLabel: string;
  readonly note: string;
  readonly href: string;
};

type AuthorizationPathInput = {
  readonly agents: readonly Pick<AgentList['agents'][number], 'status'>[];
  readonly policies: readonly Pick<PolicyList['policies'][number], 'state'>[];
  readonly accounts: readonly Pick<AccountList['accounts'][number], 'status' | 'verifiedAt'>[];
  readonly heldActions: readonly Pick<ActionList['actions'][number], 'state'>[];
  readonly receipts: readonly Pick<Receipts['receipts'][number], 'status'>[];
};

export function buildAuthorizationPath(input: AuthorizationPathInput): readonly AuthorizationPathStep[] {
  const activeAgents = input.agents.filter((agent) => agent.status === 'ACTIVE').length;
  const activePolicies = input.policies.filter((policy) => policy.state === 'ACTIVE').length;
  const verifiedAccounts = input.accounts.filter((account) => account.status === 'ACTIVE' && account.verifiedAt !== null).length;
  const heldActions = input.heldActions.filter((action) => action.state === 'HELD').length;
  const finalReceipts = input.receipts.filter((receipt) => receipt.status === 'FINAL').length;

  return [
    {
      key: 'agents', index: '01', title: 'Agent identity', count: activeAgents,
      status: activeAgents > 0 ? 'ready' : 'attention',
      statusLabel: activeAgents > 0 ? 'Identity active' : 'Register an agent',
      note: activeAgents > 0 ? 'Active identities are listed; credentials identify callers, not permissions.' : 'No active agent identity is registered in this workspace.',
      href: '/app/agents',
    },
    {
      key: 'policies', index: '02', title: 'Policy boundary', count: activePolicies,
      status: activePolicies > 0 ? 'ready' : 'attention',
      statusLabel: activePolicies > 0 ? 'Active rules' : 'Actions remain blocked',
      note: activePolicies > 0 ? 'Matching rules still apply to each exact action; this count grants no blanket access.' : 'Actions remain blocked without an active policy. Draft, revoked, and expired policies do not authorize actions.',
      href: '/app/policies',
    },
    {
      key: 'accounts', index: '03', title: 'Verified account', count: verifiedAccounts,
      status: verifiedAccounts > 0 ? 'ready' : 'attention',
      statusLabel: verifiedAccounts > 0 ? 'Supported & verified' : 'Verify supported account',
      note: verifiedAccounts > 0 ? 'Active supported accounts with recorded verification; policy/account matching is still required.' : 'No active supported account has a verification record.',
      href: '/app/settings/accounts',
    },
    {
      key: 'approvals', index: '04', title: 'Human approval', count: heldActions,
      status: heldActions > 0 ? 'attention' : 'pending',
      statusLabel: heldActions > 0 ? 'Held actions to review' : 'No pending approval request',
      note: heldActions > 0 ? 'Only exact held actions appear here; approval does not submit or confirm a transaction.' : 'Approval is policy-dependent. A zero count means no held action is currently listed, not that approval is never required.',
      href: '/app/approvals',
    },
    {
      key: 'execution', index: '05', title: 'Enforcement & execution', count: 'Not verified',
      status: 'unknown', statusLabel: 'Chain state unavailable here',
      note: 'This overview does not prove RPC availability, Guard installation, Module enablement, or transaction submission. Check account protection and execution evidence separately.',
      href: '/app/settings/accounts',
    },
    {
      key: 'evidence', index: '06', title: 'Verified receipt', count: finalReceipts,
      status: finalReceipts > 0 ? 'evidence' : 'pending',
      statusLabel: finalReceipts > 0 ? 'Reconciled receipts' : 'No final receipts',
      note: finalReceipts > 0 ? `${finalReceipts} final receipt${finalReceipts === 1 ? '' : 's'} in the latest 5; evidence is not an authorization grant.` : 'No final receipts in the latest 5; tentative or reorged receipts are not final.',
      href: '/app/activity',
    },
  ];
}

export function buildNextAction(input: AuthorizationPathInput): { readonly title: string; readonly description: string; readonly href: string; readonly label: string } {
  const steps = buildAuthorizationPath(input);
  const agent = steps.find((step) => step.key === 'agents');
  if (agent?.count === 0) return { title: 'Register an agent', description: 'Create a real organization-scoped identity before an agent can submit an action.', href: '/app/agents', label: 'Open agents' };
  const account = steps.find((step) => step.key === 'accounts');
  if (account?.count === 0) return { title: 'Verify a supported account', description: 'Registration alone is not proof of Guard or Module enforcement.', href: '/app/settings/accounts', label: 'Open accounts' };
  const policy = steps.find((step) => step.key === 'policies');
  if (policy?.count === 0) return { title: 'Create and authorize a policy', description: 'A draft does not authorize actions; complete the owner-controlled activation flow.', href: '/app/policies', label: 'Open policies' };
  const approvals = steps.find((step) => step.key === 'approvals');
  if (typeof approvals?.count === 'number' && approvals.count > 0) return { title: 'Review held actions', description: 'Inspect each exact action hash; approval is not execution or receipt confirmation.', href: '/app/approvals', label: 'Review approvals' };
  return { title: 'Verify the execution path', description: 'Confirm chain protection and use an authenticated agent integration; this console does not submit human-authored actions as agents.', href: '/app/settings/accounts', label: 'Review account protection' };
}
