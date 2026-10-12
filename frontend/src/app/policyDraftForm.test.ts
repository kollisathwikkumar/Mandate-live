import { describe, expect, it } from 'vitest';
import { buildPolicyDraft } from './policyDraftForm';

const base = {
  policyId: 'metropolis-test-policy',
  owner: `0x${'1'.repeat(40)}`,
  account: `0x${'2'.repeat(40)}`,
  agentId: 'mandate-demo-agent',
  agentAddress: `0x${'3'.repeat(40)}`,
  tokenAddress: `0x${'4'.repeat(40)}`,
  selector: '0xa9059cbb',
  recipient: `0x${'5'.repeat(40)}`,
  tokenDecimals: 18,
  perAction: '0.01',
  cumulative: '0.05',
  windowHours: 24,
  approvalThreshold: '0.01',
  maxActions: 10,
  validAfter: '2026-10-13T00:00',
  expiresAt: '2026-10-20T00:00',
};

const agent = { id: 'mandate-demo-agent', displayName: 'Demo agent', status: 'ACTIVE' as const, keyVersion: 2, createdAt: '2026-10-12T00:00:00Z' };
const account = { id: 'safe-account', chainId: 10143, address: base.account, adapter: 'evm-smart-account' as const, status: 'ACTIVE' as const, createdAt: '2026-10-12T00:00:00Z', guardAddress: null, moduleAddress: null, verifiedAt: '2026-10-12T18:16:00Z' };

describe('buildPolicyDraft', () => {
  it('builds the canonical policy from selected organization resources and plain form values', () => {
    const policy = buildPolicyDraft(base, 'org-metropolis', agent, account);
    expect(policy).toMatchObject({
      schemaVersion: 1,
      policyId: 'metropolis-test-policy',
      revision: 1,
      organizationId: 'org-metropolis',
      account: base.account,
      agentId: 'mandate-demo-agent',
      agentAddress: base.agentAddress,
      agentKeyVersion: 2,
      chainId: 10143,
      adapter: 'evm-smart-account',
      target: base.tokenAddress,
      selectors: [base.selector],
      asset: base.tokenAddress,
      recipients: [base.recipient],
      limits: { perAction: '10000000000000000', cumulative: '50000000000000000', windowSeconds: 86400, approvalThreshold: '10000000000000000', maxActions: 10 },
      validAfter: Math.floor(new Date(base.validAfter).getTime() / 1000),
      expiresAt: Math.floor(new Date(base.expiresAt).getTime() / 1000),
      nonceEpoch: 0,
    });
  });

  it('rejects a revoked agent and a non-active account before saving', () => {
    expect(() => buildPolicyDraft(base, 'org-metropolis', { ...agent, status: 'REVOKED' }, account)).toThrow(/active agent/i);
    expect(() => buildPolicyDraft(base, 'org-metropolis', agent, { ...account, status: 'PROVISIONING' })).toThrow(/active verified smart account/i);
  });

  it('rejects invalid addresses, selectors, limits, and date order with readable feedback', () => {
    expect(() => buildPolicyDraft({ ...base, tokenAddress: '0x123' }, 'org-metropolis', agent, account)).toThrow(/target \/ token contract address/i);
    expect(() => buildPolicyDraft({ ...base, selector: 'transfer' }, 'org-metropolis', agent, account)).toThrow(/function selector/i);
    expect(() => buildPolicyDraft({ ...base, perAction: '0' }, 'org-metropolis', agent, account)).toThrow(/maximum per transfer must be greater than zero/i);
    expect(() => buildPolicyDraft({ ...base, perAction: '0.001', tokenDecimals: 2 }, 'org-metropolis', agent, account)).toThrow(/maximum per transfer/i);
    expect(() => buildPolicyDraft({ ...base, expiresAt: '2026-10-12T00:00' }, 'org-metropolis', agent, account)).toThrow(/expiry/i);
  });
});
