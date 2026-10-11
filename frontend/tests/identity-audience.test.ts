import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('configures the API audience while keeping the OIDC Authorization Code flow', async () => {
  vi.stubEnv('VITE_OIDC_AUTHORITY', 'https://mandate-demo.example.auth0.com/');
  vi.stubEnv('VITE_OIDC_CLIENT_ID', 'public-spa-client-id');
  vi.stubEnv('VITE_OIDC_AUDIENCE', 'https://mandate-api.example');
  vi.stubEnv('VITE_OIDC_SCOPE', 'openid profile email');

  const identity = await import('../src/auth/identity');

  expect(identity.identityConfigured).toBe(true);
  expect(identity.identityManager?.settings.response_type).toBe('code');
  expect(identity.identityManager?.settings.extraQueryParams).toMatchObject({ audience: 'https://mandate-api.example' });
  expect(identity.identityManager?.settings.disablePKCE).not.toBe(true);
  expect(identity.identityManager?.settings.redirect_uri).toBe(`${window.location.origin}/login/callback`);
  expect(identity.identityManager?.settings.post_logout_redirect_uri).toBe(`${window.location.origin}/`);
  expect(identity.identityManager?.settings.client_id).toBe('public-spa-client-id');
});

it('allows an HTTP issuer only for a loopback browser origin', async () => {
  vi.stubEnv('VITE_OIDC_AUTHORITY', 'http://127.0.0.1:8080/');
  vi.stubEnv('VITE_OIDC_CLIENT_ID', 'public-spa-client-id');
  vi.stubEnv('VITE_OIDC_AUDIENCE', 'mandate-local-api');

  const identity = await import('../src/auth/identity');

  expect(identity.identityConfigured).toBe(true);
  expect(identity.identityManager?.settings.authority).toBe('http://127.0.0.1:8080/');
});

it('does not report OIDC ready when the API audience is missing', async () => {
  vi.stubEnv('VITE_OIDC_AUTHORITY', 'https://mandate-demo.example.auth0.com/');
  vi.stubEnv('VITE_OIDC_CLIENT_ID', 'public-spa-client-id');
  vi.stubEnv('VITE_OIDC_AUDIENCE', '');

  const identity = await import('../src/auth/identity');

  expect(identity.identityConfigured).toBe(false);
  expect(identity.identityManager).toBeNull();
});

it.each([
  'http://identity.example.test/',
  'https://user:password@identity.example.test/',
  'https://identity.example.test/?unexpected=query',
  'https://identity.example.test/#fragment',
  'not-an-issuer',
])('fails closed for an unsafe OIDC issuer %s', async (authority) => {
  vi.stubEnv('VITE_OIDC_AUTHORITY', authority);
  vi.stubEnv('VITE_OIDC_CLIENT_ID', 'public-spa-client-id');
  vi.stubEnv('VITE_OIDC_AUDIENCE', 'https://mandate-api.example');

  const identity = await import('../src/auth/identity');

  expect(identity.identityConfigured).toBe(false);
  expect(identity.identityManager).toBeNull();
});
