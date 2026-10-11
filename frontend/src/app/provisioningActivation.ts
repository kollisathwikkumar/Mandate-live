export interface ProvisioningContractInput {
  readonly guardAddress: string;
  readonly moduleAddress: string;
}

export interface ActivationPrepareKey {
  readonly operation: 'activate' | 'revoke';
  readonly payload: string;
  readonly key: string;
}

export type ProvisioningAddressValidation =
  | { readonly ok: true; readonly body: ProvisioningContractInput }
  | { readonly ok: false; readonly reason: 'guard-address-invalid' | 'module-address-invalid' | 'addresses-must-differ' };
type ProvisioningAddressError = 'guard-address-invalid' | 'module-address-invalid' | 'addresses-must-differ';

export type ActivationPreparationValidation =
  | { readonly ok: true; readonly body: ProvisioningContractInput | undefined }
  | { readonly ok: false; readonly reason: ProvisioningAddressError | 'account-not-activatable' };

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = /^0x0{40}$/i;

export function validateProvisioningActivationAddresses(input: ProvisioningContractInput): ProvisioningAddressValidation {
  if (!EVM_ADDRESS.test(input.guardAddress) || ZERO_ADDRESS.test(input.guardAddress)) return { ok: false, reason: 'guard-address-invalid' };
  if (!EVM_ADDRESS.test(input.moduleAddress) || ZERO_ADDRESS.test(input.moduleAddress)) return { ok: false, reason: 'module-address-invalid' };
  if (input.guardAddress.toLowerCase() === input.moduleAddress.toLowerCase()) return { ok: false, reason: 'addresses-must-differ' };
  return { ok: true, body: { guardAddress: input.guardAddress, moduleAddress: input.moduleAddress } };
}

export function buildActivationPreparationBody(
  accountStatus: 'PROVISIONING' | 'ACTIVE' | 'PAUSED' | 'UNSUPPORTED',
  input: ProvisioningContractInput,
): ActivationPreparationValidation {
  if (accountStatus === 'ACTIVE') return { ok: true, body: undefined };
  if (accountStatus !== 'PROVISIONING') return { ok: false, reason: 'account-not-activatable' };
  return validateProvisioningActivationAddresses(input);
}

export function getActivationPrepareKey(
  previous: ActivationPrepareKey | null,
  operation: ActivationPrepareKey['operation'],
  payload: string,
  createKey: () => string,
): string {
  if (previous !== null && previous.operation === operation && previous.payload === payload) return previous.key;
  return createKey();
}
