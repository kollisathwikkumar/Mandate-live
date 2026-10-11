export type ReadinessResponse = {
  readonly status: 'ready' | 'not_ready';
  readonly dependencies: { readonly postgres: 'ready' | 'unavailable' | 'schema_not_current' };
};

export type HealthState = 'healthy' | 'degraded' | 'unavailable' | 'unknown';
export type HealthCheck = { readonly name: string; readonly state: HealthState; readonly detail: string };

export function buildSystemHealthChecks(input: {
  readonly readiness: ReadinessResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly authenticatedProfile: boolean;
}): readonly HealthCheck[] {
  const apiState: HealthState = input.loading ? 'unknown' : input.error !== null ? 'unknown' : input.readiness?.status === 'ready' ? 'healthy' : input.readiness?.status === 'not_ready' ? 'degraded' : 'unknown';
  const databaseState: HealthState = input.loading ? 'unknown' : input.error !== null ? 'unknown' : input.readiness?.dependencies.postgres === 'ready' ? 'healthy' : input.readiness?.dependencies.postgres === 'schema_not_current' ? 'degraded' : input.readiness?.dependencies.postgres === 'unavailable' ? 'unavailable' : 'unknown';
  const requestFailure = input.error === null ? null : `The browser could not read /ops/readiness (${input.error}); API and database status are unverified.`;
  return [
    { name: 'Frontend → API', state: apiState, detail: input.loading ? 'Checking /ops/readiness…' : requestFailure ?? (input.readiness?.status === 'ready' ? 'API readiness endpoint returned ready.' : input.readiness?.status === 'not_ready' ? 'API responded but is not ready.' : 'Readiness has not been checked.') },
    { name: 'PostgreSQL / schema marker', state: databaseState, detail: input.loading ? 'Waiting for the API readiness check.' : requestFailure ?? (input.readiness?.dependencies.postgres === 'ready' ? 'PostgreSQL query and latest migration marker are ready.' : input.readiness?.dependencies.postgres === 'schema_not_current' ? 'The latest expected migration marker is not current.' : input.readiness?.dependencies.postgres === 'unavailable' ? 'The API reports PostgreSQL unavailable.' : 'Database status was not returned.') },
    { name: 'Authenticated identity', state: input.authenticatedProfile ? 'healthy' : 'unknown', detail: input.authenticatedProfile ? 'The authenticated /api/v1/me profile loaded for this session.' : 'No authenticated API profile is available in this view.' },
    { name: 'Chain RPC and network', state: 'unknown', detail: 'Not exposed by readiness checks; RPC connectivity and chain ID are not verified here.' },
    { name: 'Safe Guard / Agent Module', state: 'unknown', detail: 'Protection is account-specific; readiness does not establish Guard installation or Module enablement.' },
    { name: 'Indexer / receipt reconciliation', state: 'unknown', detail: 'Indexer freshness and receipt finality are not exposed by the readiness endpoint.' },
  ];
}
