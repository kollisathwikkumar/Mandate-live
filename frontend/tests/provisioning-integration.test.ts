import { describe, expect, it } from 'vitest';
import { AccountListSchema } from '../src/api/schemas';
import { buildActivationPreparationBody, getActivationPrepareKey, validateProvisioningActivationAddresses } from '../src/app/provisioningActivation';

const safe = '0x1111111111111111111111111111111111111111';
const guard = '0x2222222222222222222222222222222222222222';
const module = '0x3333333333333333333333333333333333333333';

const account = {
  id: 'safe-1',
  chainId: 10143,
  address: safe,
  adapter: 'evm-smart-account',
  status: 'PROVISIONING',
  createdAt: '2026-10-11T00:00:00.000Z',
  guardAddress: null,
  moduleAddress: null,
  verifiedAt: null,
};

describe('frontend/backend provisioning contract', () => {
  it('accepts a PROVISIONING account returned by account registration', () => {
    expect(AccountListSchema.parse({ accounts: [account] }).accounts[0]?.status).toBe('PROVISIONING');
  });

  it('accepts mixed account states without promoting provisioning accounts', () => {
    const result = AccountListSchema.parse({ accounts: [account, { ...account, id: 'safe-2', status: 'ACTIVE', verifiedAt: '2026-10-11T00:00:00.000Z' }] });
    expect(result.accounts.map(({ status }) => status)).toEqual(['PROVISIONING', 'ACTIVE']);
  });

  it('keeps policy draft eligibility active-only', () => {
    expect(validateProvisioningActivationAddresses({ guardAddress: guard, moduleAddress: module })).toEqual({ ok: true, body: { guardAddress: guard, moduleAddress: module } });
    expect(validateProvisioningActivationAddresses({ guardAddress: '', moduleAddress: module })).toEqual({ ok: false, reason: 'guard-address-invalid' });
    expect(validateProvisioningActivationAddresses({ guardAddress: guard, moduleAddress: '' })).toEqual({ ok: false, reason: 'module-address-invalid' });
    expect(validateProvisioningActivationAddresses({ guardAddress: guard, moduleAddress: '0x1234' })).toEqual({ ok: false, reason: 'module-address-invalid' });
    expect(validateProvisioningActivationAddresses({ guardAddress: `0x${'0'.repeat(40)}`, moduleAddress: module })).toEqual({ ok: false, reason: 'guard-address-invalid' });
    expect(validateProvisioningActivationAddresses({ guardAddress: guard, moduleAddress: `0x${'0'.repeat(40)}` })).toEqual({ ok: false, reason: 'module-address-invalid' });
    expect(validateProvisioningActivationAddresses({ guardAddress: guard, moduleAddress: guard })).toEqual({ ok: false, reason: 'addresses-must-differ' });
  });

  it('sends only the backend-required contract bindings for provisioning preparation', () => {
    expect(buildActivationPreparationBody('PROVISIONING', { guardAddress: guard, moduleAddress: module })).toEqual({
      ok: true,
      body: { guardAddress: guard, moduleAddress: module },
    });
    expect(buildActivationPreparationBody('ACTIVE', { guardAddress: '', moduleAddress: '' })).toEqual({ ok: true, body: undefined });
    expect(buildActivationPreparationBody('PAUSED', { guardAddress: guard, moduleAddress: module })).toEqual({ ok: false, reason: 'account-not-activatable' });
  });
});

describe('activation plan idempotency retries', () => {
  it('reuses a key only for a retry of the exact same operation payload', () => {
    expect(getActivationPrepareKey({ operation: 'activate', payload: JSON.stringify({ guardAddress: guard, moduleAddress: module }), key: 'same-key' }, 'activate', JSON.stringify({ guardAddress: guard, moduleAddress: module }), () => 'new-key')).toBe('same-key');
  });

  it('uses a fresh key if contract inputs change after an API error', () => {
    expect(getActivationPrepareKey({ operation: 'activate', payload: JSON.stringify({ guardAddress: guard, moduleAddress: module }), key: 'old-key' }, 'activate', JSON.stringify({ guardAddress: guard, moduleAddress: safe }), () => 'new-key')).toBe('new-key');
  });
});
