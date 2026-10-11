# Mandate — live judge demonstration

**Current state (11 October 2026):** The React frontend and API are served together by the existing `Mandate-live` Render Web Service. Neon has migrations 001–026 applied. API readiness is HTTP 200. Auth0 sign-in reached the live console, and a signed-in owner created the `Mandate Jury Demo` organization. Agent/account/policy and Monad testnet execution remain separate checks; the required Safe, Guard, and Module addresses are pending.

## Live URLs

- Demo UI and API: https://mandate-live.onrender.com/
- Browser readiness: https://mandate-live.onrender.com/ops/readiness
- Render health check: https://mandate-live.onrender.com/health/ready
- API contract: https://mandate-live.onrender.com/api/v1/openapi.json

## What Mandate is built to do

An agent proposes an exact action. Mandate checks the caller identity, organization membership, smart account, immutable policy revision, recipient, amount, target and expiry. A blocked action stops; an approval-required action waits for a distinct human decision. An authorized action still needs the agent-signed Safe-module transaction. Submission and final receipt reconciliation are separate evidence states, not a label added to a draft.

## Verified live behavior

1. The public React landing page and nested `/app/overview` route return HTTP 200 from the `Mandate-live` Web Service. The nested route uses an SPA rewrite to `/index.html`.
2. The API returns HTTP 200 from `/ops/readiness` with `postgres: ready` after the checksum-checked migrations. Render's `/health/ready` probe remains available. Its unauthenticated `/api/v1/me` response is HTTP 401.
3. The API permits preflight requests from exactly the Render frontend origin and denies an unrelated origin with HTTP 403.
4. Auth0 login reaches the signed-in console. The live API accepted organization creation and returned owner membership; the overview, agent list, and account list loaded from that tenant. The console shows `API connection Connected` based on its authenticated, database-backed profile response.
5. Backend and frontend builds and unit suites pass locally. See `VERIFICATION.txt` for commands and literal results.

## Five-minute jury flow after signing in

1. Open the frontend and show the live API readiness response.
2. Sign in through Auth0 and show the existing `Mandate Jury Demo` owner membership in the live console.
3. Register an agent identity. Show the returned one-time credential only to the trusted operator, not in a projected demo or screenshot.
4. Register a genuine testnet Safe address. Show the account as `PROVISIONING`, and explain that this record is not a claim of on-chain enforcement.
5. Create an immutable draft policy referencing that agent and account. Show revision/hash and backend validation. A draft is not an active grant.
6. Show the authorization path: exact intent → policy verdict → human decision if needed → signed transaction → reconciled receipt and audit trail. Execute the testnet portion only after the Safe Guard/Module installation and owner-controlled transactions are verified.

## Monad testnet qualification

The deployed Guard, Agent Module and Safe must be inspected at their actual addresses. Check chain ID, Safe version/owners/threshold, both guard slots, enabled module, module-to-Safe/Guard bindings, agent key state, and runtime bytecode hashes. Then use owner-signed Safe operations to install/activate and verify final receipts before claiming an active on-chain policy or ALLOW execution. The current Render API has no chain RPC or trusted code-hash configuration, so its live judge path currently proves the off-chain control plane and the non-active boundary.
