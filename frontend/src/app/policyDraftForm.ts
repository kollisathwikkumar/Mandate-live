import { PolicyRevisionSchema, type AgentList, type AccountList, type PolicyRevision } from '../api/schemas';

export interface PolicyDraftFormValues {
  readonly policyId: string;
  readonly owner: string;
  readonly account: string;
  readonly agentId: string;
  readonly agentAddress: string;
  readonly tokenAddress: string;
  readonly selector: string;
  readonly recipient: string;
  readonly tokenDecimals: number;
  readonly perAction: string;
  readonly cumulative: string;
  readonly windowHours: number;
  readonly approvalThreshold: string;
  readonly maxActions: number;
  readonly validAfter: string;
  readonly expiresAt: string;
}

export function buildPolicyDraft(
  values: PolicyDraftFormValues,
  organizationId: string,
  agent: AgentList['agents'][number],
  account: AccountList['accounts'][number],
): PolicyRevision {
  if (agent.id !== values.agentId || agent.status !== 'ACTIVE') throw new Error('Choose an active agent from this workspace.');
  if (account.address.toLowerCase() !== values.account.toLowerCase() || account.status !== 'ACTIVE' || account.verifiedAt === null) {
    throw new Error('Choose an active verified smart account from this workspace.');
  }
  const validAfter = Date.parse(values.validAfter);
  const expiresAt = Date.parse(values.expiresAt);
  if (!Number.isFinite(validAfter) || !Number.isFinite(expiresAt) || expiresAt <= validAfter) throw new Error('Expiry must be a valid time after the start time.');
  if (!/^0x[0-9a-fA-F]{8}$/.test(values.selector)) throw new Error('Enter a 4-byte function selector, for example 0xa9059cbb.');
  const perAction = toTokenUnits(values.perAction, values.tokenDecimals, false, 'Maximum per transfer');
  const cumulative = toTokenUnits(values.cumulative, values.tokenDecimals, false, 'Maximum total in window');
  const approvalThreshold = values.approvalThreshold === '' ? undefined : toTokenUnits(values.approvalThreshold, values.tokenDecimals, true, 'Approval threshold');
  const parsed = PolicyRevisionSchema.safeParse({
    schemaVersion: 1,
    policyId: values.policyId.trim(),
    revision: 1,
    organizationId,
    owner: values.owner.trim(),
    account: account.address,
    agentId: agent.id,
    agentAddress: values.agentAddress.trim(),
    agentKeyVersion: agent.keyVersion,
    chainId: account.chainId,
    adapter: account.adapter,
    target: values.tokenAddress.trim(),
    selectors: [values.selector.toLowerCase()],
    asset: values.tokenAddress.trim(),
    recipients: [values.recipient.trim()],
    limits: {
      perAction,
      cumulative,
      windowSeconds: values.windowHours * 3600,
      ...(approvalThreshold === undefined ? {} : { approvalThreshold }),
      maxActions: values.maxActions,
    },
    validAfter: Math.floor(validAfter / 1000),
    expiresAt: Math.floor(expiresAt / 1000),
    nonceEpoch: 0,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (!issue) throw new Error('Review the required policy details and try again.');
    const field = issue.path.join('.') || 'policy';
    const labels: Record<string, string> = {
      policyId: 'Policy name', owner: 'Safe owner wallet address', account: 'Safe account', agentId: 'Agent',
      agentAddress: 'Agent wallet address', target: 'Target / token contract address', selectors: 'Function selector',
      asset: 'Token contract address', recipients: 'Allowed recipient address', 'limits.perAction': 'Per-action limit',
      'limits.cumulative': 'Total limit', 'limits.windowSeconds': 'Time window', 'limits.maxActions': 'Maximum actions',
    };
    throw new Error(`${labels[field] ?? field}: ${issue.message}`);
  }
  return parsed.data;
}

function toTokenUnits(value: string, decimals: number, allowZero: boolean, label: string): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Token decimals must be a whole number from 0 to 36.');
  const normalized = value.trim();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(normalized);
  if (!match || (match[2]?.length ?? 0) > decimals) throw new Error(`${label} must be a non-negative amount with no more decimal places than the token supports.`);
  const fraction = (match[2] ?? '').padEnd(decimals, '0') || '0';
  const units = BigInt(match[1] ?? '0') * (10n ** BigInt(decimals)) + BigInt(fraction);
  if (!allowZero && units === 0n) throw new Error(`${label} must be greater than zero.`);
  return units.toString();
}

export function localDateTimeValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
