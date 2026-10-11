export interface TestDatabaseTarget {
  readonly connectionString: string;
  readonly database: string;
}

export interface TestDatabaseIdentity {
  readonly database: string;
  readonly serverAddress: string | null;
}

const invalidTarget = (): Error => new Error(
  'Disposable integration database required: use a loopback PostgreSQL URL and matching MANDATE_TEST_DATABASE_NAME (mandate_test_<unique suffix of at least 8 characters>); URL query overrides are forbidden',
);

/** Reject non-disposable targets before any connection is made. */
export function validateTestDatabaseTarget(connectionString: string | undefined, expectedName: string | undefined): TestDatabaseTarget {
  if (!connectionString || !expectedName || !/^mandate_test_[a-z0-9_]{8,48}$/.test(expectedName)) throw invalidTarget();
  let url: URL;
  try { url = new URL(connectionString); } catch { throw invalidTarget(); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.search !== '' || url.hash !== '' || url.pathname !== `/${expectedName}`) throw invalidTarget();
  return { connectionString, database: expectedName };
}

/** Confirm the database and server actually reached, not just the requested URL. */
export function verifyTestDatabaseIdentity(target: TestDatabaseTarget, identity: TestDatabaseIdentity | undefined): void {
  if (identity?.database !== target.database || identity.serverAddress === null
    || !['127.0.0.1', '::1'].includes(identity.serverAddress)) throw invalidTarget();
}
