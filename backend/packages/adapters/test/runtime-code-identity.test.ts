import { describe, expect, it } from 'vitest';
import { keccak256 } from 'ethers';
import { hasTrustedRuntimeCode } from '../src/chain/runtime-code-identity.js';

const address = `0x${'1'.repeat(40)}`;
const code = '0x60006000';
const hash = keccak256(code);

describe('trusted deployed runtime identity', () => {
  it('accepts only the exact runtime hash allowlisted for the chain and address', () => {
    expect(hasTrustedRuntimeCode({ chainId: 10143, address, code, trustedHashes: { 10143: { [address]: hash } } })).toBe(true);
    expect(hasTrustedRuntimeCode({ chainId: 10143, address, code: '0x60006001', trustedHashes: { 10143: { [address]: hash } } })).toBe(false);
    expect(hasTrustedRuntimeCode({ chainId: 1, address, code, trustedHashes: { 10143: { [address]: hash } } })).toBe(false);
  });

  it('fails closed for an absent allowlist entry, empty code, malformed code, or malformed/zero address', () => {
    expect(hasTrustedRuntimeCode({ chainId: 10143, address, code, trustedHashes: {} })).toBe(false);
    expect(hasTrustedRuntimeCode({ chainId: 10143, address, code: '0x', trustedHashes: { 10143: { [address]: hash } } })).toBe(false);
    expect(hasTrustedRuntimeCode({ chainId: 10143, address, code: '0x600', trustedHashes: { 10143: { [address]: hash } } })).toBe(false);
    expect(hasTrustedRuntimeCode({ chainId: 10143, address: `0x${'0'.repeat(40)}`, code, trustedHashes: { 10143: { [address]: hash } } })).toBe(false);
    expect(hasTrustedRuntimeCode({ chainId: 10143, address: 'invalid', code, trustedHashes: { 10143: { [address]: hash } } })).toBe(false);
  });

  it('rejects malformed trusted hashes rather than treating them as identities', () => {
    expect(hasTrustedRuntimeCode({ chainId: 10143, address, code, trustedHashes: { 10143: { [address]: '0x1234' } } })).toBe(false);
  });
});
