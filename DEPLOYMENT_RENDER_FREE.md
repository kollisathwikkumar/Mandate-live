# Mandate demo deployment — Render Free only (₹0)

**State (11 October 2026):** the existing `Mandate-live` Render Web Service and `kollisathwikkumar/Mandate-live` GitHub repository are the production demo target. Its root-level deployment now serves the React console and API from one service. Neon already contains migrations 001–026; the demo uses an Auth0 SPA client. This runbook records the current single-service topology; it does not request new services or a new database migration.

## Recommendation and hard constraints

Use:

1. **One existing Render Free Web Service** (`Mandate-live`) builds and hosts both `frontend/` and `backend/`.
2. **Neon PostgreSQL** remains the API database, with certificate-chain and hostname verification.
3. **Auth0** uses its default tenant domain and a public SPA client.

Do not use Render Free Postgres for this candidate's verified-TLS requirement. Render's primary database docs say internal DB TLS uses self-signed certificates that cannot use `verify-ca` or `verify-full`. The external connection uses Render-managed TLS and requires TLS, but the primary docs do not provide the verified CA setup. A Render tutorial says external `verify-full` is possible if a Render CA bundle is shipped; no bundle source or endpoint is available here to test. Therefore neither Render connection route is approved for this app's strict verified-TLS requirement. Do not use `sslmode=require` alone as verification.

Neon documents strict `verify-full`, and its October 2026 Free plan gives 100 projects, **1 GB/project**, **100 CU-hours/project/month**, autoscaling up to 2 CU, 10 branches, and a 6-hour instant-restore window. Free computes suspend after 5 minutes idle; wake-up adds a short cold start. Use its direct (non-pooler) connection endpoint for the API and migration runner. The candidate's `pg` adapter sets `rejectUnauthorized: true` in production, verifies the TLS peer using Node's system trust roots and hostname/SNI from the connection host, and rejects SSL query options that could override those options. Thus copy the Neon URL into the secret field only after removing its `sslmode` query parameter; keep the hostname unchanged. Leave `DATABASE_SSL_CA_PATH` unset only after the controlled `SELECT 1` TLS test succeeds. If it fails, stop and use the provider-documented CA via that variable; never relax verification.

