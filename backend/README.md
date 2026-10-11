# Backend

The backend is a TypeScript modular monolith with separate API and worker entry points with shared SDK/CLI and application/domain packages. PostgreSQL is authoritative for off-chain organization, agent, policy, grant, execution, and reconciliation state.

## Runtime entry points

From `backend/`, after `npm ci && npm run build`:

```sh
node --import ./dist/packages/observability/src/register.js ./dist/apps/api/src/server.js
node --import ./dist/packages/observability/src/register.js ./dist/apps/worker/src/server.js
```

The API requires `DATABASE_URL`, `MANDATE_JWT_ISSUER`, `MANDATE_JWT_JWKS_URL`, and `MANDATE_JWT_AUDIENCE`. In production it also requires `MANDATE_RATE_LIMIT_HMAC_KEY` (at least 32 UTF-8 bytes). Configure exact HTTPS origins with `MANDATE_CORS_ALLOWED_ORIGINS` when the browser console is hosted on another origin. Secrets are injected at runtime by the platform's secret manager; never put them in source or browser build variables.

The API exposes `/health/live` and `/health/ready` for hosting probes, plus `/ops/readiness` for the browser console. Both readiness endpoints check the required database dependency. Use an external OIDC issuer/JWKS and audience; no local identity-provider realm, seeded user, or authentication bypass is included here.

The finalized-chain indexer is included for the chain integration path but is optional for the selected Render onboarding/policy-draft demo. If separately deployed, build from the same `backend` root and start with `node --import ./dist/packages/observability/src/register.js ./dist/apps/chain-indexer/src/server.js`; configure a verified `MANDATE_EVM_RPC_URLS`, `MANDATE_INDEXER_START_BLOCKS`, and finality settings first.

## PostgreSQL migrations

Migrations `001`–`026` run in numeric order under an advisory lock. The checksum manifest is verified before migration execution. Use a dedicated database, review the target identity, and establish a tested restore/export procedure before the first deployment. Migration transactions make each file atomic; the repository does not provide automatic down migrations. Recovery is a forward fix or restore from verified data, not destructive reset.

Render Free does not support pre-deploy jobs or shell access. After separate operator approval, run `npm run db:migrate` from a trusted local checkout against the dedicated Neon endpoint with certificate- and hostname-verified TLS; never add it to API startup. No remote migration has been run for this candidate.

## Local tests

```sh
npm run typecheck
npm test -- --reporter=dot
npm run build
npm run lint
```

PostgreSQL integration tests require a dedicated disposable test database and an explicit `MANDATE_TEST_DATABASE_NAME`; chain integration tests use local test tooling. They are not evidence of live-chain compatibility or deployment state.

See the root README for the Render roots, commands, OIDC setup, environment-variable names, and current Monad limitations.
