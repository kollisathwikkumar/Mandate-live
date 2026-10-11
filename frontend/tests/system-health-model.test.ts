import { describe, expect, it } from 'vitest';
import { buildSystemHealthChecks } from '../src/app/systemHealthModel';

describe('buildSystemHealthChecks', () => {
  it('separates ready API and database results from unreported chain dependencies', () => {
    const checks = buildSystemHealthChecks({
      readiness: { status: 'ready', dependencies: { postgres: 'ready' } }, loading: false, error: null, authenticatedProfile: true,
    });
    expect(checks.map(({ name, state }) => [name, state])).toEqual([
      ['Frontend → API', 'healthy'], ['PostgreSQL / schema marker', 'healthy'], ['Authenticated identity', 'healthy'],
      ['Chain RPC and network', 'unknown'], ['Safe Guard / Agent Module', 'unknown'], ['Indexer / receipt reconciliation', 'unknown'],
    ]);
    expect(checks[3]?.detail).toContain('not verified');
  });

  it('preserves degraded and unavailable dependency failures without green fallback', () => {
    const schema = buildSystemHealthChecks({ readiness: { status: 'not_ready', dependencies: { postgres: 'schema_not_current' } }, loading: false, error: null, authenticatedProfile: false });
    expect(schema[0]?.state).toBe('degraded');
    expect(schema[1]?.state).toBe('degraded');
    expect(schema[2]?.state).toBe('unknown');
    const offline = buildSystemHealthChecks({ readiness: null, loading: false, error: 'API unavailable', authenticatedProfile: false });
    expect(offline[0]?.state).toBe('unavailable');
    expect(offline[1]?.state).toBe('unavailable');
    expect(offline[3]?.state).toBe('unknown');
  });

  it('does not claim health while a request is pending', () => {
    const checks = buildSystemHealthChecks({ readiness: null, loading: true, error: null, authenticatedProfile: false });
    expect(checks.slice(0, 2).map(({ state }) => state)).toEqual(['unknown', 'unknown']);
  });
});
