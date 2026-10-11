import { isAddress, keccak256 } from 'ethers';

export type TrustedRuntimeCodeHashes = Readonly<Record<number, Readonly<Record<string, string>>>>;

/** Exact deployed-code allowlist, keyed by chain ID and lower-case contract address. */
export function hasTrustedRuntimeCode(input: {
  readonly chainId: number;
  readonly address: string;
  readonly code: string;
  readonly trustedHashes: TrustedRuntimeCodeHashes;
}): boolean {
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1 || !isAddress(input.address)
    || input.address.toLowerCase() === `0x${'0'.repeat(40)}`
    || !/^0x(?:[0-9a-fA-F]{2})+$/.test(input.code)) return false;
  const expected = input.trustedHashes[input.chainId]?.[input.address.toLowerCase()];
  if (expected === undefined || !/^0x[0-9a-fA-F]{64}$/.test(expected)) return false;
  try {
    return keccak256(input.code).toLowerCase() === expected.toLowerCase();
  } catch {
    return false;
  }
}
