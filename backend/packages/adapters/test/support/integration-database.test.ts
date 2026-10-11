import { describe, expect, it } from 'vitest';
import { validateTestDatabaseTarget, verifyTestDatabaseIdentity } from './integration-database.js';

const name = 'mandate_test_20261011a';
const url = `postgresql://127.0.0.1:55432/${name}`;

describe('disposable integration database boundary', () => {
  it('accepts only a named loopback database and checks its live identity', () => {
    const target = validateTestDatabaseTarget(url, name);
    expect(target.database).toBe(name);
    expect(() => verifyTestDatabaseIdentity(target, { database: name, serverAddress: '127.0.0.1' })).not.toThrow();
    expect(() => verifyTestDatabaseIdentity(target, { database: 'postgres', serverAddress: '127.0.0.1' })).toThrow();
    expect(() => verifyTestDatabaseIdentity(target, { database: name, serverAddress: '203.0.113.1' })).toThrow();
  });

  it.each([
    ['missing URL', undefined, name],
    ['missing expected name', url, undefined],
    ['production name', 'postgresql://127.0.0.1:55432/mandate', 'mandate'],
    ['remote hostname', `postgresql://db.example.com:5432/${name}`, name],
    ['query override', `${url}?sslmode=disable`, name],
    ['name mismatch', url, 'mandate_test_othername'],
  ])('rejects %s before connecting', (_case, candidateUrl, expectedName) => {
    expect(() => validateTestDatabaseTarget(candidateUrl, expectedName)).toThrow('Disposable integration database required');
  });
});
