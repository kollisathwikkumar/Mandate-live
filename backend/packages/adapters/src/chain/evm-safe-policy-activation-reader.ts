import { Contract, JsonRpcProvider, isAddress } from 'ethers';
import type { SafePolicyActivationReader, SafePolicyActivationState } from '../../../ports/src/safe-policy-activation-reader.js';
import { hasTrustedRuntimeCode, type TrustedRuntimeCodeHashes } from './runtime-code-identity.js';

export type PolicyActivationChainErrorCode = 'UNSUPPORTED_CHAIN' | 'RPC_UNAVAILABLE' | 'CHAIN_STATE_MISMATCH';

export class PolicyActivationChainError extends Error {
  public constructor(public readonly code: PolicyActivationChainErrorCode) {
    super(code);
    this.name = 'PolicyActivationChainError';
  }
}

const safeAbi = [
  'function nonce() view returns (uint256)',
  'function isModuleEnabled(address module) view returns (bool)',
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
];
const guardAbi = [
  'function safe() view returns (address)',
  'function agentModule() view returns (address)',
  'function policyEpoch() view returns (uint64)',
  'function policyEnabled() view returns (bool)',
  'function policyRevisionHash() view returns (bytes32)',
  'function isFullyInstalled() view returns (bool)',
];
const moduleAbi = [
  'function safe() view returns (address)',
  'function guard() view returns (address)',
  'function agents(address agent) view returns (uint64 version,bool active)',
];
const SAFE_TX_GUARD_SLOT = BigInt('0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8');
const SAFE_MODULE_GUARD_SLOT = BigInt('0xb104e0b93118902c651344349b610029d694cfdec91c589c91ebafbcd0289947');

function normalizeAddress(value: string): string {
  if (!isAddress(value) || value.toLowerCase() === `0x${'0'.repeat(40)}`) throw new PolicyActivationChainError('CHAIN_STATE_MISMATCH');
  return value.toLowerCase();
}

