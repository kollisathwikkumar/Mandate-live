import { AnimatePresence, motion, useReducedMotion, useScroll } from 'motion/react';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, CircleNotch, Copy, Fingerprint, Key, LockKey, List as Menu, Plus, ShieldCheck, SignOut, Sparkle, X } from '@phosphor-icons/react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { createContext, useContext, useCallback, useEffect, useId, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { safeReturnTo } from '../auth/returnTo';
import { useAuth } from '../auth/AuthProvider';
import { useMutationTransport } from '../api/mutationTransport';
import { clearAgentRegistrationIntent, getAgentRegistrationIntentKey, parseAgentRegistrationResponse } from '../api/agentRegistration';
import { ApiFailure, request } from '../api/client';
import { apiFetch, resolveApiUrl } from '../api/url';
import { AccountListSchema, AccountResultSchema, ActionListSchema, ActionSchema, AgentListSchema, AlertsSchema, AuditEventsSchema, HumanProfileSchema, InvitationAcceptedSchema, InvitationCreatedSchema, InvitationsSchema, MembersSchema, PolicyActivationFinalizedSchema, PolicyListSchema, PolicyRevisionSchema, PolicyRevocationFinalizedSchema, PolicySignaturePlanSchema, ProviderTestSchema, ProvidersSchema, ReceiptsSchema, WebhookCreatedSchema, WebhookDeliveriesSchema, WebhookRotatedSchema, WebhookRotationReplaySchema, WebhookReplaySchema, WebhooksSchema } from '../api/schemas';
import type { ActionDetail, ActionList, AccountList, AgentList, Alerts, AuditEvents, HumanProfile, Invitations, Members, PolicyList, PolicyRevision, Providers, Receipts, WebhookDeliveries, Webhooks } from '../api/schemas';
import { ROUTE_MANIFEST, matchRoute } from './routeManifest';
import { getActivityDetailHref } from './activityLinks';
import { canSwitchOrganization } from './organizationPicker';
import { buildAuthorizationPath } from './authorizationPathModel';
import { buildOverviewMetrics } from './overviewMetrics';
import { apiReadinessState } from './apiReadinessState';
import { getPolicyEditorState } from './policyEditorState';
import { validatePolicyDraftReferences } from './policyDraftReferences';
import { RESOURCE_ID_PATTERN } from './inputPatterns';
import { canVerifyAccount } from './accountVerificationAction';
import { receiptExplorerUrl } from './receiptExplorer';
import { getMagneticOffset } from './magneticAction';
import { buildActivationPreparationBody, getActivationPrepareKey, type ActivationPrepareKey } from './provisioningActivation';
import { AuthorityStory } from './AuthorityStory';
import { LifecycleEvidence } from './LifecycleEvidence';
import { AgentPermissionScope } from './AgentPermissionScope';
import { z } from 'zod';



const PUBLIC_ROUTES = ROUTE_MANIFEST.filter((route) => route.audience === 'public');
const appRoutes = ROUTE_MANIFEST.filter((route) => route.audience === 'app');

