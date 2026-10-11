# Mandate frontend/API hackathon demo (truthful scope)

**Current state:** local candidate only; no public service exists. Publication, remote database migration, and free-service creation require separate review/approval. Do not present this runbook as an executed demo. Budget target: ₹0, using only explicitly Free Render, Neon, and Auth0 settings in `DEPLOYMENT_RENDER_FREE.md`.

## Operator setup after the release gate

1. Review the current `FAST_TRACK_RELEASE_REPORT.md` and exact revised publication manifest/diff. The owner selected MIT, but must still approve the revised projection and separately authorize any Git push; rerun the dedicated scan if files change.
2. In existing/new operator-controlled provider dashboards, select only Free plans, default hostnames and no payment method. Configure the API, frontend, Neon database, and Auth0 SPA/API exactly as in `DEPLOYMENT_RENDER_FREE.md`. Store `DATABASE_URL` and `MANDATE_RATE_LIMIT_HMAC_KEY` only in secret fields. Never put credentials in `VITE_*` values, Git, or screenshots.
3. Separately approve migrations on a dedicated empty Neon database only after a hostname-verified TLS connection check. Require API `/health/ready` to return `200` before judges use the site. Wake a sleeping Render Free API before the timed demo.
4. Keep `MANDATE_EVM_RPC_URLS`, chain execution, worker/indexer submission, and trusted-hash configuration disabled until the deployed Safe Guard/module installation and agent enrollment are independently verified. Do not use a fabricated ACTIVE account or receipt.

## Five-minute judge path (only after live verification)

1. Open the actual deployed HTTPS frontend URL; show the real API `/health/ready` response. A cold-start wait is normal on a sleeping Free service; do not mask an error as success.
2. Sign in through the configured Auth0 Authorization Code + PKCE flow. Demonstrate that unauthenticated API access is denied and the signed-in user sees their actual organization membership.
3. Create an organization through the authenticated API/UI. Confirm the creator receives the Mandate OWNER role; this is application membership, not an Auth0 Organization claim.
4. Register a genuine agent public address and a genuine smart-account address; show the new account as `PROVISIONING`. Create a complete policy draft, show the canonical revision/hash returned by the API, and show validation errors if references are wrong.
5. Explain and demonstrate the status boundary: a draft and an activation plan are not active enforcement. A `PROVISIONING` account cannot simulate/execute. If the chain remains uninstalled, show the blocked state rather than an ALLOW/receipt claim.
6. If two real organizations are available, use separate authorized identities to demonstrate the tenant boundary: one cannot list or mutate the other's accounts, policies, activation plans, or receipts. Do not expose another user's data in a screenshot.
7. Show read-only Monad evidence only: Safe version/owner/threshold, Guard and Module code/constructor bindings, and the current missing installation state from `MONAD_READ_ONLY_ATTESTATION.md`. Label it “deployed bytecode verified; enforcement not installed.”

## Acceptance and stop conditions

- The frontend must call the real HTTPS API origin; CORS must allow exactly the frontend origin. Login callback/logout URLs and issuer/audience/JWKS must match the dashboard values. No test bypasses or static success data are acceptable.
- The database must remain authoritative, isolated by organization, and reached with CA-chain plus hostname verification. A `503` readiness response, failed login, mismatched tenant result, or unavailable database means pause the demo and show the actual error.
- No on-chain transaction, Safe operation, or wallet signature is part of this frontend/API snapshot. The owner-controlled on-chain path needs separate explicit authorization and full configuration/receipt verification.
- Free quotas, account eligibility, sleeping services, and an unapproved revised release projection may prevent publication or availability. Never choose a paid alternative silently.
