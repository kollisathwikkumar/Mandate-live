export type AccountVerificationStatus = 'PROVISIONING' | 'PAUSED' | 'ACTIVE' | 'UNSUPPORTED';

export function canVerifyAccount(status: AccountVerificationStatus, verifiedAt: string | null): boolean {
  return verifiedAt === null && status !== 'UNSUPPORTED';
}
