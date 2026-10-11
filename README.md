# Mandate

**Policy-based authorization for software agents.** Mandate gives teams a place to define what an agent may do, require human approval for sensitive actions, and trace each decision back to a policy and an execution record.

An agent should not receive broad access just because it can call a tool. Mandate separates an agent's proposed action from permission to execute it: the action is checked against an organization-scoped policy, and only an authorized execution path can carry it out.

**Live judge demo:** [mandate-live.onrender.com](https://mandate-live.onrender.com/) serves the React console and API from the existing single Render Web Service. Check [readiness](https://mandate-live.onrender.com/health/ready) and the [API contract](https://mandate-live.onrender.com/api/v1/openapi.json). Deployment settings are recorded in [DEPLOYMENT_RENDER_FREE.md](DEPLOYMENT_RENDER_FREE.md).

## What it does

- **Register agents and accounts** within an organization, with membership and role checks on every protected API workflow.
- **Create versioned policies** that constrain actions, recipients, amounts, and approval requirements.
- **Simulate an action** before execution to see whether the current policy would allow, deny, or hold it for approval.
- **Review approvals and activity** in the console, including the policy revision and available execution evidence.
- **Reconcile uncertain outcomes** instead of assuming a submitted transaction succeeded or retrying it blindly.

## How it works

```text
Human operator ──OIDC──> React console
                           │
                           ▼
                     TypeScript API ──> PostgreSQL
                           │             organizations, agents, policies,
                           │             approvals, attempts, receipts
                           ▼
                  Policy + application services
                           │
                 allow / deny / require approval
                           │
                           ▼
                Verified execution adapter
                           │
                 Worker / chain indexer reconcile results
```

The API authenticates people through an external OIDC provider and checks their organization membership and role. PostgreSQL is authoritative for off-chain state. Policy evaluation uses versioned, deterministic rules; it is not delegated to an LLM. An `ALLOW` decision is permission to proceed through the configured adapter, **not** proof that an external action or blockchain transaction occurred. Submission attempts, receipts, and reconciliation are tracked separately.

Mandate follows a **modular-monolith** design: the API, worker, and chain indexer are separate entry points built from shared domain and application packages. The browser never holds server credentials, and Mandate does not custody an owner's wallet private key.

## Repository layout

| Path | Purpose |
| --- | --- |
| [`frontend/`](./frontend/) | React/TypeScript console, public pages, OIDC sign-in, policies, approvals, and activity. |
| [`backend/apps/api/`](./backend/apps/api/) | Authenticated REST API and health endpoints. |
| [`backend/apps/worker/`](./backend/apps/worker/) | Durable outbox, delivery, and receipt-reconciliation jobs. |
| [`backend/apps/chain-indexer/`](./backend/apps/chain-indexer/) | Finalized-chain event indexing for the chain integration path. |
| [`backend/packages/`](./backend/packages/) | Domain, policy, application, adapter, SDK, CLI, and observability code. |
| [`backend/contracts/`](./backend/contracts/) | Mandate Safe Guard and Agent Module Solidity sources. |
| [`backend/migrations/`](./backend/migrations/) | Ordered PostgreSQL schema migrations. |

## Run locally

**Prerequisites:** Node.js 22+, npm, PostgreSQL 17, and an OIDC provider/client for authenticated workflows. Use a dedicated local database; do not point development or tests at a production database.

1. Install dependencies in each package:

   ```sh
   cd backend && npm ci
   cd ../frontend && npm ci
   ```

2. Configure the backend from [`backend/.env.example`](./backend/.env.example). The API requires `DATABASE_URL`, `MANDATE_JWT_ISSUER`, `MANDATE_JWT_JWKS_URL`, and `MANDATE_JWT_AUDIENCE`. Configure the same issuer and API audience in your OIDC provider. Keep credentials in local environment configuration, not in Git. For database migrations, `DATABASE_URL` must be exported in the migration process environment.

3. Configure the frontend from [`frontend/.env.example`](./frontend/.env.example) with `VITE_OIDC_AUTHORITY`, `VITE_OIDC_CLIENT_ID`, and `VITE_OIDC_AUDIENCE`. These are public browser settings, not secrets. The Vite development server proxies `/api` and `/health` to `http://127.0.0.1:3000` by default.

4. On the dedicated database, apply migrations, then start the API and frontend in separate terminals:

   ```sh
   # From backend/, with DATABASE_URL exported
   npm run db:migrate
   npm run dev:api
   ```

   ```sh
   # From frontend/
   npm run dev
   ```

Open the URL printed by Vite. The API exposes `/health/live`, `/health/ready` (including database readiness), and `/api/v1/openapi.json`. Sign-in and organization workflows require a correctly configured OIDC client; there is no default user or authentication bypass.

## Validate changes

Run these commands from **each** of `backend/` and `frontend/`:

```sh
npm run typecheck
npm test -- --reporter=dot
npm run build
npm run lint
```

Database integration tests need a separate disposable test database. Contract integration tests use local Anvil tooling and do not establish live-network readiness.

## Deployment and chain integration

The frontend and API can be hosted separately with an HTTPS OIDC provider and a PostgreSQL connection that verifies the server certificate and hostname. See [`DEPLOYMENT_RENDER_FREE.md`](./DEPLOYMENT_RENDER_FREE.md) for the current deployment procedure and environment variables.

The Solidity Guard/Module path is **not enabled by simply running this app**. Live on-chain execution requires independently verified contract identity, Safe Guard installation, Module enablement, agent enrollment, and receipt/finality reconciliation. A policy simulation or draft is useful without that path, but must not be presented as an executed transaction.

## License

Mandate-owned source is published under [MIT](./LICENSE). Third-party components retain their own terms; see [third-party notices](./THIRD_PARTY_NOTICES.md).