function getRpcUrl(chainId: number, rpcUrls: Readonly<Record<number, string>>): string {
  const raw = rpcUrls[chainId];
  if (raw === undefined) throw new PolicyActivationChainError('UNSUPPORTED_CHAIN');
  let url: URL;
  try { url = new URL(raw); } catch { throw new PolicyActivationChainError('RPC_UNAVAILABLE'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username !== '' || url.password !== '') {
    throw new PolicyActivationChainError('RPC_UNAVAILABLE');
  }
  return url.toString();
}

/** Reads the latest canonical Safe/guard/module state used to construct owner SafeTx plans. */
export class EvmSafePolicyActivationReader implements SafePolicyActivationReader {
  public constructor(
    private readonly rpcUrls: Readonly<Record<number, string>>,
    private readonly trustedSafeSingletons: Readonly<Record<number, string>> = {},
    private readonly trustedRuntimeCodeHashes: TrustedRuntimeCodeHashes = {},
  ) {}

  public async readState(input: {
    readonly chainId: number;
    readonly safeAddress: string;
    readonly guardAddress: string;
    readonly moduleAddress: string;
    readonly agentAddress: string;
  }): Promise<SafePolicyActivationState> {
    const safeAddress = normalizeAddress(input.safeAddress);
    const guardAddress = normalizeAddress(input.guardAddress);
    const moduleAddress = normalizeAddress(input.moduleAddress);
    const agentAddress = normalizeAddress(input.agentAddress);
    if (guardAddress === moduleAddress) throw new PolicyActivationChainError('CHAIN_STATE_MISMATCH');
    const provider = new JsonRpcProvider(getRpcUrl(input.chainId, this.rpcUrls), input.chainId, { staticNetwork: true });
    try {
      const network = await provider.getNetwork();
      const block = await provider.getBlock('latest');
      if (network.chainId !== BigInt(input.chainId) || block === null) throw new PolicyActivationChainError('CHAIN_STATE_MISMATCH');
      const [codeSafe, codeGuard, codeModule] = await Promise.all([
        provider.getCode(safeAddress, block.number), provider.getCode(guardAddress, block.number), provider.getCode(moduleAddress, block.number),
      ]);
      if (codeSafe === '0x' || codeGuard === '0x' || codeModule === '0x'
        || !hasTrustedRuntimeCode({ chainId: input.chainId, address: guardAddress, code: codeGuard, trustedHashes: this.trustedRuntimeCodeHashes })
        || !hasTrustedRuntimeCode({ chainId: input.chainId, address: moduleAddress, code: codeModule, trustedHashes: this.trustedRuntimeCodeHashes })) {
        throw new PolicyActivationChainError('CHAIN_STATE_MISMATCH');
      }
      const safe = new Contract(safeAddress, safeAbi, provider);
      const guard = new Contract(guardAddress, guardAbi, provider);
      const module = new Contract(moduleAddress, moduleAbi, provider);
      const [nonce, safeEnabled, owners, threshold, guardSafe, guardModule, policyEpoch, policyEnabled, policyRevisionHash, installed, moduleSafe, moduleGuard, agentKey] = await Promise.all([
        safe.getFunction('nonce')({ blockTag: block.number }) as Promise<bigint>,
        safe.getFunction('isModuleEnabled')(moduleAddress, { blockTag: block.number }) as Promise<boolean>,
        safe.getFunction('getOwners')({ blockTag: block.number }) as Promise<readonly string[]>,
        safe.getFunction('getThreshold')({ blockTag: block.number }) as Promise<bigint>,
        guard.getFunction('safe')({ blockTag: block.number }) as Promise<string>,
        guard.getFunction('agentModule')({ blockTag: block.number }) as Promise<string>,
        guard.getFunction('policyEpoch')({ blockTag: block.number }) as Promise<bigint>,
        guard.getFunction('policyEnabled')({ blockTag: block.number }) as Promise<boolean>,
        guard.getFunction('policyRevisionHash')({ blockTag: block.number }) as Promise<string>,
        guard.getFunction('isFullyInstalled')({ blockTag: block.number }) as Promise<boolean>,
        module.getFunction('safe')({ blockTag: block.number }) as Promise<string>,
        module.getFunction('guard')({ blockTag: block.number }) as Promise<string>,
        module.getFunction('agents')(agentAddress, { blockTag: block.number }) as Promise<readonly [bigint, boolean]>,
      ]);
      if (!safeEnabled || !installed || owners.length === 0 || threshold < 1n || threshold > BigInt(owners.length)
        || normalizeAddress(guardSafe) !== safeAddress || normalizeAddress(guardModule) !== moduleAddress
        || normalizeAddress(moduleSafe) !== safeAddress || normalizeAddress(moduleGuard) !== guardAddress) {
        throw new PolicyActivationChainError('CHAIN_STATE_MISMATCH');
      }
      const confirmedBlock = await provider.getBlock(block.number);
      if (confirmedBlock === null || confirmedBlock.hash !== block.hash) throw new PolicyActivationChainError('CHAIN_STATE_MISMATCH');
      const [agentKeyVersion, agentActive] = agentKey;
      return {
        safeAddress, guardAddress, moduleAddress, chainId: input.chainId,
        timestampSeconds: block.timestamp, safeNonce: nonce, safeOwners: owners.map(normalizeAddress), safeThreshold: threshold,
        policyEpoch, policyEnabled, policyRevisionHash: policyRevisionHash.toLowerCase(),
        agentKeyVersion, agentActive, safeModuleEnabled: true, safeTransactionGuardInstalled: true,
        safeModuleGuardInstalled: true, guardModuleConfigured: true,
      };
    } catch (error: unknown) {
      if (error instanceof PolicyActivationChainError) throw error;
      throw new PolicyActivationChainError('RPC_UNAVAILABLE');
    } finally {
      await provider.destroy();
    }
  }

  /** Reads deployment bindings before Safe enablement and both guard slots are installed. */
  public async readProvisioningState(input: {
    readonly chainId: number;
    readonly safeAddress: string;
    readonly guardAddress: string;
    readonly moduleAddress: string;
    readonly agentAddress: string;
  }): Promise<SafePolicyActivationState> {
    const safeAddress = normalizeAddress(input.safeAddress);
    const guardAddress = normalizeAddress(input.guardAddress);
    const moduleAddress = normalizeAddress(input.moduleAddress);
    const agentAddress = normalizeAddress(input.agentAddress);
    if (guardAddress === moduleAddress) throw new PolicyActivationChainError('CHAIN_STATE_MISMATCH');
    const provider = new JsonRpcProvider(getRpcUrl(input.chainId, this.rpcUrls), input.chainId, { staticNetwork: true });
    try {
      const network = await provider.getNetwork();
      const block = await provider.getBlock('latest');
      if (network.chainId !== BigInt(input.chainId) || block === null) throw new PolicyActivationChainError('CHAIN_STATE_MISMATCH');
      const [codeSafe, codeGuard, codeModule] = await Promise.all([
        provider.getCode(safeAddress, block.number), provider.getCode(guardAddress, block.number), provider.getCode(moduleAddress, block.number),
      ]);
      if (codeSafe === '0x' || codeGuard === '0x' || codeModule === '0x'
        || !hasTrustedRuntimeCode({ chainId: input.chainId, address: guardAddress, code: codeGuard, trustedHashes: this.trustedRuntimeCodeHashes })
        || !hasTrustedRuntimeCode({ chainId: input.chainId, address: moduleAddress, code: codeModule, trustedHashes: this.trustedRuntimeCodeHashes })) {
        throw new PolicyActivationChainError('CHAIN_STATE_MISMATCH');
      }
      const trustedSingleton = this.trustedSafeSingletons[input.chainId];
      if (trustedSingleton === undefined || !/^0x[0-9a-fA-F]{40}$/.test(trustedSingleton)) throw new PolicyActivationChainError('UNSUPPORTED_CHAIN');
      const [singletonStorage, singletonCode] = await Promise.all([
        provider.getStorage(safeAddress, 0n, block.number), provider.getCode(trustedSingleton, block.number),
      ]);
      if (`0x${singletonStorage.slice(-40)}`.toLowerCase() !== trustedSingleton.toLowerCase() || singletonCode === '0x') {
        throw new PolicyActivationChainError('CHAIN_STATE_MISMATCH');
      }
      const safe = new Contract(safeAddress, safeAbi, provider);
      const guard = new Contract(guardAddress, guardAbi, provider);
      const module = new Contract(moduleAddress, moduleAbi, provider);
      const [nonce, enabled, owners, threshold, guardSafe, configuredModuleAddress, epoch, policyEnabled, revisionHash,
        moduleSafe, moduleGuardAddress, agentKey, txGuardStorage, moduleGuardStorage] = await Promise.all([
        safe.getFunction('nonce')({ blockTag: block.number }) as Promise<bigint>,
        safe.getFunction('isModuleEnabled')(moduleAddress, { blockTag: block.number }) as Promise<boolean>,
        safe.getFunction('getOwners')({ blockTag: block.number }) as Promise<readonly string[]>,
        safe.getFunction('getThreshold')({ blockTag: block.number }) as Promise<bigint>,
        guard.getFunction('safe')({ blockTag: block.number }) as Promise<string>,
        guard.getFunction('agentModule')({ blockTag: block.number }) as Promise<string>,
        guard.getFunction('policyEpoch')({ blockTag: block.number }) as Promise<bigint>,
        guard.getFunction('policyEnabled')({ blockTag: block.number }) as Promise<boolean>,
        guard.getFunction('policyRevisionHash')({ blockTag: block.number }) as Promise<string>,
        module.getFunction('safe')({ blockTag: block.number }) as Promise<string>,
        module.getFunction('guard')({ blockTag: block.number }) as Promise<string>,
        module.getFunction('agents')(agentAddress, { blockTag: block.number }) as Promise<readonly [bigint, boolean]>,
        provider.getStorage(safeAddress, SAFE_TX_GUARD_SLOT, block.number),
        provider.getStorage(safeAddress, SAFE_MODULE_GUARD_SLOT, block.number),
      ]);
      if (owners.length === 0 || threshold < 1n || threshold > BigInt(owners.length)
        || normalizeAddress(guardSafe) !== safeAddress || normalizeAddress(moduleSafe) !== safeAddress
        || normalizeAddress(moduleGuardAddress) !== guardAddress) throw new PolicyActivationChainError('CHAIN_STATE_MISMATCH');
      const slotAddress = (word: string): string => {
        if (!/^0x[0-9a-fA-F]{64}$/.test(word)) throw new PolicyActivationChainError('CHAIN_STATE_MISMATCH');
        const address = `0x${word.slice(-40)}`.toLowerCase();
        return address === `0x${'0'.repeat(40)}` ? address : normalizeAddress(address);
      };
      const transactionGuard = slotAddress(txGuardStorage);
      const moduleGuard = slotAddress(moduleGuardStorage);
      const zeroAddress = `0x${'0'.repeat(40)}`;
      const configuredModule = configuredModuleAddress.toLowerCase() === zeroAddress
        ? zeroAddress : normalizeAddress(configuredModuleAddress);
      if ((transactionGuard !== zeroAddress && transactionGuard !== guardAddress)
        || (moduleGuard !== zeroAddress && moduleGuard !== guardAddress)
        || (configuredModule !== zeroAddress && configuredModule !== moduleAddress)) {
        throw new PolicyActivationChainError('CHAIN_STATE_MISMATCH');
      }
      const confirmedBlock = await provider.getBlock(block.number);
      if (confirmedBlock === null || confirmedBlock.hash !== block.hash) throw new PolicyActivationChainError('CHAIN_STATE_MISMATCH');
      const [agentKeyVersion, agentActive] = agentKey;
      return {
        safeAddress, guardAddress, moduleAddress, chainId: input.chainId, timestampSeconds: block.timestamp, safeNonce: nonce,
        safeOwners: owners.map(normalizeAddress), safeThreshold: threshold, policyEpoch: epoch,
        policyEnabled, policyRevisionHash: revisionHash.toLowerCase(), agentKeyVersion, agentActive,
        safeModuleEnabled: enabled, safeTransactionGuardInstalled: transactionGuard === guardAddress,
        safeModuleGuardInstalled: moduleGuard === guardAddress, guardModuleConfigured: configuredModule === moduleAddress,
      };
    } catch (error: unknown) {
      if (error instanceof PolicyActivationChainError) throw error;
      throw new PolicyActivationChainError('RPC_UNAVAILABLE');
    } finally {
      await provider.destroy();
    }
  }
}