Render Free is appropriate only for a temporary demo, not durable production: Free web services use 0.1 CPU/512 MB, sleep after 15 minutes without traffic, and take about a minute to wake. They have ephemeral filesystems, may restart, have 750 shared instance-hours/workspace/month, and cannot run one-off jobs, SSH, or receive private-network traffic. Static sites use the global CDN. Free Render Postgres is 1 GB, expires after 30 days (then a 14-day upgrade grace before deletion), has no backups or managed pooling, and can be restarted for maintenance. If a limit is exceeded without a payment method, Render suspends service/build usage instead of charging; if a payment method is later added, overages may bill. Render also warns it may suspend a Free web service that initiates unusually high outbound traffic, including an external database connection; keep demo traffic modest and do not assume the external Neon path has an availability guarantee. See [Render Free](https://render.com/docs/free), [Render regions](https://render.com/docs/regions), and [Render service plans](https://render.com/docs/compute-plans).

Auth0 Free currently lists 25,000 MAU and five Organizations. Signup does not require a card; a custom Auth0 domain does require card verification, so use the default `*.auth0.com` tenant domain. Auth0's Free pricing page says Free activates after the 22-day trial. Do not choose any paid feature or add a card. See [Auth0 pricing](https://auth0.com/pricing) and [custom-domain requirements](https://support.auth0.com/center/s/article/Using-Custom-Domains-with-Free-Tenants).

## Single-service Render deployment

Keep the API and React console in the existing **Mandate-live Node Web Service**. Do not create or use a separate Static Site for this deployment. The API serves `frontend/dist` from the same HTTPS origin, while `/api/v1/*` and `/health/*` remain API routes. Render can build this monorepo from its repository root; an empty Root Directory is required so the build sees both packages.

Use the existing service `Mandate-live` (repo `kollisathwikkumar/Mandate-live`, branch `main`, Free plan, Singapore region):

- Root Directory: blank (repository root)
- Build Command: `npm ci --include=dev --prefix backend && npm ci --include=dev --prefix frontend && npm run build --prefix frontend && npm run build --prefix backend`
- Start Command: `node --import ./backend/dist/packages/observability/src/register.js ./backend/dist/apps/api/src/server.js`
- Health Check Path: `/health/ready`
- Runtime: Node `24.21.0`; keep Render's injected `PORT`, and set `HOST=0.0.0.0`, `NODE_ENV=production`.
- Set `MANDATE_CONSOLE_DIST_DIR=frontend/dist`.
- Set `VITE_OIDC_AUTHORITY`, `VITE_OIDC_CLIENT_ID`, `VITE_OIDC_AUDIENCE`, and `VITE_OIDC_SCOPE` as build-time public values on this same service. Leave `VITE_API_BASE_URL` unset/empty so the console calls the API at its own origin.
- Set `MANDATE_CORS_ALLOWED_ORIGINS=https://mandate-live.onrender.com` (the same-origin UI does not require CORS; this exact origin remains available for authorized browser tools).

`render.yaml` records the one-service topology and reproducible root-level build/start commands. Existing Render secret variables remain configured in the service dashboard; do not copy secret values into that manifest. `/health/ready` checks PostgreSQL and requires migration `026_activation_operation_journal.sql`; it should return 503 until the schema is current. `/health/live` is liveness only. The Free Web Service sleeps after 15 minutes without traffic, so warm `/health/ready` before the judge demonstration.

## Auth0 OIDC dashboard setup

Do this manually in the Auth0 Free dashboard. Do not create a client secret for the SPA and never put one in frontend configuration.

1. Create a **Single Page Application**.
2. Add the exact callback URL `https://mandate-live.onrender.com/login/callback` to **Allowed Callback URLs**.
3. Add `https://mandate-live.onrender.com/` to **Allowed Logout URLs**.
4. Add `https://mandate-live.onrender.com` to **Allowed Web Origins**.
5. Create an Auth0 API using a stable API Identifier you choose; select **RS256** signing. Use that exact identifier as the audience in both frontend and API settings.
6. Keep Authorization Code with PKCE. The app uses `oidc-client-ts`, `response_type=code`, and the API audience in the authorization request. Issuer and callback URL matching are exact.
7. Set:
   - `VITE_OIDC_AUTHORITY`: `https://<tenant-domain>/` (the exact Auth0 issuer)
   - `VITE_OIDC_CLIENT_ID`: SPA's public client ID
   - `VITE_OIDC_AUDIENCE`: exact API Identifier
   - `VITE_OIDC_SCOPE`: `openid profile email`
   - `MANDATE_JWT_ISSUER`: exact issuer (`iss`)
   - `MANDATE_JWT_JWKS_URL`: `https://<tenant-domain>/.well-known/jwks.json`
   - `MANDATE_JWT_AUDIENCE`: exact API Identifier

The client ID, authority, scope, API audience, issuer, JWKS URL, and frontend/API origins are not credentials, but set them accurately. The SPA is a public client. Never add client secrets, signing keys, JWT secrets, or database credentials to the frontend. App tenant roles are stored and checked by Mandate's PostgreSQL membership records; Auth0 Organizations do not replace Mandate tenant authorization.

## Runtime environment variables

Set API values in Render's service Environment page. Use its secret-entry field for secret values; never paste them into Git, this guide, logs, or support tickets.

| Name | Required | Purpose / handling |
|---|---:|---|
| `NODE_VERSION` | yes | Pin `24.21.0`. |
| `NODE_ENV` | yes | `production`; enables mandatory PostgreSQL TLS verification. |
| `HOST` | yes | `0.0.0.0`. |
| `PORT` | platform | Render-injected port; do not set a fixed value. |
| `DATABASE_URL` | yes, secret | Neon direct endpoint URL; preserve its hostname; remove `sslmode` and other SSL query parameters because verified TLS is configured in the `pg` options. Do not print it. |
| `DATABASE_SSL_CA_PATH` | conditional | Leave unset only if Node system roots validate Neon’s certificate. Otherwise supply the provider-documented PEM CA file using a secure file mechanism and absolute path. Never use a trust-all TLS mode. |
| `MANDATE_JWT_ISSUER` | yes | Exact OIDC issuer URL. |
| `MANDATE_JWT_JWKS_URL` | yes | HTTPS JWKS URL. |
| `MANDATE_JWT_AUDIENCE` | yes | Exact OIDC API Identifier. |
| `MANDATE_RATE_LIMIT_HMAC_KEY` | yes, secret | At least 32 UTF-8 bytes; generate locally and store only as a Render secret. |
| `MANDATE_CORS_ALLOWED_ORIGINS` | yes | Same-origin UI host: `https://mandate-live.onrender.com`. |
| `MANDATE_EVM_RPC_URLS` | not for initial off-chain demo | Keep unset until read-only chain setup and independently verified account configuration. It is a sensitive endpoint value if it contains a provider token. |
| `MANDATE_SAFE_SINGLETONS`, `MANDATE_CHAIN_CONFIRMATIONS`, `MANDATE_INDEXER_START_BLOCKS`, `MANDATE_INDEXER_CONFIRMATIONS` | not for initial demo | Configure only after exact supported chain/Safe settings are reviewed. |
| `MANDATE_BROADCAST_RPC_FALLBACK_URLS` | not for initial demo | Do not configure; no on-chain execution is enabled in this plan. |
| `MANDATE_TRUSTED_PROXY_CIDRS` | optional | Leave unset unless proxy trust behavior is specifically reviewed. |
| `MANDATE_INVITATION_TOKEN_ENCRYPTION_KEY_HEX` | optional feature | Needed for encrypted invitation token workflows; secret, securely generated, never logged. |
| `MANDATE_AUDIT_SIGNING_SECRET_ARN`, `MANDATE_AUDIT_ANCHOR_BUCKET` | optional feature | AWS-specific audit anchoring; leave unset on this no-AWS plan. |
| `MANDATE_INVITATION_EMAIL_FROM`, `MANDATE_INVITATION_ACCEPT_URL` | optional feature | Email invitation integration; do not enable without a configured delivery provider and worker. |

Frontend build variables: `VITE_API_BASE_URL`, `VITE_OIDC_AUTHORITY`, `VITE_OIDC_CLIENT_ID`, `VITE_OIDC_AUDIENCE`, `VITE_OIDC_SCOPE`. They are embedded into public JavaScript; only non-secret values belong there.

## Database and migrations (operator approval required later)

Neon Free currently lists 100 projects, 1 GB storage/project, 100 CU-hours/month/project, up to 2 CU autoscaling, 10 branches, and a six-hour restore window. Free compute suspends after five minutes idle and resumes on a request; this adds a short connection delay. Keep a single branch, start with the minimum offered compute, monitor usage, and do not upgrade. Confirm current plan/quota in the Neon console before creating anything. There is no Free-plan SLA; the restore window is not a backup guarantee.

Use a dedicated, empty demo database. The 26 migrations are applied in filename order (`001` through `026`) and checked against `backend/migrations/checksums.json`. The runner obtains a PostgreSQL advisory lock, checks applied checksums, and wraps each new migration and its migration-record insert in a transaction. It is rerunnable after completed migrations; a checksum mismatch or an existing manually modified schema must stop for reconciliation. Several DDL files are not independently `IF NOT EXISTS`, so do not manually apply individual SQL files or run against an unknown/shared database.

Neon is not created here. After a separate explicit approval and a controlled TLS test, the operator may run the following once from a trusted local clone, using a locally secured environment—not a command-line literal or report—for `DATABASE_URL`:

```sh
cd backend
npm ci
NODE_ENV=production npm run db:migrate
```

This command has not been run against any remote database. Render Free does not support pre-deploy commands or one-off jobs, so do not configure automatic migrations in the API start command. Verify the migration output and then require `/health/ready` to return `200` before opening the demo.

## What can and cannot be demonstrated

With the API and migrated database, a signed-in user can create an organization (OWNER assignment comes from the normal authenticated API), register an agent/account, create policy drafts, inspect organization-scoped resources, and invoke the backend's real policy-decision API. PROVISIONING is a distinct non-active state; it cannot simulate or execute actions. The backend's simulation/action stores require an ACTIVE account and applicable active grant for normal policy decision/action execution. Do not create fake ACTIVE data to make the screen look ready.

The current live Monad Testnet read-only check returned chain ID `10143`. Read-only contract state at the known deployment addresses showed Safe v1.5.0 with owner threshold 1, but the Safe's module is not enabled, both Safe guard storage slots read zero, the Guard's immutable `agentModule()` reads zero, and Guard `isFullyInstalled()` is false. Therefore **Monad enforcement is not verified and must remain disabled**. Do not call a simulation result an on-chain enforcement or transaction. The minimum truthful demo today is authenticated workspace/provisioning/policy-draft flow and documented `BLOCK`/non-active behavior; a real policy `ALLOW` against active grants needs a legitimately verified ACTIVE account, which this chain state does not currently support.

No background worker is planned for the initial demo. That excludes asynchronous outbox/webhook/email delivery and worker-driven receipt reconciliation. No chain indexer is planned; no finalized chain event ingestion or indexer-backed reconciliation will be demonstrated. The API-only demo must avoid any on-chain submission and state that these paths are unavailable. A worker/indexer cannot be placed on Render Free as reliable always-on processes; do not pay for them to remove that limitation under a ₹0 budget.

## Manual runbook and acceptance checks

### Current local verification gate (not a deployed-service check)

On 2026-10-11, the resumed candidate-directory pass used Node `24.11.1`/npm `11.6.2` (the earlier pass used Node `26.7.0`/npm `11.19.0`); candidate backend unit tests passed (379; 67 skipped), the disposable loopback PostgreSQL/Anvil integration suite passed (98), and frontend tests passed (156). Backend and frontend typecheck, lint, and production builds passed; a compiled local API returned live/ready health, denied an unauthenticated `/api/v1/me` request, and exposed all 38 operations expected by the frontend contract checker. The added JWT regression verifies a token signed by an untrusted key is rejected even when issuer, audience and key ID match. A disposable local PostgreSQL TLS test using the production `pg` options accepted a CA-trusted `localhost` certificate and rejected the same certificate against `127.0.0.1` with `ERR_TLS_CERT_ALTNAME_INVALID`; the temporary test key/certificate were removed. Both package audits reported zero known vulnerabilities. The frontend lockfile was repaired to include three missing type-package entries; a fresh `npm ci` no longer emits the damaged-lockfile warning. These facts do **not** verify Node `24.21.0` on Render, a live Auth0 login, Neon TLS, or a public deployment. Before deployment, rerun the build on Render's pinned Node version and perform the controlled Neon TLS test described below.

`MONAD_READ_ONLY_ATTESTATION.md` records exact Guard/Module deployment input and immutable-instantiated runtime matches, but the Safe module is still disabled and the Guard is not fully installed. Keep all chain execution disabled. The release report records the remaining security and licensing gates.

1. **Publication gate:** this candidate has no Git history and the target public repository was observed empty on 2026-10-11. No source has been pushed. Publish only after independent review and a separate explicit approval; do not connect Render to an unreviewed branch.
2. **Provider account checks:** use existing accounts if available. Do not add a payment method, activate paid plans, attach a custom domain, enable paid backups, or select a paid database/instance.
3. **Neon:** create a Free project only after approval. Select Singapore/AWS ap-southeast-1 if offered to align with Render; confirm Free limits on the confirmation screen. Use the direct non-pooler endpoint. Before migrations, run a controlled Node `pg` connection test with the production adapter and `SELECT 1`; record success only if TLS is encrypted, CA chain validated, hostname checked, and the query succeeds. Store the URL only in the secret UI.
4. **OIDC:** perform the Auth0 SPA/API steps above using the default tenant domain. Confirm a token is issued for the API audience and the API accepts issuer, audience, expiry, and JWKS signature. Assign an actual authenticated user as organization OWNER through the supported product flow; no bypass.
5. **Render service:** keep the existing `Mandate-live` Node Web Service. Set Root Directory to blank and use the single-service commands above; do not create a second Render service.
6. **Database:** retain the already-verified Neon database and migration state; do not rerun migrations as part of a frontend/API packaging change.
7. **Identity:** use the existing Auth0 SPA/API; set its callback, logout, and web-origin entries to `https://mandate-live.onrender.com`, then place the public Vite values on the existing `Mandate-live` service.
8. **Connect:** leave `VITE_API_BASE_URL` empty for same-origin API calls, set exact CORS origin on the API, and redeploy `Mandate-live` after the root-level build settings change.
9. **Smoke test:** verify `/health/live` and `/health/ready`; then sign in; create a workspace; verify OWNER role; create/list agents/accounts; confirm new accounts display PROVISIONING; create a policy draft; ensure non-ACTIVE account cannot simulate or execute; test a backend rule decision only against legitimate ACTIVE account/grant data if such verified state exists; test tenant switching does not show prior-tenant data; confirm API failures and cold-start delays are visible; confirm no transaction is sent.
10. **Chain honesty:** only use read-only RPC checks. Re-verify Safe owner, Guard slots, installed module, module/guard bindings, and agent enrollment before making any claim of on-chain protection. This runbook does not authorize signatures or writes.
11. **Budget checks:** before every provider confirmation, visually confirm the resource says **Free** and $0. Monitor Render included hours, build minutes, bandwidth; monitor Neon storage/CU-hours; monitor Auth0 MAU. If a quota is reached, stop/accept suspension—do not upgrade.
12. **Cleanup later:** stop/delete only the explicitly named demo services and disposable database from their dashboards after exporting data and confirming cleanup. Deleting remote demo resources does not delete local source. Keep the source candidate and verified export until the operator confirms both.

## Zero-cost caveats

`COST_REQUIRED: 0` means this plan selects only Free services and adds no payment method. It is not a guarantee of uninterrupted service. Render can suspend service/builds on free quotas; the API sleeps and has ephemeral filesystem; Neon can suspend or throttle at Free caps and has limited restore/no SLA; Auth0 caps MAU and its custom domain requires card verification. Never choose an upgrade prompt. Provider eligibility and terms can change; recheck each confirmation screen immediately before operator action. If a provider requires a card or paid plan to continue, stop—the requirement is not met at ₹0.
