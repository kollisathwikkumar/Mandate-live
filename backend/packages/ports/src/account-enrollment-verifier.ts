export interface AccountEnrollmentRequest {
  readonly chainId: number;
  readonly address: string;
}

export interface AccountEnrollmentProof {
  readonly safeAddress: string;
  readonly guardAddress: string;
  readonly moduleAddress: string;
  readonly verifiedBlockNumber: string;
  readonly verifiedBlockHash: string;
}

export interface AccountEnrollmentVerifier {
  verify(request: AccountEnrollmentRequest): Promise<AccountEnrollmentProof>;
}
