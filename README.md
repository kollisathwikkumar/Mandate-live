# Mandate-live

Mandate is an authorization control plane for software agents. It combines a React console, an OIDC-authenticated TypeScript API, and PostgreSQL-backed policy, approval, and execution records. The policy engine is deterministic; the configured account/tool adapter is the execution boundary. Mandate does not custody an owner wallet key.

**Demo status:** this repository is application source, not a live service. A green policy simulation or off-chain `ALLOW` is not proof of on-chain execution. The latest Monad Testnet review found the Safe module disabled and the Safe guard not installed, so the current Monad execution path is not ready. No contract deployment or activation is performed by this repository setup.

**Publication status:** this source snapshot is not published. The owner confirmed redistribution authority and selected MIT; the rights-unverified favicon is excluded, and the exact revised manifest received a dedicated reviewed secret scan. Publication remains on hold until the owner approves this revised projection and authorizes the separate Git push. Do not treat this directory as a deployed service.

## Components

- `frontend/`: React, TypeScript, Vite console and public site with OIDC authorization-code + PKCE.
- `backend/apps/api/`: REST API with OIDC/JWT authentication, organization membership checks, policy and action workflows.
- `backend/apps/worker/`: durable outbox, invitation delivery, webhook delivery, and receipt reconciliation jobs.
- `backend/apps/chain-indexer/`: optional finalized-chain event indexer used by chain reconciliation tests; it is not required for the selected onboarding/policy-draft demo.
- `backend/packages/`: domain, policy, application, ports, PostgreSQL/EVM adapters, SDK, CLI, and observability.
- `backend/migrations/`: ordered, checksum-verified PostgreSQL migrations 001–026.

PostgreSQL is the authoritative store for off-chain organizations, agents, policies, grants, execution records, and reconciliation. Human sign-in is external OIDC; authorization roles are checked against organization membership in the database.

## ₹0 hosting and PostgreSQL TLS readiness

The reviewed target is a Render Static Site + Render Free API Web Service + Neon Free PostgreSQL + Auth0 Free using the default tenant domain. No paid service, payment method, cloud resource, remote migration, or deployment is part of this candidate. Exact dashboard values, limits, OIDC setup, migration gate, and cleanup instructions are in [`DEPLOYMENT_RENDER_FREE.md`](./DEPLOYMENT_RENDER_FREE.md).

Production PostgreSQL requires verified TLS. The adapter pins certificate validation on, uses Node trusted roots or a provider-supplied trusted CA, and rejects SSL query settings in `DATABASE_URL` that could override TLS options. Render Postgres is not selected: its internal self-signed TLS does not support `verify-full`, while external `verify-full` requires a Render CA bundle not available for a controlled connection test here. Neon documents `verify-full`; a live TLS test is still required before use. Never use TLS without certificate/hostname verification.

The candidate has no `render.yaml`; use the reviewed manual dashboard configuration and explicitly select Free at each service confirmation.

## OIDC prerequisites

Choose and configure an OIDC provider before enabling sign-in. It must provide an HTTPS issuer, reachable JWKS URL, and access tokens with an audience accepted by the API. Register the exact callback and logout URLs above. The API validates issuer, audience, expiry, and signing keys; the application then enforces tenant membership and OWNER/ADMIN roles. No test identity provider or role bypass is included in this release snapshot.

## Local verification

Requirements: Node.js 22+, npm, and a separately provisioned disposable PostgreSQL 17 database for database-backed tests. Do not use a production or shared database for test runs.

```sh
cd backend
npm ci
npm run typecheck
npm test -- --reporter=dot
npm run build
npm run lint
cd ../frontend
npm ci
npm run typecheck
npm test -- --reporter=dot
npm run build
npm run lint
```

Database integration tests require an explicitly isolated test database. Safe/Anvil tests need the project-pinned local test tooling; they do not establish Monad compatibility or authorize real transactions. No local Compose credentials or seeded identity-provider users are part of this public repository.

## Known limitations

- A production OIDC tenant/client and callback registration must be supplied by the operator.
- A dedicated managed PostgreSQL database must be provisioned with certificate- and hostname-verified TLS before any approved remote migration. Neon Free has a limited restore window, not a full backup guarantee; decide and test a recovery approach before relying on it for durable demo data.
- No Render service, DNS, database, or cloud resource is created by publishing this repository.
- Live Monad account execution remains blocked until the Safe's module and guard configuration are verified and enabled through the established owner-controlled flow.
- Local tests, successful builds, and static configuration checks are not production qualification.
