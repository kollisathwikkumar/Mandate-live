import { UserManager, WebStorageStateStore } from 'oidc-client-ts';

const authority = import.meta.env.VITE_OIDC_AUTHORITY?.trim() ?? '';
const clientId = import.meta.env.VITE_OIDC_CLIENT_ID?.trim() ?? '';
const audience = import.meta.env.VITE_OIDC_AUDIENCE?.trim() ?? '';
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

function hasTrustedAuthority(value: string): boolean {
  if (value === '') return false;
  try {
    const issuer = new URL(value);
    const localDevelopment = issuer.protocol === 'http:'
      && loopbackHosts.has(issuer.hostname)
      && loopbackHosts.has(window.location.hostname);
    return (issuer.protocol === 'https:' || localDevelopment)
      && issuer.username === '' && issuer.password === ''
      && issuer.search === '' && issuer.hash === '';
  } catch {
    return false;
  }
}

export const identityConfigured = hasTrustedAuthority(authority) && clientId.length > 0 && audience.length > 0;

export const identityManager = identityConfigured ? new UserManager({
  authority,
  client_id: clientId,
  redirect_uri: `${window.location.origin}/login/callback`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: 'code',
  scope: import.meta.env.VITE_OIDC_SCOPE?.trim() || 'openid profile email',
  // Auth0 needs the API audience to issue a signed access token for Mandate's API.
  // This is public OAuth request metadata, not a credential.
  extraQueryParams: { audience },
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  automaticSilentRenew: true,
  loadUserInfo: false,
}) : null;
