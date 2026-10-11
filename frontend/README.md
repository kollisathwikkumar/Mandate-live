# Mandate Console

React/TypeScript/Vite public site and authenticated console. Human sign-in uses the configured OIDC provider with authorization-code + PKCE; the API remains the authorization authority.

## Build configuration

- `VITE_API_BASE_URL`: HTTPS API origin only (no path), **required for the separate Render Static Site/API deployment**. Blank keeps same-origin `/api` and `/health` paths only for local proxy use.
- `VITE_OIDC_AUTHORITY`: HTTPS OIDC issuer/authority URL (HTTP loopback is accepted only while the frontend itself runs on loopback).
- `VITE_OIDC_CLIENT_ID`: public OIDC client identifier.
- `VITE_OIDC_AUDIENCE`: exact public API audience identifier; sign-in stays disabled if it is absent.
- `VITE_OIDC_SCOPE`: optional OIDC scope (defaults to `openid profile email`).

These values are embedded into public JavaScript. Do not configure secrets or private credentials with `VITE_*` names. For cross-origin deployment, set the API's `MANDATE_CORS_ALLOWED_ORIGINS` to the exact HTTPS origin of this frontend and register `/login/callback` plus `/` as the provider's callback and logout URLs.

## Local commands

```sh
npm ci
npm run typecheck
npm test -- --reporter=dot
npm run build
npm run lint
```

The development server proxies `/api` and `/health` to the local backend. For Render, set the static-site root to `frontend`, build with `npm ci --include=dev && npm run build`, and publish `dist`. Add the Render rewrite `/*` → `/index.html` for client-side routing.