export function useApi<T>(path: string | null, schema: Parameters<typeof request<T>>[1], refreshKey = 0) {
  const { accessToken } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const refetch = useCallback(() => setReload((n) => n + 1), []);
  useEffect(() => {
    if (path === null || accessToken === null) { setLoading(false); setData(null); setError(null); return; }
    const controller = new AbortController();
    // Never keep the previous tenant's payload visible while a new scoped request loads.
    setLoading(true); setData(null); setError(null);
    void request(path, schema, { token: accessToken, signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((failure: Error) => { if (!controller.signal.aborted && failure.name !== 'AbortError') setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [accessToken, path, schema, reload, refreshKey]);
  return { data, error, loading, refetch };
}

function useOrganizationState() {
  const { accessToken } = useAuth();
  const { data: fetchedProfile, loading, error } = useApi<HumanProfile>(accessToken === null ? null : '/api/v1/me', HumanProfileSchema);
  const [refreshedProfile, setRefreshedProfile] = useState<HumanProfile | null>(null);
  const [selectedId, setSelectedId] = useState(() => window.localStorage.getItem('mandate.organizationId') ?? '');
  const profile = refreshedProfile ?? fetchedProfile;
  const memberships = profile?.organizations ?? [];
  const selected = memberships.find((member) => member.organizationId === selectedId) ?? memberships[0];
  useEffect(() => {
    if (selected !== undefined && selected.organizationId !== selectedId) {
      setSelectedId(selected.organizationId); window.localStorage.setItem('mandate.organizationId', selected.organizationId);
    }
  }, [selected, selectedId]);
  useEffect(() => { setRefreshedProfile(null); }, [accessToken]);
  const refreshProfile = useCallback(async (): Promise<HumanProfile> => {
    if (accessToken === null) throw new Error('Sign in before refreshing workspace membership.');
    const refreshed = await request('/api/v1/me', HumanProfileSchema, { token: accessToken });
    setRefreshedProfile(refreshed);
    return refreshed;
  }, [accessToken]);
  const choose = (id: string) => { setSelectedId(id); window.localStorage.setItem('mandate.organizationId', id); };
  return { profile, memberships, organizationId: selected?.organizationId ?? null, role: selected?.role ?? null, loading, error, choose, refreshProfile };
}

const OrganizationContext = createContext<ReturnType<typeof useOrganizationState> | null>(null);
function useOrganization() {
  const organization = useContext(OrganizationContext);
  if (organization === null) throw new Error('Organization provider is required');
  return organization;
}

function AnimatedContent({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

function Brand({ small = false }: { small?: boolean }) {
  return <Link className={`brand ${small ? 'brand-small' : ''}`} to="/" aria-label="Mandate home"><span className="brand-logo" aria-hidden="true">M_</span><span>mandate</span></Link>;
}

function useMagneticAction<T extends HTMLElement>() {
  const reduceMotion = useReducedMotion();
  const onPointerMove = useCallback((event: ReactPointerEvent<T>) => {
    if (reduceMotion || event.pointerType !== 'mouse') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = getMagneticOffset(event.clientX, event.clientY, bounds);
    event.currentTarget.style.setProperty('--magnetic-x', `${offset.x.toFixed(2)}px`);
    event.currentTarget.style.setProperty('--magnetic-y', `${offset.y.toFixed(2)}px`);
  }, [reduceMotion]);
  const onPointerLeave = useCallback((event: ReactPointerEvent<T>) => {
    event.currentTarget.style.setProperty('--magnetic-x', '0px');
    event.currentTarget.style.setProperty('--magnetic-y', '0px');
  }, []);
  return { onPointerMove, onPointerLeave };
}

function MarketingNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const magnetic = useMagneticAction<HTMLAnchorElement>();
  return <header className="marketing-nav"><Brand />
    <nav className={menuOpen ? 'nav-links open' : 'nav-links'} aria-label="Main navigation">
      {PUBLIC_ROUTES.filter((route) => route.path !== '/').map((route) => <Link key={route.id} to={route.path} onClick={() => setMenuOpen(false)}>{route.title}</Link>)}
    </nav>
    <div className="nav-actions"><Link className="nav-login" to="/login">Sign in</Link><Link className="button button-small button-outline magnetic-action" to="/login" {...magnetic}>Open console <ArrowUpRight size={15} /></Link></div>
    <button className="icon-button menu-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
  </header>;
}

function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <AnimatedContent className={className}>{children}</AnimatedContent>;
}

function PageScrollProgress() {
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  return <motion.div className="page-scroll-progress" aria-hidden="true" style={{ scaleX: reduceMotion ? 0 : scrollYProgress }} />;
}

function PublicLayout({ children }: { children: ReactNode }) {
  return <div className="public-frame"><MarketingNav />{children}<footer className="site-footer"><Brand small /><span>Policy first. Execution bounded. Evidence always.</span><span>© 2026 Mandate</span></footer></div>;
}

const workflowSteps = [
  { number: '01', title: 'Define the boundary', text: 'Bind an agent, account, chain, target, allowed selectors, recipients, limits, and validity window into a versioned policy.' },
  { number: '02', title: 'Evaluate deterministically', text: 'Mandate evaluates a typed action intent against that policy. Unsupported inputs and missing prerequisites fail closed.' },
  { number: '03', title: 'Reserve & approve', text: 'The coordinator reserves permitted capacity. If the policy requires a human decision, an approver reviews the exact action hash.' },
  { number: '04', title: 'Enforce at execution', text: 'An adapter checks authorization at the account boundary. The browser preflights; it is not the enforcement point.' },
  { number: '05', title: 'Reconcile evidence', text: 'The indexer observes chain receipts and reorg state. Audit events and webhook delivery record the resulting lifecycle.' },
];

function HomePage() {
  return <PublicLayout><main className="cinematic-home">
    <section className="cinematic-hero"><div className="hero-kicker"><span className="eyebrow">MANDATE / AUTHORITY INFRASTRUCTURE</span><span>01 — CONTROL BEFORE EXECUTION</span></div>
      <h1>Autonomous agents.<br /><span>Explicit authority.</span></h1>
      <div className="cinematic-hero-bottom"><p>Define the boundary. Enforce the decision.<br />Keep the evidence.<small>An authorization control plane for actions that matter.</small></p><div className="hero-actions"><Link className="button button-primary" to="/app/overview">Open control plane <ArrowUpRight size={17} /></Link><a className="button button-outline" href="#authority-story">Explore the boundary <ArrowDown size={17} /></a></div></div>
      <div className="capability-strip"><span>IDENTITY <strong>Scoped agents</strong></span><span>POLICY <strong>Explicit constraints</strong></span><span>EXECUTION <strong>Boundary enforcement</strong></span><span>EVIDENCE <strong>Distinct lifecycle states</strong></span></div>
    </section>
    <AuthorityStory />
    <section className="console-handoff"><p className="eyebrow">THE OPERATIONAL PRODUCT</p><h2>Authority you can inspect.</h2><p>The console reads tenant-scoped backend records. A preflight is not an authorization; a submitted action is not a settled transaction.</p><div><Link to="/app/policies">Policies ↗</Link><Link to="/app/agents">Agent identities ↗</Link><Link to="/app/approvals">Human decisions ↗</Link><Link to="/app/activity">Evidence ↗</Link></div></section>
  </main></PublicLayout>;
}

function HowItWorksPage() {
  return <PublicLayout><main className="editorial-page"><div className="editorial-hero"><p className="eyebrow">How it works / lifecycle</p><h1>From a rule<br />to a <em>receipt.</em></h1><p>Mandate separates policy decisions from execution, then connects each transition with durable evidence.</p></div><div className="lifecycle-rail">{workflowSteps.map((step, index) => <Reveal className="lifecycle-step" key={step.number}><span>{step.number} / {['POLICY', 'EVALUATE', 'RESERVE', 'EXECUTE', 'RECONCILE'][index]}</span><h2>{step.title}</h2><p>{step.text}</p></Reveal>)}</div><div className="callout"><ShieldCheck size={20} /><p><strong>Important distinction:</strong> a policy simulation is a read-only preflight result. It does not sign, submit, or simulate an on-chain transaction. Runtime enforcement belongs to the supported account/tool adapter.</p></div><p className="source-note">Capabilities shown here describe the current Mandate architecture and backend contract. Supported adapters and workflows remain intentionally bounded.</p></main></PublicLayout>;
}

function SecurityPage() {
  const controls = [
    ['Deterministic policy', 'Typed policy revisions bind account, agent, chain, target, selectors, recipients, value limits, and validity windows. Unknown terms are rejected.'],
    ['Human authorization', 'Role checks protect organization and approval operations. Decisions attach to the exact action hash and require an idempotency key.'],
    ['Tenant isolation', 'Organization scope is explicit in API routes and enforced in application services; membership is checked server-side.'],
    ['Execution-boundary checks', 'The UI performs preflight only. Supported account adapters are the final enforcement point, with reservations and replay controls.'],
    ['Credential handling', 'OIDC bearer tokens are held for the browser session. Provider API keys are sent only to the backend credential endpoint and are never re-displayed.'],
    ['Audit and chain evidence', 'Append-only audit events, receipt reconciliation, tentative/final states, and reorg events make the lifecycle inspectable.'],
  ];
  return <PublicLayout><main className="editorial-page"><div className="editorial-hero"><p className="eyebrow">Security / boundaries over promises</p><h1>Secure by<br /><em>construction.</em></h1><p>Security controls work together across identity, policy, approvals, execution, and evidence. No single UI state grants authority.</p></div><div className="security-grid">{controls.map(([title, text], index) => <Reveal className="security-card" key={title}><span>0{index + 1}</span><h2>{title}</h2><p>{text}</p></Reveal>)}</div><div className="callout"><LockKey size={20} /><p>Protection depends on correct deployment configuration, supported account setup, key management, and operational monitoring. This page describes implemented architecture controls, not an independent security certification.</p></div></main></PublicLayout>;
}

function IntegrationsPage() {
  const cards = [['EVM smart accounts', 'Supported account adapter for the configured chain and policy transfer subset. Account verification is explicit before activation.'], ['REST API', 'Bearer-authenticated, tenant-scoped endpoints with typed requests, idempotency keys, and OpenAPI contract.'], ['TypeScript SDK source', 'The in-repository client delegates to the same API contract. A published installable SDK package is a separate release step.'], ['MCP', 'Thin wrappers share the same authorization path. Read, list, and simulate are distinct from human-confirmed actions.'], ['CLI', 'Automation-friendly API workflows with explicit organization and action identifiers.'], ['Model providers', 'Organization administrators can store provider credentials in the backend secret adapter; model keys never authorize chain execution.']];
  return <PublicLayout><main className="editorial-page"><div className="editorial-hero"><p className="eyebrow">Integrations / connect by contract</p><h1>One policy.<br /><em>Many interfaces.</em></h1><p>Every interface reaches the same deterministic authorization services. The adapter—not the interface—enforces at execution.</p></div><div className="integration-list">{cards.map(([title, text], index) => <Reveal className="integration-row" key={title}><span>0{index + 1}</span><h2>{title}</h2><p>{text}</p><span className="integration-state">API-ALIGNED</span></Reveal>)}</div></main></PublicLayout>;
}

function DevelopersPage() {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const example = 'const mandate = await MandateClient.connect({ apiUrl, token, organizationId });\nconst result = await mandate.simulateAction(actionIntent);';
  async function copyExample() { try { await navigator.clipboard.writeText(example); setCopyState('copied'); } catch { setCopyState('error'); } }
  return <PublicLayout>
    <main className="editorial-page developer-page">
      <div className="developer-content">
        <Reveal className="developer-hero-reveal"><div className="editorial-hero"><p className="eyebrow">Developers / start with the boundary</p><h1>Build on the<br /><em>authorization path.</em></h1><p>Use typed policy revisions and exact action intents. Keep enforcement and credentials out of the browser.</p></div></Reveal>
        <Reveal className="developer-code-reveal"><div className="code-window">
          <div className="code-top"><span><i /> <i /> <i /></span><span>TypeScript SDK · server-side</span><button className="copy-control" onClick={() => void copyExample()}><Copy size={14} /> {copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy unavailable' : 'Copy example'}</button></div>
          {copyState === 'error' && <p className="form-error" role="status">Clipboard access failed. Select and copy the snippet manually.</p>}
          <pre><code><span className="code-purple">const</span> mandate = <span className="code-purple">await</span> MandateClient.connect({'{'} apiUrl, token, organizationId {'}'});{'\n'}<span className="code-purple">const</span> result = <span className="code-purple">await</span> mandate.simulateAction(actionIntent);{'\n\n'}<span className="code-comment">// Preflight only — never a transaction or signature.</span>{'\n'}<span className="code-purple">if</span> (result.verdict !== <span className="code-green">'ALLOW'</span>) {'{'}{'\n'}  <span className="code-purple">throw new</span> Error(result.reason);{'\n'}{'}'}</code></pre>
        </div></Reveal>
        <p className="source-note">This example targets the in-repository TypeScript SDK source. A published package and stable npm import path are not yet available.</p>
        <Reveal className="developer-notes"><div><p className="eyebrow">Integration sequence</p><h2>Identity → scope → intent → evidence</h2><p>Authenticate the human through OIDC and discover memberships with <code>GET /api/v1/me</code>. Include an explicit organization in all organization-bound calls. Send idempotency keys for state-changing operations, handle typed errors and <code>204</code> responses, then reconcile receipts and audit events.</p></div><div className="developer-links"><a href={resolveApiUrl('/api/v1/openapi.json')} target="_blank" rel="noreferrer">Open API contract <ArrowUpRight size={15} /></a><Link to="/security">Security boundaries <ArrowRight size={15} /></Link><Link to="/login">Open console <ArrowRight size={15} /></Link></div></Reveal>
      </div>
    </main>
  </PublicLayout>;
}

function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const magnetic = useMagneticAction<HTMLButtonElement>();
  useEffect(() => { if (auth.user !== null) navigate(safeReturnTo(new URLSearchParams(window.location.search).get('returnTo')), { replace: true }); }, [auth.user, navigate]);
  return <PublicLayout><main className="login-page"><div className="login-card"><div className="login-mark"><Fingerprint size={25} /></div><p className="eyebrow">Mandate control plane</p><h1>Sign in to<br /><em>your boundary.</em></h1><p>Continue with SSO opens your organization’s sign-in service. That prompt belongs to your identity provider—not Mandate. Mandate has no separate local username or password and never receives your provider password or a model API key.</p>{auth.configured ? <button className="button button-primary login-button magnetic-action" onClick={() => void auth.signIn()} {...magnetic}>Continue with SSO <ArrowRight size={17} /></button> : <div className="configuration-note"><Key size={18} /><div><strong>Identity provider not configured</strong><span>Set a valid HTTPS VITE_OIDC_AUTHORITY, VITE_OIDC_CLIENT_ID, and VITE_OIDC_AUDIENCE to enable sign-in.</span></div></div>}<p role="alert">{auth.error}</p><small>OIDC authorization code · PKCE · bearer token</small></div></main></PublicLayout>;
}

const INVITATION_ROUTE = '/invitations/accept';
const PENDING_INVITATION_KEY = 'mandate.pendingInvitationToken';
const invitationTokenPattern = /^[A-Za-z0-9_-]{40,128}$/;
type InvitationAcceptanceState = 'ready' | 'awaiting-sign-in' | 'accepting' | 'accepted' | 'failed';

function invitationAcceptanceMessage(failure: Error): string {
  if (!(failure instanceof ApiFailure)) return 'Network error while accepting the invitation. Check your connection and try again with the invitation token.';
  if (failure.status === 401) return 'Your sign-in session has expired. Sign in again, then retry the invitation.';
  if (failure.status === 403) return 'Your identity provider did not provide a verified email. Use an account with a verified email address matching the invitation.';
  if (failure.status === 404) return 'The invitation is invalid or does not match the signed-in verified email. Check the token and use the invited account.';
  if (failure.status === 409 && failure.message === 'INVITATION_EXPIRED') return 'This invitation has expired. Ask the organization owner or administrator for a new invitation.';
  if (failure.status === 409 && failure.message === 'ALREADY_MEMBER') return 'You already have membership in this organization.';
  if (failure.status === 409 && failure.message === 'INVITATION_CLOSED') return 'This invitation has already been used, revoked, or closed. Ask for a new invitation if you still need access.';
  return 'The invitation could not be accepted. Retry or ask the organization owner to issue a new invitation.';
}

function InvitationAcceptancePage() {
  const auth = useAuth();
  const organization = useOrganization();
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [state, setState] = useState<InvitationAcceptanceState>('ready');
  const [message, setMessage] = useState<string | null>(null);
  const [acceptedOrganizationId, setAcceptedOrganizationId] = useState<string | null>(null);
  const processing = useRef(false);

  const openJoinedWorkspace = async (organizationId: string) => {
    setState('accepting');
    setMessage(null);
    try {
      const profile = await organization.refreshProfile();
      if (!profile.organizations.some((membership) => membership.organizationId === organizationId)) {
        throw new Error('Membership refresh did not include the accepted organization.');
      }
      organization.choose(organizationId);
      navigate('/app/overview', { replace: true });
    } catch {
      setAcceptedOrganizationId(organizationId);
      setState('accepted');
      setMessage('Invitation accepted. Workspace membership could not be refreshed yet; retry to open the workspace.');
    }
  };

  const acceptToken = async (invitationToken: string) => {
    if (processing.current || auth.accessToken === null) return;
    processing.current = true;
    setState('accepting');
    setMessage(null);
    setToken('');
    try { sessionStorage.removeItem(PENDING_INVITATION_KEY); } catch { /* The token is still held only in this component's memory. */ }
    try {
      const result = await request('/api/v1/invitations/accept', InvitationAcceptedSchema, {
        token: auth.accessToken,
        method: 'POST',
        body: { token: invitationToken },
      });
      setAcceptedOrganizationId(result.organizationId);
      await openJoinedWorkspace(result.organizationId);
    } catch (failure) {
      setState('failed');
      setMessage(invitationAcceptanceMessage(failure instanceof Error ? failure : new Error('Invitation request failed.')));
    } finally {
      processing.current = false;
    }
  };

  useEffect(() => {
    if (auth.loading || auth.accessToken === null) return;
    let pending: string | null;
    try { pending = sessionStorage.getItem(PENDING_INVITATION_KEY); }
    catch { setState('failed'); setMessage('This browser could not retain the invitation for sign-in. Enter the invitation token again.'); return; }
    if (pending === null) return;
    try { sessionStorage.removeItem(PENDING_INVITATION_KEY); } catch { /* acceptToken also removes it before the request. */ }
    if (!invitationTokenPattern.test(pending)) {
      setState('failed');
      setMessage('The saved invitation token has an invalid format. Enter the token again.');
      return;
    }
    void acceptToken(pending);
  }, [auth.accessToken, auth.loading, acceptToken]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = token.trim();
    if (!invitationTokenPattern.test(normalized)) {
      setState('failed');
      setMessage('Enter the invitation token in its supported format (40–128 letters, numbers, hyphens, or underscores).');
      return;
    }
    setMessage(null);
    if (auth.accessToken !== null) {
      void acceptToken(normalized);
      return;
    }
    try {
      sessionStorage.setItem(PENDING_INVITATION_KEY, normalized);
      setToken('');
      setState('awaiting-sign-in');
    } catch {
      setState('failed');
      setMessage('This browser could not securely retain the invitation for sign-in. Keep the token and try again after enabling session storage.');
    }
  }

  return <PublicLayout><main className="login-page"><section className="login-card invitation-card">
    <div className="login-mark"><Fingerprint size={25} /></div>
    <p className="eyebrow">Organization access</p>
    <h1>Accept your<br /><em>invitation.</em></h1>
    <p>Sign in with the account whose verified email received the invitation. Mandate checks the token and email with the organization API before adding membership.</p>
    {auth.loading ? <div className="callback-state"><CircleNotch className="spin" size={20} />Restoring your sign-in…</div> : state === 'awaiting-sign-in' ? <div className="form-stack"><p role="status">Invitation saved for this tab. Continue with your organization identity provider to redeem it.</p><button className="button button-primary login-button" data-testid="invitation-sso" disabled={!auth.configured} onClick={() => void auth.signIn(INVITATION_ROUTE)}>Continue with SSO <ArrowRight size={17} /></button>{!auth.configured && <p className="form-error">Identity provider is not configured.</p>}</div> : state === 'accepted' ? <div className="form-stack"><p role="status" className="success-note">{message}</p><button className="button button-primary" disabled={acceptedOrganizationId === null} onClick={() => { if (acceptedOrganizationId !== null) void openJoinedWorkspace(acceptedOrganizationId); }}>Refresh membership and open workspace</button></div> : <form className="form-stack" onSubmit={submit}>
      <label htmlFor="invitation-token">One-time invitation token</label>
      <input id="invitation-token" name="invitation-token" type="password" autoComplete="off" spellCheck={false} minLength={40} maxLength={128} value={token} onChange={(event) => setToken(event.target.value)} required />
      {message && <p role="alert" className="form-error">{message}</p>}
      <button className="button button-primary" disabled={state === 'accepting'}>{state === 'accepting' ? 'Checking invitation…' : 'Accept invitation'}</button>
      {auth.accessToken === null && <small>After entering the token, you’ll sign in through OIDC. The token stays in this tab and is not placed in the URL.</small>}
    </form>}
    <p role="alert" className="form-error">{auth.error}</p>
  </section></main></PublicLayout>;
}

function LoginCallback() {
  const auth = useAuth();
  if (auth.loading) return <main className="callback-state"><CircleNotch className="spin" size={24} />Completing secure sign-in…</main>;
  if (auth.error) return <main className="callback-state"><p role="alert">{auth.error}</p><Link to="/login">Try sign-in again</Link></main>;
  return <Navigate to={auth.user === null ? '/login' : auth.returnTo} replace />;
}

function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading) return <main className="callback-state"><CircleNotch className="spin" size={24} />Restoring your session…</main>;
  if (auth.user === null) return <Navigate to={`/login?returnTo=${encodeURIComponent(safeReturnTo(location.pathname + location.search + location.hash))}`} replace />;
  return children;
}

const appNav: { readonly label: string; readonly links: readonly (readonly [string, string])[] }[] = [
  { label: 'Workspace', links: [['Overview', '/app/overview'], ['Agents', '/app/agents'], ['Policies', '/app/policies'], ['Approvals', '/app/approvals'], ['Activity', '/app/activity']] },
  { label: 'Configure', links: [['Team', '/app/settings/team'], ['Accounts', '/app/settings/accounts'], ['Integrations', '/app/settings/integrations']] },
];

function AppShell({ children }: { children: ReactNode }) {
  const mutate = useMutationTransport();
  const { user, signOut, error: authError } = useAuth();
  const org = useOrganization();
  const [mobileNav, setMobileNav] = useState(false);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [organizationName, setOrganizationName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const canSwitch = canSwitchOrganization(org.memberships.length);
  const title = ROUTE_MANIFEST.find((route) => route.path === location.pathname)?.title ?? (location.pathname.includes('/agents/') ? 'Agent detail' : location.pathname.includes('/policies/') ? 'Policy' : 'Activity detail');
  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (user === null) return;
    setSaving(true); setFormError(null);
    try {
      const response = await mutate('/api/v1/orgs', { method: 'POST', headers: { Authorization: `Bearer ${user.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: organizationName }) });
      const result = await response.json();
      if (!response.ok) throw new Error('Organization could not be created. Check your role and try again.');
      const organization = typeof result === 'object' && result !== null && 'organization' in result ? result.organization : null;
      const createdId = typeof organization === 'object' && organization !== null && 'organizationId' in organization && typeof organization.organizationId === 'string' ? organization.organizationId : '';
      if (createdId.length > 0) { org.choose(createdId); setCreateOpen(false); navigate('/app/overview'); window.location.reload(); }
      else setFormError('The organization was created, but its identifier was not returned. Refresh your memberships.');
    } catch (failure) { setFormError(failure instanceof Error ? failure.message : 'Request failed'); }
    finally { setSaving(false); }
  }
  return <div className="console-shell">
    <aside className={`console-sidebar ${mobileNav ? 'sidebar-open' : ''}`}><div className="sidebar-brand"><Brand small /><button className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X /></button></div><button className="org-picker" disabled={!canSwitch} aria-haspopup={canSwitch ? 'menu' : undefined} aria-expanded={canSwitch ? orgMenuOpen : undefined} aria-label={canSwitch ? `Switch organization; current ${org.organizationId ?? 'workspace'}` : `Organization ${org.organizationId ?? 'not selected'}`} onClick={() => { if (canSwitch) setOrgMenuOpen((open) => !open); }}><span className="org-avatar">{org.organizationId?.slice(0, 1).toUpperCase() ?? 'M'}</span><span><strong>{org.organizationId ?? 'No workspace'}</strong><small>{org.role ?? 'Organization'}</small></span>{canSwitch && <span className="chevron">⌄</span>}</button>{canSwitch && <div className={`org-menu ${orgMenuOpen ? 'visible' : ''}`} id="org-menu" role="menu">{org.memberships.map((item) => <button role="menuitem" key={item.organizationId} onClick={() => { org.choose(item.organizationId); setOrgMenuOpen(false); }}>{item.organizationId}<small>{item.role}</small></button>)}</div>}
      <div className="sidebar-nav">{appNav.map((group) => <div className="nav-group" key={group.label}><span>{group.label}</span>{group.links.map(([label, href]) => <Link key={href} to={href} onClick={() => setMobileNav(false)} className={location.pathname === href || (href === '/app/policies' && location.pathname.startsWith('/app/policies/')) || (href === '/app/activity' && location.pathname.startsWith('/app/activity/')) ? 'active' : ''}><span className="nav-bullet" />{label}{label === 'Approvals' && <span className="nav-dot" />}</Link>)}</div>)}</div>
      <div className="sidebar-bottom"><BackendHealthBadge /><div className="user-mini"><div className="user-avatar">{user?.profile.email?.toString().slice(0, 1).toUpperCase() ?? 'U'}</div><span><strong>{user?.profile.email?.toString() ?? 'Signed in'}</strong><small>{user?.profile.name?.toString() ?? 'Organization member'}</small></span><button aria-label="Sign out" className="icon-button" onClick={() => void signOut()}><SignOut size={17} /></button></div></div>
    </aside>
    {mobileNav && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <main className="console-main"><header className="console-topbar"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu /></button><div className="breadcrumb"><span>Console</span><span>/</span><strong>{title}</strong></div><div className="topbar-actions"><span className="env-pill">HUMAN CONTROL PLANE</span><button className="avatar-button" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}>{user?.profile.email?.toString().slice(0, 1).toUpperCase() ?? 'U'}</button></div></header><div className="console-content">{authError && <p role="alert" className="form-error">{authError}</p>}{org.loading ? <LoadingState label="Loading your organization…" /> : org.error ? <ErrorState message={org.error} /> : org.memberships.length === 0 ? <section className="empty-workspace"><div className="section-icon"><Fingerprint size={24} /></div><p className="eyebrow">Workspace not found</p><h1>Create your first workspace.</h1><p>Your identity has no Mandate memberships yet. Create an organization or accept an invitation from an existing owner.</p><div className="header-actions"><button className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> Create organization</button><Link className="button button-outline" to={INVITATION_ROUTE}>Accept an invitation <ArrowRight size={16} /></Link></div></section> : <Reveal key={org.organizationId} className="console-route-reveal">{children}</Reveal>}</div></main>
    <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create organization"><form className="form-stack" onSubmit={(event) => void createOrganization(event)}><label>Organization name<input required minLength={2} maxLength={120} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} /></label>{formError && <p className="form-error">{formError}</p>}<button className="button button-primary" disabled={saving}>{saving ? 'Creating…' : 'Create organization'}</button></form></Modal>
  </div>;
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <Reveal className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</Reveal>;
}

function BackendHealthBadge() {
  const org = useOrganization();
  const status = apiReadinessState(org.loading, org.error, org.profile !== null);
  return <div className={`boundary-mini health-${status}`}><span className={`health-dot health-dot-${status}`} /> API connection <span className="mini-value" title={status === 'unavailable' ? 'The authenticated API profile request failed; retry after the free API wakes.' : undefined}>{status === 'ready' ? 'Connected' : status === 'checking' ? 'Checking' : 'Unavailable · may be waking (about 1 min)'}</span></div>;
}
function LoadingState({ label = 'Loading organization data…' }: { label?: string }) { return <div className="loading-state"><CircleNotch className="spin" size={19} />{label}</div>; }
function ErrorState({ message, onRetry, retryLabel = 'Retry' }: { message: string; onRetry?: () => void; retryLabel?: string }) { return <div className="error-state"><span>Request failed</span><p>{message}</p>{onRetry && <button className="button button-outline" type="button" onClick={onRetry}>{retryLabel}</button>}</div>; }
function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) { return <div className="empty-state"><div className="section-icon"><Sparkle size={21} /></div><h3>{title}</h3><p>{body}</p>{action}</div>; }
function DataTable({ columns, rows, emptyTitle = 'Nothing to show yet', emptyText = 'New activity will appear here when the backend records it.' }: { columns: string[]; rows: ReactNode[][]; emptyTitle?: string; emptyText?: string }) { return rows.length === 0 ? <EmptyState title={emptyTitle} body={emptyText} /> : <Reveal className="table-reveal"><div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={`${index}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div></Reveal>; }

function AppOverviewPage() {
  const org = useOrganization();
  const base = org.organizationId === null ? null : `/api/v1/orgs/${encodeURIComponent(org.organizationId)}`;
  const agents = useApi<AgentList>(base === null ? null : `${base}/agents`, AgentListSchema);
  const accounts = useApi<AccountList>(base === null ? null : `${base}/accounts`, AccountListSchema);
  const policies = useApi<PolicyList>(base === null ? null : `${base}/policies`, PolicyListSchema);
  const alerts = useApi<Alerts>(base === null ? null : `${base}/alerts?limit=5`, AlertsSchema);
  const receipts = useApi<Receipts>(base === null ? null : `${base}/receipts?limit=5`, ReceiptsSchema);
  const held = useApi<ActionList>(base === null ? null : `${base}/actions?state=HELD&limit=5`, ActionListSchema);
  const authorizationPath = buildAuthorizationPath({
    agents: agents.data?.agents ?? [],
    policies: policies.data?.policies ?? [],
    accounts: accounts.data?.accounts ?? [],
    receipts: receipts.data?.receipts ?? [],
  });
  const pathLoading = agents.loading || policies.loading || accounts.loading || receipts.loading;
  const metrics = buildOverviewMetrics({ agents, policies, receipts, alerts });
  return <div className="overview-content"><PageHeader eyebrow="Control plane / overview" title="Overview" description="A live view of registered agents, policy state, and recent execution evidence." action={<Link to="/app/policies/new" className="button button-primary"><Plus size={16} /> New policy</Link>} />
    <Reveal className="metric-grid">{metrics.map((metric) => <Link to={metric.href} className="metric-card" key={metric.label}><span>{metric.label}</span><strong className={metric.value === 'Unavailable' ? 'metric-value-unavailable' : undefined}>{metric.value}</strong><small>{metric.note}</small></Link>)}</Reveal>
    {agents.error && <ErrorState message={agents.error} />}{policies.error && <ErrorState message={policies.error} />}{accounts.error && <ErrorState message={accounts.error} />}
    <Reveal className="panel authorization-path-panel"><div className="panel-heading"><div><p className="eyebrow">Live authorization path</p><h2>Identity → policy → account → evidence</h2></div><Link to="/app/activity" className="text-link">Review evidence <ArrowRight size={15} /></Link></div><p className="authorization-path-intro">Workspace state from the API. Green indicates a prerequisite exists—not that any action is approved. Each action still needs an exact policy match, required approvals, a reservation, and enforcement at the execution boundary.</p>{pathLoading ? <LoadingState label="Loading authorization path…" /> : accounts.error || agents.error || policies.error || receipts.error ? <ErrorState message="Some live path data is unavailable; counts are not shown as zero." /> : <div className="authorization-path" aria-label="Authorization prerequisites and evidence">{authorizationPath.map((step) => <Link key={step.key} to={step.href} className={`authorization-step authorization-${step.status}`}><span className="authorization-step-index">{step.index} / {step.key}</span><span className="authorization-step-status"><i />{step.statusLabel}</span><strong>{step.count}</strong><span className="authorization-step-title">{step.title}</span><span className="authorization-step-note">{step.note}</span><span className="authorization-step-link">Open section <ArrowUpRight size={13} /></span></Link>)}</div>}</Reveal>
    <Reveal className="console-grid"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">Policy lifecycle</p><h2>Current policies</h2></div><Link to="/app/policies" className="text-link">View all <ArrowRight size={15} /></Link></div><DataTable columns={['Policy', 'Revision', 'State', 'Updated']} rows={(policies.data?.policies ?? []).slice(0, 5).map((p) => [<Link className="table-link" to={`/app/policies/${encodeURIComponent(p.id)}`} key={p.id}>{p.id}</Link>, `r${p.currentRevision}`, <StatusPill value={p.state} key={p.state} />, formatDate(p.createdAt)])} /></section><section className="panel"><div className="panel-heading"><div><p className="eyebrow">Evidence feed</p><h2>Latest signals</h2></div><Link to="/app/activity" className="text-link">Open activity <ArrowRight size={15} /></Link></div>{alerts.loading && <LoadingState />}{alerts.error && <ErrorState message={alerts.error} />}{!alerts.loading && !alerts.error && <ul className="signal-list">{(alerts.data?.alerts ?? []).map((alert) => <li key={alert.id}><span className="signal-icon"><ShieldCheck size={16} /></span><div><strong>{alert.title}</strong><small>{alert.eventType} · {formatDate(alert.createdAt)}</small></div></li>)}</ul>}{!alerts.loading && !alerts.error && alerts.data?.alerts.length === 0 && <EmptyState title="No alerts" body="The backend has no alert records for this organization." />}</section></Reveal>
    <Reveal className="panel decision-inbox"><div className="panel-heading"><div><p className="eyebrow">Human control / latest 5 requests</p><h2>Decision inbox</h2></div><Link className="text-link" to="/app/approvals">Review approvals →</Link></div>{held.loading ? <LoadingState label="Loading backend approval requests…" /> : held.error ? <ErrorState message="Approval data unavailable. No pending count is inferred." /> : <DataTable columns={['Action', 'Policy', 'State', 'Reason']} rows={(held.data?.actions ?? []).map((action) => [<Link className="table-link" key={action.actionId} to={`/app/activity/${encodeURIComponent(action.actionId)}`}>{action.actionId}</Link>, action.policyId, <StatusPill key={action.state} value={action.state} />, action.reason ?? 'Unavailable'])} emptyTitle="No held requests returned" emptyText="This backend query returned no held actions; it is not a readiness or execution guarantee." />}</Reveal>
    <Reveal className="panel recent-panel"><div className="panel-heading"><div><p className="eyebrow">Chain evidence</p><h2>Recent receipts</h2></div><Link to="/app/activity" className="text-link">View activity <ArrowRight size={15} /></Link></div>{receipts.loading ? <LoadingState /> : receipts.error ? <ErrorState message={receipts.error} /> : <DataTable columns={['Action', 'Chain', 'Transaction', 'State', 'Observed']} rows={(receipts.data?.receipts ?? []).map((receipt) => [<Link key={receipt.id} className="table-link" to={`/app/activity/${encodeURIComponent(receipt.actionId)}`}>{receipt.actionId}</Link>, String(receipt.chainId), receiptExplorerUrl(receipt.chainId, receipt.transactionHash) === null ? short(receipt.transactionHash) : <a key={receipt.id} href={receiptExplorerUrl(receipt.chainId, receipt.transactionHash) ?? undefined} target="_blank" rel="noreferrer">{short(receipt.transactionHash)} <ArrowUpRight size={12} /></a>, <StatusPill value={receipt.status} key={receipt.status} />, formatDate(receipt.observedAt)])} emptyTitle="No receipt evidence" emptyText="Receipts are observed independently; submission, confirmation and reconciliation are distinct." />}</Reveal>
  </div>;
}

function AgentsPage() {
  const mutate = useMutationTransport();
  const org = useOrganization(); const base = org.organizationId === null ? null : `/api/v1/orgs/${encodeURIComponent(org.organizationId)}`;
  const { data, error, loading, refetch } = useApi<AgentList>(base === null ? null : `${base}/agents`, AgentListSchema);
  const { accessToken } = useAuth();
  const [open, setOpen] = useState(false); const [id, setId] = useState(''); const [name, setName] = useState(''); const [message, setMessage] = useState<string | null>(null); const [saving, setSaving] = useState(false); const [credential, setCredential] = useState<{ agentId: string; token: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (base === null || accessToken === null || org.organizationId === null || org.profile === null) return;
    setSaving(true);
    setMessage(null);
    try {
      const idempotencyKey = getAgentRegistrationIntentKey(org.organizationId, org.profile.principal.subject, id, name);
      const response = await mutate(`${base}/agents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ id, displayName: name }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error('Agent registration failed. Check your role and try again.');
      const outcome = parseAgentRegistrationResponse(body);
      clearAgentRegistrationIntent(org.organizationId, org.profile.principal.subject, id);
      refetch();
      if (outcome.kind === 'REPLAY') {
        setId('');
        setMessage(`Agent ${outcome.agentId} was registered, but its one-time credential cannot be shown after a replay. Do not assign this identity to a policy; register a new agent ID for the demo.`);
        return;
      }
      setOpen(false);
      setId('');
      setName('');
      setCredential({ agentId: outcome.agentId, token: outcome.token });
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'Agent could not be created');
    } finally {
      setSaving(false);
    }
  }
  return <><PageHeader eyebrow="Identity / agents" title="Agents" description="Register agents as identities. Registration returns a credential once; store it in your server-side secret manager." action={<button className="button button-primary" onClick={() => setOpen(true)}><Plus size={16} /> Register agent</button>} />{loading ? <LoadingState /> : error ? <ErrorState message={error} /> : <section className="panel"><DataTable columns={['Agent', 'ID', 'Credential version', 'State', 'Created']} rows={(data?.agents ?? []).map((agent) => [<Link className="table-link" to={`/app/agents/${encodeURIComponent(agent.id)}`} key={agent.id}>{agent.displayName}</Link>, <code key={`${agent.id}-id`}>{agent.id}</code>, `v${agent.keyVersion}`, <StatusPill value={agent.status} key={agent.status} />, formatDate(agent.createdAt)])} emptyTitle="No agents registered" emptyText="Register an agent identity to scope policies to a known caller." /></section>}<Modal open={open} onClose={() => setOpen(false)} title="Register an agent"><form className="form-stack" onSubmit={(event) => void submit(event)}><label>Agent ID<input required pattern={RESOURCE_ID_PATTERN} maxLength={128} value={id} onChange={(event) => setId(event.target.value)} placeholder="treasury-agent" /></label><label>Display name<input required minLength={1} maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="Treasury agent" /></label><p className="form-hint">The bearer credential is displayed once after creation. Copy it directly into a trusted server-side secret manager; it is never written to browser storage.</p>{message && <p className="form-error">{message}</p>}<button className="button button-primary" disabled={saving}>{saving ? 'Registering…' : 'Register agent'}</button></form></Modal><OneTimeSecret open={credential !== null} title="Agent credential — shown once" label={credential?.agentId ?? ''} value={credential?.token ?? ''} onClose={() => setCredential(null)} /></>;
}

function AgentDetailPage() { const { agentId = '' } = useParams(); const org = useOrganization(); const { accessToken } = useAuth(); const { data, loading, error } = useApi<AgentList>(org.organizationId ? `/api/v1/orgs/${encodeURIComponent(org.organizationId)}/agents` : null, AgentListSchema); const agent = data?.agents.find((item) => item.id === agentId); return <><PageHeader eyebrow="Identity / agent detail" title={agent?.displayName ?? agentId} description="Agent identity status and version metadata loaded from the organization API." action={<Link to="/app/agents" className="button button-outline">All agents <ArrowRight size={16} /></Link>} />{loading ? <LoadingState /> : error ? <ErrorState message={error} /> : agent ? <><section className="detail-grid"><div className="panel detail-card"><p className="eyebrow">Identity record</p><h2>{agent.displayName}</h2><dl><dt>Agent ID</dt><dd>{agent.id}</dd><dt>Status</dt><dd><StatusPill value={agent.status} /></dd><dt>Credential version</dt><dd>v{agent.keyVersion}</dd><dt>Registered</dt><dd>{formatDate(agent.createdAt)}</dd></dl></div><div className="panel detail-card"><p className="eyebrow">Scope</p><h2>Policy-bound actions</h2><p>Agent credentials identify the caller. Policy rules independently bind the permitted account, target, selector, recipient, limits, chain, and expiry.</p><Link className="text-link" to="/app/policies">Review policies <ArrowRight size={15} /></Link></div></section><AgentPermissionScope agentId={agentId} organizationId={org.organizationId} token={accessToken} /></> : <ErrorState message="This agent is not in the organization list." />}</>; }

const blankPolicy = `{
  "schemaVersion": 1,
  "policyId": "policy-id",
  "revision": 1,
  "organizationId": "organization-id",
  "owner": "0x1111111111111111111111111111111111111111",
  "account": "0x2222222222222222222222222222222222222222",
  "agentId": "agent-id",
  "agentAddress": "0x3333333333333333333333333333333333333333",
  "agentKeyVersion": 1,
  "chainId": 10143,
  "adapter": "evm-smart-account",
  "target": "0x4444444444444444444444444444444444444444",
  "selectors": ["0xa9059cbb"],
  "asset": "0x5555555555555555555555555555555555555555",
  "recipients": ["0x6666666666666666666666666666666666666666"],
  "limits": { "perAction": "1000000", "cumulative": "5000000", "windowSeconds": 86400, "approvalThreshold": "800000", "maxActions": 10 },
  "validAfter": 1800000000,
  "expiresAt": 1900000000,
  "nonceEpoch": 0
}`;

function PoliciesPage() {
  const org = useOrganization(); const base = org.organizationId === null ? null : `/api/v1/orgs/${encodeURIComponent(org.organizationId)}`;
  const { data, error, loading } = useApi<PolicyList>(base === null ? null : `${base}/policies`, PolicyListSchema);
  return <><PageHeader eyebrow="Control / policies" title="Policies" description="Immutable, versioned authorization rules. A draft does not become active until the required account-owner authorization is completed." action={<Link className="button button-primary" to="/app/policies/new"><Plus size={16} /> Draft policy</Link>} />{loading ? <LoadingState /> : error ? <ErrorState message={error} /> : <section className="panel"><DataTable columns={['Policy', 'Account', 'Revision', 'State', 'Revision hash', 'Created']} rows={(data?.policies ?? []).map((policy) => [<Link className="table-link" to={`/app/policies/${encodeURIComponent(policy.id)}`} key={policy.id}>{policy.id}</Link>, policy.accountId, `r${policy.currentRevision}`, <StatusPill key={policy.state} value={policy.state} />, <code key={`${policy.id}-hash`}>{short(policy.revisionHash)}</code>, formatDate(policy.createdAt)])} emptyTitle="No policies yet" emptyText="Create a draft after registering an agent and verifying a supported account." /></section>}<p className="bottom-note">Policy bodies are strict typed JSON. Unknown fields are rejected by the policy contract.</p></>;
}

function PolicyEditorPage({ revision = false }: { revision?: boolean }) {
  const mutate = useMutationTransport();
  const { policyId = '' } = useParams(); const org = useOrganization(); const { accessToken } = useAuth(); const navigate = useNavigate();
  const policies = useApi<PolicyList>(org.organizationId ? `/api/v1/orgs/${encodeURIComponent(org.organizationId)}/policies` : null, PolicyListSchema);
  const draftAgents = useApi<AgentList>(!revision && org.organizationId ? `/api/v1/orgs/${encodeURIComponent(org.organizationId)}/agents` : null, AgentListSchema);
  const draftAccounts = useApi<AccountList>(!revision && org.organizationId ? `/api/v1/orgs/${encodeURIComponent(org.organizationId)}/accounts` : null, AccountListSchema);
  const current = policies.data?.policies.find((policy) => policy.id === policyId);
  const revisionPath = revision && org.organizationId && current ? `/api/v1/orgs/${encodeURIComponent(org.organizationId)}/policies/${encodeURIComponent(policyId)}/revisions/${current.currentRevision}` : null;
  const currentBody = useApi<PolicyRevision>(revisionPath, PolicyRevisionSchema);
  const [json, setJson] = useState(blankPolicy); const [message, setMessage] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  useEffect(() => { if (revision && currentBody.data) setJson(JSON.stringify(currentBody.data, null, 2)); }, [revision, currentBody.data]);
  const loadError = policies.error ?? currentBody.error;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (org.organizationId === null || accessToken === null) return;
    setSaving(true); setMessage(null);
    try {
      const body = z.record(z.string(), z.json()).parse(JSON.parse(json));
      const nextRevision = revision ? (current?.currentRevision ?? 0) + 1 : 1;
      if (revision && current === undefined) throw new Error('The current policy could not be loaded.');
      const revisionPayload = PolicyRevisionSchema.parse({ ...body, organizationId: org.organizationId, policyId: revision ? policyId : body.policyId, revision: nextRevision });
      if (!revision) {
        if (draftAgents.data === null || draftAccounts.data === null) throw new Error('Agent and account prerequisites have not loaded. Retry the organization data before submitting.');
        const referenceStatus = validatePolicyDraftReferences(revisionPayload, draftAgents.data.agents, draftAccounts.data.accounts);
        if (referenceStatus === 'agent-unavailable') throw new Error('Choose an active agent registered in this organization.');
        if (referenceStatus === 'account-unavailable') throw new Error('Choose an active or provisioning smart account registered for the same chain and adapter in this organization.');
      }
      const url = revision ? `/api/v1/orgs/${encodeURIComponent(org.organizationId)}/policies/${encodeURIComponent(policyId)}/revisions` : `/api/v1/orgs/${encodeURIComponent(org.organizationId)}/policies`;
      const response = await mutate(url, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(revisionPayload) });
      const result = await response.json();
      if (!response.ok) { const messageText = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'object' && result.error !== null && 'message' in result.error ? String(result.error.message) : 'Policy request was rejected'; throw new Error(messageText); }
      navigate(`/app/policies/${encodeURIComponent(revision ? policyId : ('policyId' in result && typeof result.policyId === 'string' ? result.policyId : ''))}`);
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : 'Invalid policy JSON'); }
    finally { setSaving(false); }
  }
  const editorState = getPolicyEditorState({
    isRevision: revision,
    policiesLoading: policies.loading,
    policiesLoaded: policies.data !== null,
    policiesFailed: policies.error !== null,
    policyExists: current !== undefined,
    revisionLoading: currentBody.loading,
    revisionLoaded: currentBody.data !== null,
    revisionFailed: currentBody.error !== null,
  });
  const editorLoadError = loadError ?? 'The policy or canonical revision could not be loaded.';
  const draftReferencesLoading = !revision && (draftAgents.loading || draftAccounts.loading || (draftAgents.data === null && draftAgents.error === null) || (draftAccounts.data === null && draftAccounts.error === null));
  const activeAgentCount = draftAgents.data?.agents.filter((agent) => agent.status === 'ACTIVE').length ?? 0;
  const activeAccountCount = draftAccounts.data?.accounts.filter((account) => account.status === 'ACTIVE').length ?? 0;
  const provisioningAccountCount = draftAccounts.data?.accounts.filter((account) => account.status === 'PROVISIONING').length ?? 0;
  const draftReferenceError = draftAgents.error ?? draftAccounts.error;
  const draftPrerequisitesReady = activeAgentCount > 0 && activeAccountCount + provisioningAccountCount > 0;
  return <><PageHeader eyebrow={revision ? 'Policy / new revision' : 'Policy / create'} title={revision ? `Revise ${policyId}` : 'Draft a policy'} description="Provide a complete PolicyRevision object. The backend validates strict fields, tenant binding, and revision numbering." />{editorState === 'error' && <ErrorState message={editorLoadError} />}{editorState === 'missing' && <ErrorState message="This policy was not found in the selected organization." />}{editorState === 'loading' ? <LoadingState label="Loading the immutable revision to edit…" /> : editorState === 'ready' ? <>{!revision && draftReferencesLoading && <LoadingState label="Checking this organization’s agents and draft-eligible smart accounts…" />}{!revision && draftReferenceError !== null && <div className="callout" role="alert"><LockKey size={20} /><p>Organization prerequisites could not be checked: {draftReferenceError} <button type="button" className="text-link" onClick={() => { draftAgents.refetch(); draftAccounts.refetch(); }}>Retry</button></p></div>}{!revision && !draftReferencesLoading && draftReferenceError === null && !draftPrerequisitesReady && <div className="callout" role="status"><LockKey size={20} /><p>A draft needs an active organization agent and a supported ACTIVE or PROVISIONING smart account. Active accounts: {activeAccountCount}. Provisioning accounts: {provisioningAccountCount}; drafts linked to these accounts are not executable until backend-confirmed activation. <Link className="text-link" to="/app/agents">Register an agent</Link> · <Link className="text-link" to="/app/settings/accounts">Add an account</Link>.</p></div>}{!revision && provisioningAccountCount > 0 && <div className="callout" role="status"><LockKey size={20} /><p>Provisioning stays a distinct non-active state. A policy draft can be prepared, but the API will reject simulation/execution until the required account activation is independently verified.</p></div>}<section className="panel editor-panel"><form className="form-stack" onSubmit={(event) => void submit(event)}><label>Policy revision JSON<textarea className="json-editor" spellCheck={false} value={json} onChange={(event) => setJson(event.target.value)} /></label><p className="form-hint">The JSON starts with example values: replace the policy ID and every address/agent reference with this organization’s real resources. A draft is not an execution grant. Saving revision {revision ? (current?.currentRevision ?? 0) + 1 : 1} does not activate the policy.</p>{message && <p className="form-error" role="alert">{message}</p>}<button className="button button-primary" disabled={saving || (!revision && (draftReferencesLoading || draftReferenceError !== null || !draftPrerequisitesReady))}>{saving ? 'Submitting…' : revision ? 'Create immutable revision' : 'Create draft'} <ArrowRight size={16} /></button></form></section></> : null}</>;
}

function PolicyDetailPage() {
  const { policyId = '' } = useParams(); const org = useOrganization(); const { data, loading, error, refetch } = useApi<PolicyList>(org.organizationId ? `/api/v1/orgs/${encodeURIComponent(org.organizationId)}/policies` : null, PolicyListSchema);
  const policy = data?.policies.find((item) => item.id === policyId);
  const revision = useApi<PolicyRevision>(org.organizationId && policy ? `/api/v1/orgs/${encodeURIComponent(org.organizationId)}/policies/${encodeURIComponent(policyId)}/revisions/${policy.currentRevision}` : null, PolicyRevisionSchema);
  const accountList = useApi<AccountList>(org.organizationId && policy ? `/api/v1/orgs/${encodeURIComponent(org.organizationId)}/accounts` : null, AccountListSchema);
  const activationAccount = accountList.data?.accounts.find((account) => account.id === policy?.accountId) ?? null;
  return <><PageHeader eyebrow="Policy / immutable record" title={policyId} description="Current policy state and canonical revision loaded from the organization API." action={<div className="header-actions">{activationAccount?.status === 'ACTIVE' ? <Link className="button button-outline" to={`/app/policies/${encodeURIComponent(policyId)}/simulate`}>Preflight <ArrowRight size={16} /></Link> : <span className="button button-outline" aria-disabled="true" title="Account activation must be verified before policy simulation">Preflight unavailable</span>}<Link className="button button-primary" to={`/app/policies/${encodeURIComponent(policyId)}/edit`}>New revision <ArrowRight size={16} /></Link></div>} />{loading ? <LoadingState /> : error ? <ErrorState message={error} /> : policy ? <><div className="detail-grid"><div className="panel detail-card"><p className="eyebrow">Policy summary</p><dl><dt>Policy ID</dt><dd>{policy.id}</dd><dt>Bound account</dt><dd>{policy.accountId}</dd><dt>Current revision</dt><dd>r{policy.currentRevision}</dd><dt>State</dt><dd><StatusPill value={policy.state} /></dd><dt>Revision hash</dt><dd><code>{policy.revisionHash}</code></dd><dt>Created</dt><dd>{formatDate(policy.createdAt)}</dd></dl></div><div className="panel detail-card"><p className="eyebrow">Control boundary</p><h2>Revision is immutable</h2><p>Editing creates a new revision; it does not overwrite this record. Activation plans require a separate owner-controlled Safe flow; the backend finalizes only after verifying submitted transaction receipts and finality.</p></div></div>{activationAccount?.status === 'PROVISIONING' && <div className="callout" role="status"><LockKey size={20} /><p>This account is PROVISIONING. Its draft is not active, and preflight is disabled until the backend verifies the required chain activation.</p></div>}{revision.loading ? <LoadingState label="Loading canonical revision…" /> : revision.error ? <ErrorState message={revision.error} /> : revision.data && <section className="panel detail-card"><p className="eyebrow">Immutable revision body · r{revision.data.revision}</p><pre className="json-readout">{JSON.stringify(revision.data, null, 2)}</pre></section>}<PolicyLifecycle policy={policy} organizationId={org.organizationId} account={activationAccount} accountLoading={accountList.loading} accountError={accountList.error} onUpdated={refetch} /></> : <ErrorState message="This policy was not found in the organization list." />}</>;
}

function PolicyLifecycle({ policy, organizationId, account, accountLoading, accountError, onUpdated }: { policy: PolicyList['policies'][number]; organizationId: string | null; account: AccountList['accounts'][number] | null; accountLoading: boolean; accountError: string | null; onUpdated: () => void }) {
  const { accessToken } = useAuth();
  const [plan, setPlan] = useState<{ operation: 'activate' | 'revoke'; planId: string; body: Record<string, import('zod').JSONType>; prepareKey: string } | null>(null);
  const [prepareKey, setPrepareKey] = useState<ActivationPrepareKey | null>(null);
  const [hashText, setHashText] = useState(''); const [finalizeKey, setFinalizeKey] = useState<{ operation: 'activate' | 'revoke'; payload: string; key: string } | null>(null);
  const [guardAddress, setGuardAddress] = useState(account?.guardAddress ?? ''); const [moduleAddress, setModuleAddress] = useState(account?.moduleAddress ?? '');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { setGuardAddress(account?.guardAddress ?? ''); setModuleAddress(account?.moduleAddress ?? ''); }, [account?.id, account?.guardAddress, account?.moduleAddress]);
  const operation = policy.state === 'DRAFT' ? 'activate' : policy.state === 'ACTIVE' ? 'revoke' : null;
  async function prepare() {
    if (!organizationId || !accessToken || operation === null) return;
    if (operation === 'activate' && (accountLoading || accountError !== null || account === null)) { setError('The policy account status is not available from the organization API. Retry account loading before preparing activation.'); return; }
    const activation = operation === 'activate' && account !== null ? buildActivationPreparationBody(account.status, { guardAddress, moduleAddress }) : null;
    if (activation !== null && !activation.ok) {
      setError(activation.reason === 'account-not-activatable' ? 'Only a provisioning or verified active account can prepare activation.' : 'Enter distinct, non-zero Guard and Module EVM addresses. The backend will independently verify their deployed chain state.');
      return;
    }
    setBusy(true); setError(null); setNotice(null);
    const body = activation?.ok ? activation.body : undefined;
    const payload = body === undefined ? '' : JSON.stringify(body);
    const key = getActivationPrepareKey(prepareKey, operation, payload, () => crypto.randomUUID());
    setPrepareKey({ operation, payload, key });
    try {
      const response = await apiFetch(`/api/v1/orgs/${encodeURIComponent(organizationId)}/policies/${encodeURIComponent(policy.id)}/${operation}`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Idempotency-Key': key, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const raw: unknown = await response.json();
      if (!response.ok) throw new Error(`${operation === 'activate' ? 'Activation' : 'Revocation'} plan was rejected. The API requires an organization owner and verified compatible account state.`);
      const result = PolicySignaturePlanSchema.parse(raw);
      setPlan({ operation, planId: result.planId, body: result.plan, prepareKey: key });
      setHashText('');
      setNotice('Plan prepared only. No owner signature or chain transaction was requested. Review and execute separately through the supported Safe owner flow, then provide transaction hashes for backend verification.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not prepare the owner-signature plan'); }
    finally { setBusy(false); }
  }
  async function finalize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!organizationId || !accessToken || plan === null) return;
    const hashes = hashText.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
    const validHash = /^0x[0-9a-fA-F]{64}$/;
    if (hashes.length === 0 || hashes.some((hash) => !validHash.test(hash)) || (plan.operation === 'revoke' && hashes.length !== 1) || (plan.operation === 'activate' && hashes.length > 32)) { setError(plan.operation === 'revoke' ? 'Enter one valid 32-byte transaction hash.' : 'Enter between one and 32 valid 32-byte transaction hashes.'); return; }
    const payloadObject = plan.operation === 'activate' ? { planId: plan.planId, transactionHashes: hashes } : { planId: plan.planId, transactionHash: hashes[0] };
    const payload = JSON.stringify(payloadObject);
    const key = finalizeKey?.operation === plan.operation && finalizeKey.payload === payload ? finalizeKey.key : crypto.randomUUID();
    setFinalizeKey({ operation: plan.operation, payload, key }); setBusy(true); setError(null); setNotice(null);
    try {
      const response = await apiFetch(`/api/v1/orgs/${encodeURIComponent(organizationId)}/policies/${encodeURIComponent(policy.id)}/${plan.operation}/finalize`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: payload });
      const raw: unknown = await response.json();
      if (!response.ok) throw new Error('Finalization did not pass backend receipt/finality checks. Confirm the owner transaction succeeded on the configured chain and retry with the exact transaction hash.');
      if (plan.operation === 'activate') PolicyActivationFinalizedSchema.parse(raw); else PolicyRevocationFinalizedSchema.parse(raw);
      setPlan(null); setPrepareKey(null); setFinalizeKey(null); setHashText(''); setNotice(`Policy ${plan.operation === 'activate' ? 'activated' : 'revoked'} after backend verification of the Safe transaction.`); onUpdated();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Policy lifecycle finalization failed'); }
    finally { setBusy(false); }
  }
  if (operation === null) return null;
  const preparationBlocked = operation === 'activate' && (accountLoading || accountError !== null || account === null || (account.status !== 'ACTIVE' && account.status !== 'PROVISIONING'));
  return <section className="panel policy-lifecycle"><div className="panel-heading"><div><p className="eyebrow">Owner-controlled lifecycle</p><h2>{plan ? `${plan.operation === 'activate' ? 'Activation' : 'Revocation'} plan` : `${operation === 'activate' ? 'Activate' : 'Revoke'} policy`}</h2></div><StatusPill value={policy.state} /></div><p className="form-hint">Preparing a plan does not request a wallet signature or submit a transaction. The backend independently verifies required state before finalizing policy or grant changes.</p>{operation === 'activate' && account?.status === 'PROVISIONING' && !plan && <div className="form-stack"><p className="form-hint">This account is PROVISIONING, not active. Enter the deployed Guard and Module bindings required by the backend. Preparation does not install contracts or activate the policy.</p><label>MandateSafeGuard address<input inputMode="text" autoComplete="off" spellCheck={false} required value={guardAddress} onChange={(event) => setGuardAddress(event.target.value)} placeholder="0x + 40 hex characters" /></label><label>MandateAgentModule address<input inputMode="text" autoComplete="off" spellCheck={false} required value={moduleAddress} onChange={(event) => setModuleAddress(event.target.value)} placeholder="0x + 40 hex characters" /></label></div>}{operation === 'activate' && (accountLoading || accountError !== null || account === null) && <p className="form-error" role="status">{accountLoading ? 'Loading the registered account state…' : accountError ?? 'The policy account is not present in the organization account list.'}</p>}{plan && <><div className="lifecycle-plan-head"><span>Plan {plan.planId}</span><span>Preparation only · no signature requested</span></div><pre className="json-readout">{JSON.stringify(plan.body, null, 2)}</pre><form className="form-stack" onSubmit={(event) => void finalize(event)}><label>{plan.operation === 'activate' ? 'Executed Safe transaction hashes (comma or space separated)' : 'Executed Safe revocation transaction hash'}<input required value={hashText} onChange={(event) => setHashText(event.target.value)} placeholder="0x…" /></label><p className="form-hint">Paste hashes only from a separately completed owner flow. The backend independently checks transaction, receipt, and finality; a hash alone never activates or revokes a policy.</p><button className="button button-primary" disabled={busy}>{busy ? 'Verifying…' : 'Verify and finalize'}</button></form></>}{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="success-note">{notice}</p>}{!plan && <button className="button button-outline" disabled={busy || preparationBlocked} onClick={() => void prepare()}>{busy ? 'Preparing…' : `Prepare ${operation} plan`} <ArrowRight size={16} /></button>}</section>;
}

function PolicySimulatePage() {
  const { policyId = '' } = useParams(); const org = useOrganization(); const { accessToken } = useAuth(); const [body, setBody] = useState('{\n  "actionId": "preflight-1",\n  "idempotencyKey": "preflight-1",\n  "policyId": "",\n  "policyRevision": 1,\n  "policyRevisionHash": "0x0000000000000000000000000000000000000000000000000000000000000000",\n  "organizationId": "",\n  "account": "0x2222222222222222222222222222222222222222",\n  "agentId": "agent-id",\n  "agentKeyVersion": 1,\n  "chainId": 10143,\n  "target": "0x4444444444444444444444444444444444444444",\n  "selector": "0xa9059cbb",\n  "asset": "0x5555555555555555555555555555555555555555",\n  "recipient": "0x6666666666666666666666666666666666666666",\n  "amount": "1000",\n  "nonce": 0,\n  "nonceEpoch": 0,\n  "expiresAt": 1900000000\n}');
  const [result, setResult] = useState<{ verdict: string; reason: string; policyRevisionHash: string } | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!org.organizationId || !accessToken) return; setBusy(true); setError(null); setResult(null); try { const parsed = JSON.parse(body) as Record<string, string | number>; parsed.policyId = policyId; parsed.organizationId = org.organizationId; const response = await apiFetch(`/api/v1/orgs/${encodeURIComponent(org.organizationId)}/policies/${encodeURIComponent(policyId)}/simulate`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) }); const data = await response.json(); if (!response.ok) throw new Error('error' in data ? String(data.error.message) : 'Preflight failed'); setResult(data as { verdict: string; reason: string; policyRevisionHash: string }); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Invalid action JSON'); } finally { setBusy(false); } }
  return <><PageHeader eyebrow="Policy / preflight" title="Simulate an action" description="Read-only evaluation of a typed action intent against this policy. This does not send or simulate an on-chain transaction." /><section className="panel editor-panel"><form className="form-stack" onSubmit={(event) => void submit(event)}><label>Action intent JSON<textarea className="json-editor" value={body} onChange={(event) => { setBody(event.target.value); setResult(null); }} /></label>{error && <p className="form-error">{error}</p>}{result && <div className={`simulation-result ${result.verdict === 'ALLOW' ? 'result-allow' : 'result-deny'}`}><strong>{result.verdict}</strong><span>{result.reason}</span><code>{result.policyRevisionHash}</code><small>Backend preflight only · no transaction submitted</small></div>}<button className="button button-primary" disabled={busy}>{busy ? 'Evaluating…' : 'Evaluate policy'}</button></form></section></>;
}

function ApprovalsPage() {
  const mutate = useMutationTransport();
  const org = useOrganization(); const { accessToken } = useAuth();
  const base = org.organizationId ? `/api/v1/orgs/${encodeURIComponent(org.organizationId)}` : null;
  const { data, loading, error, refetch } = useApi<ActionList>(base ? `${base}/actions?state=HELD&limit=100` : null, ActionListSchema);
  const [pending, setPending] = useState<{ action: ActionList['actions'][number]; outcome: 'APPROVED' | 'DENIED' } | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [failure, setFailure] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  async function decide(action: ActionList['actions'][number], outcome: 'APPROVED' | 'DENIED') {
    if (!base || !accessToken) return;
    setFailure(null); setNotice(null); setDeciding(true);
    try {
      const response = await mutate(`${base}/actions/${encodeURIComponent(action.actionId)}/approval`, {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome, actionHash: action.actionHash }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body === 'object' && body !== null && 'error' in body ? String(body.error.message) : 'Decision failed');
      setNotice(`Human decision for ${action.actionId} recorded: ${outcome.toLowerCase()}. No transaction was submitted by this control.`); setPending(null); refetch();
    } catch (issue) { setFailure(issue instanceof Error ? issue.message : 'Decision failed'); } finally { setDeciding(false); }
  }
  return <><PageHeader eyebrow="Human control / approvals" title="Approvals" description="Review the exact held action and its hash. Decisions are recorded against the organization API." action={<button className="button button-outline" type="button" onClick={refetch} disabled={loading}>Refresh approvals</button>} />{loading ? <LoadingState label="Loading held actions from the backend…" /> : error ? <ErrorState message={error} onRetry={refetch} retryLabel="Retry approvals" /> : failure && <ErrorState message={failure} />}{notice && <p className="success-note"><Check size={16} />{notice}</p>}<section className="approval-list">{(data?.actions ?? []).length === 0 && !loading && !error ? <EmptyState title="No held actions" body="The backend reports no pending approval requests for this organization." /> : (data?.actions ?? []).map((action) => <article className="panel approval-card" key={action.actionId}><div className="approval-card-head"><div><p className="eyebrow">Exact action hash</p><h2>{action.actionId}</h2></div><StatusPill value={action.state} /></div><code>{action.actionHash}</code><dl><dt>Policy</dt><dd>{action.policyId} · r{action.policyRevision}</dd><dt>Agent</dt><dd>{jsonText(action.action.agentId)}</dd><dt>Recipient</dt><dd>{jsonText(action.action.recipient)}</dd><dt>Amount</dt><dd>{jsonText(action.action.amount)}</dd></dl><div className="header-actions"><button className="button button-outline" onClick={() => setPending({ action, outcome: 'DENIED' })}>Deny request</button><button className="button button-primary" onClick={() => setPending({ action, outcome: 'APPROVED' })}>Approve exact hash <Check size={16} /></button></div></article>)}</section><Modal open={pending !== null} onClose={() => { if (!deciding) setPending(null); }} title="Confirm exact-hash decision">{pending && <div className="form-stack"><p>You are recording a human {pending.outcome.toLowerCase()} decision, not signing or executing a transaction.</p><dl><dt>Action</dt><dd>{pending.action.actionId}</dd><dt>Exact action hash</dt><dd><code className="approval-confirm-hash">{pending.action.actionHash}</code></dd><dt>Decision</dt><dd>{pending.outcome}</dd></dl>{failure && <p role="alert" className="form-error">{failure}</p>}<div className="header-actions"><button type="button" className="button button-outline" disabled={deciding} onClick={() => setPending(null)}>Cancel</button><button type="button" className="button button-primary" disabled={deciding} onClick={() => void decide(pending.action, pending.outcome)}>{deciding ? 'Recording…' : 'Confirm decision'}</button></div></div>}</Modal></>;
}

function ActivityPage() {
  const org = useOrganization(); const base = org.organizationId ? `/api/v1/orgs/${encodeURIComponent(org.organizationId)}` : null;
  const audit = useApi<AuditEvents>(base ? `${base}/audit-events?limit=100` : null, AuditEventsSchema);
  const receipts = useApi<Receipts>(base ? `${base}/receipts?limit=100` : null, ReceiptsSchema);
  const refresh = () => { audit.refetch(); receipts.refetch(); };
  const rows = (audit.data?.events ?? []).map((event) => {
    const detailHref = getActivityDetailHref(event.subjectType, event.subjectId);
    const eventName = detailHref === null ? event.eventType : <Link className="table-link" to={detailHref}>{event.eventType}</Link>;
    return [eventName, `${event.subjectType} · ${event.subjectId}`, event.actorType, event.sequence, formatDate(event.createdAt)];
  });
  return <><PageHeader eyebrow="Evidence / activity" title="Activity" description="Organization-scoped audit events and chain receipts. Finality and reorg states come from indexer reconciliation." action={<button className="button button-outline" type="button" onClick={refresh} disabled={audit.loading || receipts.loading}>Refresh activity</button>} />{audit.loading || receipts.loading ? <LoadingState /> : audit.error ? <ErrorState message={audit.error} onRetry={refresh} retryLabel="Retry activity" /> : <><section className="panel"><div className="panel-heading"><div><p className="eyebrow">Append-only history</p><h2>Audit events</h2></div></div><DataTable columns={['Event', 'Subject', 'Actor', 'Sequence', 'Time']} rows={rows} emptyTitle="No audit events" emptyText="Backend audit entries will appear when policy and execution events are recorded." /></section><section className="panel recent-panel"><div className="panel-heading"><div><p className="eyebrow">Indexer / reconciliation</p><h2>Receipts</h2></div></div>{receipts.error ? <ErrorState message={receipts.error} onRetry={refresh} retryLabel="Retry activity" /> : <DataTable columns={['Action', 'Chain', 'Transaction hash', 'Finality', 'Observed']} rows={(receipts.data?.receipts ?? []).map((receipt) => [<Link key={receipt.id} className="table-link" to={`/app/activity/${encodeURIComponent(receipt.actionId)}`}>{receipt.actionId}</Link>, String(receipt.chainId), short(receipt.transactionHash), <StatusPill key={receipt.status} value={receipt.status} />, formatDate(receipt.observedAt)])} emptyTitle="No receipts yet" emptyText="Receipts are populated after a submitted action has been observed by the indexer." />}</section></>}</>;
}

function ActivityDetailPage() {
  const { actionId = '' } = useParams(); const org = useOrganization();
  const { data, loading, error, refetch } = useApi<ActionDetail>(org.organizationId ? `/api/v1/orgs/${encodeURIComponent(org.organizationId)}/actions/${encodeURIComponent(actionId)}` : null, ActionSchema);
  return <><PageHeader eyebrow="Evidence / action trace" title={actionId} description="Full action state is retrieved from the tenant-scoped action detail endpoint." action={<div className="header-actions"><button className="button button-outline" type="button" onClick={refetch} disabled={loading}>Refresh action</button><Link className="button button-outline" to="/app/activity">Back to activity</Link></div>} />{loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={refetch} retryLabel="Retry action" /> : data ? <><LifecycleEvidence action={data} /><div className="detail-grid"><section className="panel detail-card"><p className="eyebrow">Action state</p><div className="status-title"><h2>{data.state}</h2><StatusPill value={data.verdict ?? data.state} /></div><dl><dt>Policy</dt><dd>{data.policyId} · r{data.policyRevision}</dd><dt>Action hash</dt><dd><code>{data.actionHash}</code></dd><dt>Decision reason</dt><dd>{data.reason ?? '—'}</dd><dt>Created</dt><dd>{formatDate(data.createdAt)}</dd><dt>Updated</dt><dd>{formatDate(data.updatedAt)}</dd></dl></section><section className="panel detail-card"><p className="eyebrow">Action intent</p><pre className="json-readout">{JSON.stringify(data.action, null, 2)}</pre></section><section className="panel detail-card"><p className="eyebrow">Reservation</p><pre className="json-readout">{JSON.stringify(data.reservation, null, 2)}</pre></section><section className="panel detail-card"><p className="eyebrow">Audit trace</p><pre className="json-readout">{JSON.stringify(data.events, null, 2)}</pre></section></div></> : null}</>;
}

function TeamPage() {
  const mutate = useMutationTransport();
  const org = useOrganization(); const { accessToken } = useAuth(); const base = org.organizationId ? `/api/v1/orgs/${encodeURIComponent(org.organizationId)}` : null;
  const members = useApi<Members>(base ? `${base}/members` : null, MembersSchema); const invitations = useApi<Invitations>(base ? `${base}/invitations` : null, InvitationsSchema);
  const [email, setEmail] = useState(''); const [role, setRole] = useState<'ADMIN' | 'APPROVER' | 'VIEWER'>('APPROVER'); const [message, setMessage] = useState<string | null>(null); const [errorMessage, setErrorMessage] = useState<string | null>(null); const [invitationToken, setInvitationToken] = useState<string | null>(null); const [working, setWorking] = useState<string | null>(null);
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!base || !accessToken) return; setMessage(null); setErrorMessage(null); setWorking('new');
    try {
      const response = await mutate(`${base}/invitations`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, role }) });
      const raw: unknown = await response.json();
      if (!response.ok) throw new Error('Invitation failed. Check the address and your organization role.');
      const result = InvitationCreatedSchema.parse(raw); setEmail(''); invitations.refetch();
      if (result.invitationToken) { setInvitationToken(result.invitationToken); setMessage(result.emailDeliveryQueued ? 'Invitation created and queued for configured email delivery. Copy the one-time invitation token if you also need to share it securely.' : 'Invitation created. Automated email delivery is not configured; copy the one-time invitation token and share it securely.'); }
      else if (result.replayed) setMessage('This invitation request was already processed. Its one-time token is not returned again; check the recipient inbox or create a new invitation if needed.');
      else setMessage('Invitation created. Check the invitation list and configured delivery status.');
    } catch (failure) { setErrorMessage(failure instanceof Error ? failure.message : 'Invitation failed'); }
    finally { setWorking(null); }
  }
  async function revoke(invitationId: string) {
    if (!base || !accessToken) return;
    if (!window.confirm('Revoke this pending invitation? The recipient will no longer be able to accept it.')) return;
    setMessage(null); setErrorMessage(null); setWorking(invitationId);
    try {
      const response = await mutate(`${base}/invitations/${encodeURIComponent(invitationId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok && response.status !== 204) throw new Error('Invitation could not be revoked. It may already be accepted or expired.');
      setMessage('Pending invitation revoked.'); invitations.refetch();
    } catch (failure) { setErrorMessage(failure instanceof Error ? failure.message : 'Invitation revocation failed'); }
    finally { setWorking(null); }
  }
  return <><PageHeader eyebrow="Organization / access" title="Team" description="View organization roles and manage scoped invitations. The backend enforces organization-owner and admin permissions." />{members.loading || invitations.loading ? <LoadingState /> : members.error ? <ErrorState message={members.error} /> : <div className="console-grid"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">Current access</p><h2>Members</h2></div></div><DataTable columns={['Subject', 'Role']} rows={(members.data?.members ?? []).map((member) => [member.subject, <StatusPill value={member.role} key={member.role} />])} emptyTitle="No members" emptyText="No organization members are visible to this identity." /></section><section className="panel"><div className="panel-heading"><div><p className="eyebrow">Pending access</p><h2>Invitations</h2></div></div><DataTable columns={['Invitation', 'Role', 'State', 'Expires', 'Action']} rows={(invitations.data?.invitations ?? []).map((invitation) => [invitation.id, invitation.role, invitation.state, formatDate(invitation.expiresAt), invitation.state === 'PENDING' ? <button className="button button-small button-outline" key={`${invitation.id}-revoke`} disabled={working !== null} onClick={() => void revoke(invitation.id)}>{working === invitation.id ? 'Revoking…' : 'Revoke'}</button> : '—'])} emptyTitle="No pending invitations" emptyText="Invitations are listed once created." /></section><section className="panel"><div className="panel-heading"><div><p className="eyebrow">Invite by email</p><h2>Add a teammate</h2></div></div><form className="form-stack" onSubmit={(event) => void invite(event)}><label>Email address<input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="APPROVER">Approver</option><option value="ADMIN">Admin</option><option value="VIEWER">Viewer</option></select></label>{errorMessage && <p className="form-error">{errorMessage}</p>}{message && <p className="success-note">{message}</p>}<button className="button button-primary" disabled={working !== null}>{working === 'new' ? 'Sending…' : 'Send invitation'} <ArrowRight size={16} /></button></form></section></div>}<OneTimeSecret open={invitationToken !== null} title="Invitation token — shown once" label="Share with the intended recipient only" value={invitationToken ?? ''} onClose={() => setInvitationToken(null)} /></>;
}

function AccountsPage() {
  const mutate = useMutationTransport();
  const org = useOrganization(); const base = org.organizationId ? `/api/v1/orgs/${encodeURIComponent(org.organizationId)}` : null;
  const { data, loading, error, refetch } = useApi<AccountList>(base ? `${base}/accounts` : null, AccountListSchema);
  const { accessToken } = useAuth(); const [open, setOpen] = useState(false); const [id, setId] = useState(''); const [address, setAddress] = useState(''); const [chainId, setChainId] = useState('10143'); const [message, setMessage] = useState<string | null>(null); const [errorMessage, setErrorMessage] = useState<string | null>(null); const [saving, setSaving] = useState<string | null>(null);
  async function add(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!base || !accessToken) return; setMessage(null); setErrorMessage(null); setSaving('new'); try { const response = await mutate(`${base}/accounts`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, address, chainId: Number(chainId), adapter: 'evm-smart-account' }) }); const raw: unknown = await response.json(); if (!response.ok) throw new Error('Account registration failed. Check that the adapter supports this chain and address.'); AccountResultSchema.parse(raw); setOpen(false); setId(''); setAddress(''); setMessage('Account registered. Registration alone is not proof of on-chain protection; run verification before using it in a policy.'); refetch(); } catch (failure) { setErrorMessage(failure instanceof Error ? failure.message : 'Account registration failed'); } finally { setSaving(null); } }
  async function verify(accountId: string) { if (!base || !accessToken) return; setMessage(null); setErrorMessage(null); setSaving(accountId); try { const response = await mutate(`${base}/accounts/${encodeURIComponent(accountId)}/verify`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }); if (!response.ok) throw new Error('On-chain verification did not pass. Check the configured RPC and account enrollment, then retry.'); AccountResultSchema.parse(await response.json()); setMessage(`On-chain protection verified for ${accountId}.`); refetch(); } catch (failure) { setErrorMessage(failure instanceof Error ? failure.message : 'Account verification failed'); } finally { setSaving(null); } }
  return <><PageHeader eyebrow="Organization / accounts" title="Accounts" description="Only supported EVM smart accounts can be registered. Verify protection state before any policy activation." action={<button className="button button-primary" onClick={() => setOpen(true)}><Plus size={16} /> Add account</button>} />{loading ? <LoadingState /> : error ? <ErrorState message={error} /> : <section className="panel"><DataTable columns={['Account', 'Chain', 'Address', 'Adapter', 'Status', 'Verified', 'Action']} rows={(data?.accounts ?? []).map((account) => [account.id, String(account.chainId), <code key={account.id}>{short(account.address)}</code>, account.adapter, <StatusPill value={account.status} key={account.status} />, account.verifiedAt ? formatDate(account.verifiedAt) : 'Not verified', canVerifyAccount(account.status, account.verifiedAt) ? <button key={`${account.id}-verify`} className="button button-small button-outline" disabled={saving !== null} onClick={() => void verify(account.id)}>{saving === account.id ? 'Checking…' : 'Verify on-chain'}</button> : '—'])} emptyTitle="No accounts connected" emptyText="Add a supported smart-account address. Registration does not mean its on-chain protection is verified." /></section>}{errorMessage && <p className="form-error wide-note">{errorMessage}</p>}{message && <p className="success-note wide-note">{message}</p>}<Modal open={open} onClose={() => setOpen(false)} title="Add smart account"><form className="form-stack" onSubmit={(event) => void add(event)}><label>Account ID<input required maxLength={128} pattern={RESOURCE_ID_PATTERN} value={id} onChange={(event) => setId(event.target.value)} /></label><label>Chain ID<input required type="number" min="1" value={chainId} onChange={(event) => setChainId(event.target.value)} /></label><label>Account address<input required pattern="0x[0-9a-fA-F]{40}" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="0x…" /></label>{errorMessage && <p className="form-error">{errorMessage}</p>}<button className="button button-primary" disabled={saving !== null}>{saving === 'new' ? 'Registering…' : 'Register account'}</button></form></Modal></>;
}

function IntegrationsSettingsPage() {
  const mutate = useMutationTransport();
  const org = useOrganization(); const base = org.organizationId ? `/api/v1/orgs/${encodeURIComponent(org.organizationId)}` : null; const { accessToken } = useAuth();
  const providers = useApi<Providers>(base ? `${base}/integrations/model-providers` : null, ProvidersSchema); const webhooks = useApi<Webhooks>(base ? `${base}/webhooks` : null, WebhooksSchema);
  const [provider, setProvider] = useState<'DEEPSEEK' | 'OPENAI' | 'ANTHROPIC' | 'OTHER'>('DEEPSEEK'); const [apiKey, setApiKey] = useState(''); const [url, setUrl] = useState(''); const [endpointEvents, setEndpointEvents] = useState('ACTION_HELD,ACTION_RECONCILED'); const [message, setMessage] = useState<string | null>(null); const [messageIsError, setMessageIsError] = useState(false);
  function success(text: string) { setMessage(text); setMessageIsError(false); }
  function fail(text: string) { setMessage(text); setMessageIsError(true); } const [oneTimeSecret, setOneTimeSecret] = useState<{ title: string; label: string; value: string } | null>(null); const [deliveryEndpointId, setDeliveryEndpointId] = useState<string | null>(null); const [pendingRotation, setPendingRotation] = useState<{ endpointId: string; idempotencyKey: string } | null>(null); const [pendingDelete, setPendingDelete] = useState<{ endpointId: string; idempotencyKey: string } | null>(null);
  const deliveries = useApi<WebhookDeliveries>(base && deliveryEndpointId ? `${base}/webhooks/${encodeURIComponent(deliveryEndpointId)}/deliveries?limit=25` : null, WebhookDeliveriesSchema);
  async function saveKey(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!base || !accessToken) return; setMessage(null); setMessageIsError(false); try { const response = await mutate(`${base}/integrations/model-providers/${provider}`, { method: 'PUT', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey }) }); if (!response.ok) throw new Error('Provider key was rejected; check provider format and your organization role.'); setApiKey(''); success('Credential stored in the configured backend secret adapter. The raw key is not retained in the page.'); providers.refetch(); } catch (failure) { fail(failure instanceof Error ? failure.message : 'Credential could not be saved'); } }
  async function testProvider(name: string) { if (!base || !accessToken) return; setMessage(null); setMessageIsError(false); try { const response = await mutate(`${base}/integrations/model-providers/${name}/test`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }); const raw: unknown = await response.json(); if (!response.ok) throw new Error('Provider connectivity check failed; inspect backend logs for the request ID.'); const result = ProviderTestSchema.parse(raw); if (result.ok) success(`${name} credential verified.`); else fail(`${name} returned an error: ${result.reason}`); providers.refetch(); } catch (failure) { fail(failure instanceof Error ? failure.message : 'Test failed'); } }
  async function changeProvider(name: string, action: 'disable' | 'delete') { if (!base || !accessToken) return; if (action === 'delete' && !window.confirm(`Permanently remove the stored ${name} credential?`)) return; setMessage(null); setMessageIsError(false); try { const response = await mutate(`${base}/integrations/model-providers/${name}${action === 'disable' ? '/disable' : ''}`, { method: action === 'disable' ? 'POST' : 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }); if (!response.ok && response.status !== 204) throw new Error(`Could not ${action} the ${name} credential. Check your organization role.`); success(action === 'disable' ? `${name} credential disabled; the encrypted secret remains stored.` : `${name} credential removed from the organization.`); providers.refetch(); } catch (failure) { fail(failure instanceof Error ? failure.message : `Could not ${action} the credential`); } }
  async function createWebhook(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!base || !accessToken) return; setMessage(null); setMessageIsError(false); let parsedUrl: URL; try { parsedUrl = new URL(url); } catch { fail('Enter a valid HTTPS endpoint URL.'); return; } if (parsedUrl.protocol !== 'https:') { fail('Webhook destinations must use HTTPS.'); return; } try { const response = await mutate(`${base}/webhooks`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: parsedUrl.href, eventTypes: endpointEvents.split(',').map((value) => value.trim()).filter(Boolean) }) }); const raw: unknown = await response.json(); if (!response.ok) throw new Error('Webhook endpoint was rejected; check the destination, event types, and organization role.'); const created = WebhookCreatedSchema.safeParse(raw); setUrl(''); webhooks.refetch(); if (created.success) { setOneTimeSecret({ title: 'Webhook signing secret — shown once', label: `Endpoint ${created.data.endpoint.id}`, value: created.data.signingSecret }); success('Webhook created. Copy the signing secret to your receiver now; it cannot be retrieved later.'); } else if (WebhookReplaySchema.safeParse(raw).success) success('This endpoint was already created. Its one-time signing secret is not returned again.'); else throw new Error('The API response did not match the documented webhook-create contract.'); } catch (failure) { fail(failure instanceof Error ? failure.message : 'Webhook creation failed'); } }
  async function updateWebhook(endpointId: string, patch: { enabled: boolean } | null) { if (!base || !accessToken) return; const retryKey = patch === null && pendingDelete?.endpointId === endpointId ? pendingDelete.idempotencyKey : null; if (patch === null && retryKey === null && !window.confirm('Delete this webhook endpoint and remove its signing secret?')) return; setMessage(null); setMessageIsError(false); const idempotencyKey = retryKey ?? crypto.randomUUID(); if (patch === null) setPendingDelete({ endpointId, idempotencyKey }); try { const response = await mutate(`${base}/webhooks/${encodeURIComponent(endpointId)}`, { method: patch ? 'PATCH' : 'DELETE', headers: { Authorization: `Bearer ${accessToken}`, ...(patch ? { 'Content-Type': 'application/json' } : {}), ...(patch === null ? { 'Idempotency-Key': idempotencyKey } : {}) }, ...(patch ? { body: JSON.stringify(patch) } : {}) }); if (!response.ok && response.status !== 204) { if (patch === null && response.status === 503) setPendingDelete({ endpointId, idempotencyKey }); throw new Error(patch === null && response.status === 503 ? 'Webhook is disabled but secret cleanup is pending. Retry cleanup with the same operation.' : 'Webhook update failed. Check your organization role and endpoint state.'); } success(patch ? `Webhook ${patch.enabled ? 'enabled' : 'paused'}.` : 'Webhook deleted and its secret cleanup completed.'); if (patch === null) setPendingDelete(null); if (deliveryEndpointId === endpointId) setDeliveryEndpointId(null); webhooks.refetch(); } catch (failure) { fail(failure instanceof Error ? failure.message : 'Webhook update failed'); } }
  async function rotateWebhook(endpointId: string) { if (!base || !accessToken) return; setMessage(null); setMessageIsError(false); const retry = pendingRotation?.endpointId === endpointId ? pendingRotation.idempotencyKey : null; const idempotencyKey = retry ?? crypto.randomUUID(); setPendingRotation({ endpointId, idempotencyKey }); try { const response = await mutate(`${base}/webhooks/${encodeURIComponent(endpointId)}/rotate-secret`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Idempotency-Key': idempotencyKey } }); const raw: unknown = await response.json(); if (!response.ok) throw new Error('Secret rotation failed; if cleanup is pending, retry the same endpoint action.'); const rotated = WebhookRotatedSchema.safeParse(raw); if (rotated.success) { if (rotated.data.cleanupPending) setPendingRotation({ endpointId, idempotencyKey }); else setPendingRotation(null); setOneTimeSecret({ title: 'New webhook signing secret — shown once', label: `Endpoint ${rotated.data.endpointId}${rotated.data.cleanupPending ? ' · prior secret cleanup pending' : ''}`, value: rotated.data.signingSecret }); success(rotated.data.cleanupPending ? 'Secret rotated. The previous secret still needs cleanup. Use Retry cleanup to repeat this same idempotent operation.' : 'Secret rotated. Update the receiver now; this value will not be shown again.'); } else if (retry !== null && WebhookRotationReplaySchema.safeParse(raw).success) { setPendingRotation(null); success('Cleanup retry completed using the original idempotency key. The new secret remains the value shown during the first rotation.'); } else throw new Error('The API response did not match the documented secret-rotation contract.'); } catch (failure) { fail(failure instanceof Error ? failure.message : 'Secret rotation failed'); } }
  const endpointRows = (webhooks.data?.endpoints ?? []).map((endpoint) => [endpoint.url, endpoint.eventTypes.join(', '), <StatusPill key={`${endpoint.id}-status`} value={endpoint.enabled ? 'ACTIVE' : 'PAUSED'} />, <div className="row-actions" key={`${endpoint.id}-actions`}><button className="button button-small button-outline" onClick={() => setDeliveryEndpointId(endpoint.id)}>Deliveries</button><button className="button button-small button-outline" onClick={() => void updateWebhook(endpoint.id, { enabled: !endpoint.enabled })}>{endpoint.enabled ? 'Pause' : 'Enable'}</button><button className="button button-small button-outline" onClick={() => void rotateWebhook(endpoint.id)}>{pendingRotation?.endpointId === endpoint.id ? 'Retry cleanup' : 'Rotate secret'}</button><button className="button button-small button-outline" onClick={() => void updateWebhook(endpoint.id, null)}>{pendingDelete?.endpointId === endpoint.id ? 'Retry cleanup' : 'Delete'}</button></div>]);
  return <><PageHeader eyebrow="Organization / integrations" title="Integrations" description="Manage model-provider credentials and webhook endpoints. Provider keys support agent reasoning; they do not grant transaction authority." />{providers.loading || webhooks.loading ? <LoadingState /> : providers.error || webhooks.error ? <ErrorState message={providers.error ?? webhooks.error ?? 'Integration request failed'} /> : <div className="console-grid"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">Model access / secret adapter</p><h2>Provider credential</h2></div></div><div className="credential-list">{(providers.data?.credentials ?? []).map((credential) => <div className="credential-row" key={credential.provider}><div><strong>{credential.provider}</strong><small>•••• {credential.maskedSuffix} · {credential.state}</small></div><div className="row-actions">{credential.state === 'ACTIVE' && <button className="button button-small button-outline" onClick={() => void testProvider(credential.provider)}>Test connection</button>}{credential.state !== 'DISABLED' && <button className="button button-small button-outline" onClick={() => void changeProvider(credential.provider, 'disable')}>Disable</button>}<button className="button button-small button-outline" onClick={() => void changeProvider(credential.provider, 'delete')}>Remove</button></div></div>)}</div><form className="form-stack" onSubmit={(event) => void saveKey(event)}><label>Provider<select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)}><option value="DEEPSEEK">DeepSeek</option><option value="OPENAI">OpenAI</option><option value="ANTHROPIC">Anthropic</option><option value="OTHER">Other</option></select></label><label>API key<input type="password" required minLength={16} maxLength={4096} autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label><p className="form-hint">Sent directly to the backend over this same-origin API. It is never printed to logs or shown again.</p><button className="button button-primary">Save credential</button></form></section><section className="panel"><div className="panel-heading"><div><p className="eyebrow">Event delivery / outbox</p><h2>Webhooks</h2></div></div><DataTable columns={['Endpoint', 'Events', 'Status', 'Actions']} rows={endpointRows} emptyTitle="No webhooks" emptyText="Create an HTTPS endpoint to receive configured organization events." /><form className="form-stack webhook-form" onSubmit={(event) => void createWebhook(event)}><label>HTTPS endpoint<input type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/mandate-events" /></label><label>Event types (comma-separated)<input required value={endpointEvents} onChange={(event) => setEndpointEvents(event.target.value)} /></label><button className="button button-outline"><Plus size={16} /> Add endpoint</button></form></section>{deliveryEndpointId && <section className="panel wide-note"><div className="panel-heading"><div><p className="eyebrow">Endpoint / recent attempts</p><h2>Delivery history</h2></div><button className="button button-small button-outline" onClick={() => setDeliveryEndpointId(null)}>Close</button></div>{deliveries.loading ? <LoadingState /> : deliveries.error ? <ErrorState message={deliveries.error} /> : <DataTable columns={['Event', 'Status', 'Attempts', 'Next attempt', 'Last result']} rows={(deliveries.data?.deliveries ?? []).map((delivery) => [delivery.eventType, <StatusPill value={delivery.status} key={delivery.status} />, String(delivery.attempts), formatDate(delivery.availableAt), delivery.lastErrorCode ?? (delivery.deliveredAt ? `Delivered ${formatDate(delivery.deliveredAt)}` : '—')])} emptyTitle="No delivery attempts" emptyText="Delivery attempts will appear after matching outbox events are available." />}</section>}{message && <p className={messageIsError ? 'form-error wide-note' : 'success-note wide-note'}>{message}</p>}</div>}<OneTimeSecret open={oneTimeSecret !== null} title={oneTimeSecret?.title ?? ''} label={oneTimeSecret?.label ?? ''} value={oneTimeSecret?.value ?? ''} onClose={() => setOneTimeSecret(null)} /></>;
}

function StatusPill({ value }: { value: string }) { const normalized = value.toLowerCase(); return <span className={`status-pill ${normalized === 'provisioning' || normalized.includes('held') || normalized.includes('tentative') || normalized.includes('draft') ? 'status-warn' : normalized.includes('active') || normalized === 'final' || normalized === 'allow' || normalized === 'approved' ? 'status-good' : normalized.includes('deny') || normalized.includes('error') || normalized.includes('reorg') || normalized.includes('revoked') ? 'status-bad' : ''}`}>{value.replaceAll('_', ' ')}</span>; }
function OneTimeSecret({ open, title, label, value, onClose }: { open: boolean; title: string; label: string; value: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => { setCopied(false); setCopyError(false); }, [value, open]);
  async function copySecret() { try { await navigator.clipboard.writeText(value); setCopied(true); setCopyError(false); } catch { setCopyError(true); } }
  return <Modal open={open} onClose={onClose} title={title}><div className="form-stack"><p className="eyebrow">{label}</p><p className="form-hint">This secret is held only in this page's memory and disappears when you close this dialog. Save it in a trusted secret manager before closing.</p><code className="secret-value">{value}</code><button className="button button-primary" onClick={() => void copySecret()}><Copy size={15} /> {copied ? 'Copied' : 'Copy secret'}</button>{copyError && <p className="form-error" role="status">Clipboard access failed. Select and copy the secret manually before closing.</p>}</div></Modal>;
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    focusables()[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) { event.preventDefault(); dialog?.focus(); return; }
      const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      if (restoreFocusRef.current?.isConnected) restoreFocusRef.current.focus();
    };
  }, [open]);
  if (!open) return null;
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className="modal-card" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><div className="modal-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X /></button></div>{children}</section></div>;
}
function jsonText(value: import('zod').JSONType | undefined): string { return value === undefined ? '—' : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value); }
function formatDate(value: string) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed); }
function short(value: string) { return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value; }

