import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  current: { accessToken: 'human-session' as string | null, user: { access_token: 'human-session', profile: {} } as { access_token: string; profile: Record<string, string> } | null, loading: false, configured: true, error: null as string | null, returnTo: '/app/overview', signIn: vi.fn(async () => {}), signOut: vi.fn(async () => {}) },
}));

vi.mock('../src/auth/AuthProvider', () => ({ useAuth: () => authState.current }));
vi.mock('../src/app/VisualStage', () => ({ VisualStage: () => null }));

import { App } from '../src/app/App';

const invitationToken = 'A'.repeat(43);
let host: HTMLDivElement;
let root: Root;

function renderApp(): void {
  root.render(<MemoryRouter initialEntries={['/invitations/accept']}><App /></MemoryRouter>);
}

async function submitInvitation(token = invitationToken): Promise<void> {
  const input = host.querySelector<HTMLInputElement>('input[name="invitation-token"]');
  expect(input).not.toBeNull();
  await act(async () => {
    if (input !== null) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, token);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    host.querySelector<HTMLFormElement>('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.current = { ...authState.current, accessToken: 'human-session', user: { access_token: 'human-session', profile: {} }, loading: false, error: null };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/invitations/accept');
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('signed-in invitation acceptance', () => {
  it('accepts the token, refreshes /me, selects the joined organization, and opens its workspace', async () => {
    let accepted = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/v1/me') return Response.json({ principal: { type: 'HUMAN', subject: 'invitee' }, organizations: accepted ? [{ organizationId: 'joined-org', role: 'APPROVER' }] : [] });
      if (path === '/api/v1/invitations/accept') {
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer human-session');
        expect(JSON.parse(String(init?.body))).toEqual({ token: invitationToken });
        accepted = true;
        return Response.json({ organizationId: 'joined-org', role: 'APPROVER', accepted: true });
      }
      if (path === '/health/ready') return Response.json({ status: 'ready' });
      return Response.json({ agents: [], policies: [], actions: [], accounts: [], events: [], alerts: [] });
    });
    vi.stubGlobal('fetch', fetcher);

    await act(async () => { renderApp(); });
    await submitInvitation();

    expect(await host.querySelector('[aria-label="Organization joined-org"]')).not.toBeNull();
    expect(localStorage.getItem('mandate.organizationId')).toBe('joined-org');
    expect(fetcher.mock.calls.filter(([path]) => String(path) === '/api/v1/me')).toHaveLength(2);
    expect(window.location.href).not.toContain(invitationToken);
    expect(sessionStorage.getItem('mandate.pendingInvitationToken')).toBeNull();
  });

  it.each([
    [403, 'FORBIDDEN', 'verified email'],
    [404, 'RESOURCE_NOT_FOUND', 'does not match the signed-in verified email'],
    [409, 'RESOURCE_CONFLICT', 'expired'],
    [409, 'RESOURCE_CONFLICT', 'already been used, revoked, or closed'],
    [409, 'RESOURCE_CONFLICT', 'already have membership in this organization'],
  ])('shows a safe explanation for API rejection %s %s', async (status, code, message) => {
    const apiMessage = status === 409 ? (message === 'expired' ? 'INVITATION_EXPIRED' : message.includes('used') ? 'INVITATION_CLOSED' : 'ALREADY_MEMBER') : 'request failed';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/v1/me'
      ? Response.json({ principal: { type: 'HUMAN', subject: 'invitee' }, organizations: [] })
      : Response.json({ error: { code, message: apiMessage, requestId: 'req-test' } }, { status })));

    await act(async () => { renderApp(); });
    await submitInvitation();

    expect(host.textContent?.toLowerCase()).toContain(message.toLowerCase());
    expect(sessionStorage.getItem('mandate.pendingInvitationToken')).toBeNull();
  });

  it('reports transport failure without echoing or retaining the invitation token', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/me') return Response.json({ principal: { type: 'HUMAN', subject: 'invitee' }, organizations: [] });
      throw new TypeError(`network failure ${invitationToken}`);
    }));
    await act(async () => { renderApp(); });
    await submitInvitation();
    expect(host.textContent).toContain('Network error while accepting the invitation');
    expect(host.textContent).not.toContain(invitationToken);
    expect(sessionStorage.getItem('mandate.pendingInvitationToken')).toBeNull();
  });
});

it('retains an unauthenticated token only in session storage and resumes after OIDC sign-in', async () => {
  authState.current = { ...authState.current, accessToken: null, user: null };
  const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/v1/me'
    ? Response.json({ principal: { type: 'HUMAN', subject: 'invitee' }, organizations: [] })
    : Response.json({ organizationId: 'joined-org', role: 'VIEWER', accepted: true }));
  vi.stubGlobal('fetch', fetcher);
  await act(async () => { renderApp(); });
  await submitInvitation();

  expect(sessionStorage.getItem('mandate.pendingInvitationToken')).toBe(invitationToken);
  expect(window.location.href).not.toContain(invitationToken);
  expect(host.textContent).toContain('Continue with SSO');
  await act(async () => { host.querySelector<HTMLButtonElement>('button[data-testid="invitation-sso"]')?.click(); });
  expect(authState.current.signIn).toHaveBeenCalledWith('/invitations/accept');

  authState.current = { ...authState.current, accessToken: 'human-session', user: { access_token: 'human-session', profile: {} } };
  await act(async () => { root.render(<MemoryRouter initialEntries={['/invitations/accept']}><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });
  expect(fetcher.mock.calls.some(([path]) => String(path) === '/api/v1/invitations/accept')).toBe(true);
  expect(sessionStorage.getItem('mandate.pendingInvitationToken')).toBeNull();
});
