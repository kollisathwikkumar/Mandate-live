import { Client } from 'pg';
import { migrate } from '../../src/postgres/migrate.js';
import { validateTestDatabaseTarget, verifyTestDatabaseIdentity, type TestDatabaseIdentity } from './integration-database.js';

/** Runs once before integration suites; never migrates an unverified database. */
export default async function setup(): Promise<void> {
  const target = validateTestDatabaseTarget(process.env.DATABASE_URL, process.env.MANDATE_TEST_DATABASE_NAME);
  const client = new Client({ connectionString: target.connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const result = await client.query<TestDatabaseIdentity>(
      'SELECT current_database() AS database, host(inet_server_addr()) AS "serverAddress"',
    );
    verifyTestDatabaseIdentity(target, result.rows[0]);
    const applied = await migrate(client);
    process.stdout.write(`Verified disposable database ${target.database}; migrations applied: ${applied.length}\n`);
  } catch {
    // Driver errors can include connection credentials; never echo the original error.
    throw new Error('Disposable integration database bootstrap failed; verify local database identity, availability, and migration checksums');
  } finally {
    await client.end();
  }
}