export function App() {
  const organization = useOrganizationState();
  const publicElements = <><Route path="/" element={<HomePage />} /><Route path="/how-it-works" element={<HowItWorksPage />} /><Route path="/security" element={<SecurityPage />} /><Route path="/integrations" element={<IntegrationsPage />} /><Route path="/developers" element={<DevelopersPage />} /><Route path="/login" element={<LoginPage />} /><Route path="/login/callback" element={<LoginCallback />} /><Route path={INVITATION_ROUTE} element={<InvitationAcceptancePage />} /></>;
  return <OrganizationContext.Provider value={organization}><PageScrollProgress /><AnimatePresence mode="wait"><Routes key={window.location.pathname}>{publicElements}{appRoutes.map((route) => <Route key={route.id} path={route.path} element={<AuthGate><AppShell><ConsolePage routeId={route.id} /></AppShell></AuthGate>} />)}<Route path="*" element={<NotFoundPage />} /></Routes></AnimatePresence></OrganizationContext.Provider>;
}

function ConsolePage({ routeId }: { routeId: string }) {
  const location = useLocation();
  if (matchRoute(location.pathname) === undefined) return <NotFoundPage />;
  switch (routeId) {
    case 'overview': return <AppOverviewPage />;
    case 'agents': return <AgentsPage />;
    case 'agent-detail': return <AgentDetailPage />;
    case 'policies': return <PoliciesPage />;
    case 'policy-create': return <PolicyEditorPage />;
    case 'policy-detail': return <PolicyDetailPage />;
    case 'policy-edit': return <PolicyEditorPage revision />;
    case 'policy-simulate': return <PolicySimulatePage />;
    case 'approvals': return <ApprovalsPage />;
    case 'activity': return <ActivityPage />;
    case 'activity-detail': return <ActivityDetailPage />;
    case 'team': return <TeamPage />;
    case 'accounts': return <AccountsPage />;
    case 'integrations-settings': return <IntegrationsSettingsPage />;
    default: return <NotFoundPage />;
  }
}

function NotFoundPage() { return <PublicLayout><main className="not-found"><p className="eyebrow">404 / route not found</p><h1>This path<br /><em>isn’t in scope.</em></h1><Link className="button button-primary" to="/">Back to overview <ArrowRight size={16} /></Link></main></PublicLayout>; }
