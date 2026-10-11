import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupOptions } from 'node:dns';
import { isPublicAddress, validatePublicHttpsWebhookUrl, PublicHttpsWebhookTransport, PublicHttpsWebhookUrlValidator, type WebhookDnsResolver } from '../src/webhooks/https-webhook-transport.js';

const resolver = (addresses: readonly { readonly address: string; readonly family: number }[]): WebhookDnsResolver => ({
  async lookup() { return addresses; },
});

describe('public HTTPS webhook destination validation', () => {
  it('allows public IPv4 and public DNS answers', async () => {
    await expect(validatePublicHttpsWebhookUrl('https://203.0.113.8/hook', resolver([]))).rejects.toThrow('WEBHOOK_URL_PRIVATE_ADDRESS');
    await expect(validatePublicHttpsWebhookUrl('https://198.51.100.8/hook', resolver([]))).rejects.toThrow('WEBHOOK_URL_PRIVATE_ADDRESS');
    await expect(validatePublicHttpsWebhookUrl('https://example.test/hook', resolver([
      { address: '8.8.8.8', family: 4 }, { address: '2606:4700:4700::1111', family: 6 },
    ]))).resolves.toBeInstanceOf(URL);
  });

  it('rejects non-HTTPS, credentials, fragments, nonstandard ports, and local hostnames', async () => {
    for (const value of [
      'http://example.test/hook', 'https://user:pass@example.test/hook', 'https://example.test/hook#frag', 'https://example.test/hook?token=secret',
      'https://example.test:8443/hook', 'https://localhost/hook', 'https://service.localhost/hook',
    ]) await expect(validatePublicHttpsWebhookUrl(value, resolver([{ address: '8.8.8.8', family: 4 }]))).rejects.toThrow('WEBHOOK_URL_INVALID');
  });

  it('rejects any private or malformed DNS answer and reserved literal ranges', async () => {
    for (const address of ['127.0.0.1', '10.4.0.1', '169.254.1.1', '192.168.0.2', '::1', 'fc00::1', 'fe80::1', '4000::1', '::ffff:808:808']) {
      expect(isPublicAddress(address)).toBe(false);
    }
    await expect(validatePublicHttpsWebhookUrl('https://rebind.example/hook', resolver([
      { address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 },
    ]))).rejects.toThrow('WEBHOOK_URL_PRIVATE_ADDRESS');
    await expect(validatePublicHttpsWebhookUrl('https://bad.example/hook', resolver([{ address: 'not-ip', family: 0 }]))).rejects.toThrow('WEBHOOK_URL_PRIVATE_ADDRESS');
  });

  it('rejects empty and failed DNS resolution', async () => {
    await expect(validatePublicHttpsWebhookUrl('https://empty.example/hook', resolver([]))).rejects.toThrow('WEBHOOK_URL_PRIVATE_ADDRESS');
    await expect(validatePublicHttpsWebhookUrl('https://failed.example/hook', { async lookup() { throw new Error('dns'); } })).rejects.toThrow('WEBHOOK_URL_DNS_FAILED');
  });
});

type Address = { readonly address: string; readonly family: number };
type LookupResult = (error: NodeJS.ErrnoException | null, address: string | Address[], family?: number) => void;
interface RequestOptions {
  readonly method: string; readonly headers: Readonly<Record<string, string | number>>;
  readonly servername: string; readonly timeout: number; readonly maxHeaderSize: number;
  readonly lookup: (hostname: string, options: LookupOptions, callback: LookupResult) => void;
}
interface ResponseDouble { readonly statusCode?: number; resume(): void }
const transportDouble = vi.hoisted(() => {
  const listeners = new Map<string, (error: Error) => void>();
  const state: { options?: RequestOptions; respond?: (response: ResponseDouble) => void; body?: string } = {};
  const destroy = vi.fn((error: Error): void => { listeners.get('error')?.(error); });
  const request = vi.fn((url: URL, options: RequestOptions, respond: (response: ResponseDouble) => void) => {
    state.options = options; state.respond = respond;
    return {
      once(event: string, callback: (error: Error) => void) { listeners.set(event, callback); return this; },
      destroy,
      end(body: string): void { state.body = body; },
    };
  });
  const systemLookup = vi.fn(async (): Promise<Address[]> => [{ address: '8.8.8.8', family: 4 }]);
  return { listeners, state, destroy, request, systemLookup };
});
vi.mock('node:https', () => ({ request: transportDouble.request }));
vi.mock('node:dns/promises', () => ({ lookup: transportDouble.systemLookup }));
const webhookInput = { url: 'https://hooks.example.test/events', deliveryId: 'delivery-test', eventType: 'ACTION_APPROVED',
  timestampSeconds: 1_900_000_000, body: JSON.stringify({ message: 'é' }), signature: `sha256=${'a'.repeat(64)}` };

beforeEach(() => {
  transportDouble.listeners.clear();
  delete transportDouble.state.options; delete transportDouble.state.respond; delete transportDouble.state.body;
  transportDouble.request.mockClear(); transportDouble.destroy.mockClear(); transportDouble.systemLookup.mockClear();
});
async function pendingDelivery(input = webhookInput, dns: WebhookDnsResolver = resolver([{ address: '8.8.8.8', family: 4 }])) {
  const promise = new PublicHttpsWebhookTransport(dns, 100).send(input);
  await vi.waitFor(() => expect(transportDouble.request).toHaveBeenCalledOnce());
  const options = transportDouble.state.options;
  const respond = transportDouble.state.respond;
  if (options === undefined || respond === undefined) throw new Error('Expected a captured transport request');
  return { promise, options, respond };
}

describe('HTTPS webhook delivery contract with isolated transport boundaries', () => {
  it.each([99, 15001, 1.5, Number.NaN])('rejects unsupported timeout before creating a request (%#)', (timeout) => {
    expect(() => new PublicHttpsWebhookTransport(resolver([]), timeout)).toThrow(RangeError);
    expect(transportDouble.request).not.toHaveBeenCalled();
  });
  it.each([200, 204, 429, 503, undefined])('drains the response and returns its status without treating delivery as success (%#)', async (statusCode) => {
    const { promise, options, respond } = await pendingDelivery();
    const resume = vi.fn();
    respond(statusCode === undefined ? { resume } : { resume, statusCode });
    await expect(promise).resolves.toBe(statusCode ?? 0);
    expect(resume).toHaveBeenCalledOnce();
    expect(transportDouble.state.body).toBe(webhookInput.body);
    expect(options).toMatchObject({ method: 'POST', servername: 'hooks.example.test', timeout: 100, maxHeaderSize: 16384 });
    expect(options.headers).toEqual({ 'content-type': 'application/json', 'content-length': Buffer.byteLength(webhookInput.body, 'utf8'),
      'user-agent': 'Mandate-Webhooks/1.0', 'x-mandate-delivery': webhookInput.deliveryId,
      'x-mandate-event': webhookInput.eventType, 'x-mandate-timestamp': String(webhookInput.timestampSeconds),
      'x-mandate-signature': webhookInput.signature });
  });
  it('destroys timed-out requests and rejects with the bounded timeout error', async () => {
    const { promise } = await pendingDelivery();
    const rejection = expect(promise).rejects.toThrow('WEBHOOK_TIMEOUT');
    transportDouble.listeners.get('timeout')?.(new Error('trigger'));
    await rejection;
    expect(transportDouble.destroy).toHaveBeenCalledOnce();
  });
  it('propagates request errors without a timer or real socket', async () => {
    const { promise } = await pendingDelivery();
    const error = new Error('TEST_TRANSPORT_FAILED');
    const rejection = expect(promise).rejects.toBe(error);
    transportDouble.listeners.get('error')?.(error);
    await rejection;
  });
  it.each([
    { ...webhookInput, body: 'x'.repeat(65537) }, { ...webhookInput, timestampSeconds: 1.5 },
    { ...webhookInput, signature: 'invalid' },
  ])('rejects invalid delivery input before HTTPS (%#)', async (input) => {
    await expect(new PublicHttpsWebhookTransport(resolver([{ address: '8.8.8.8', family: 4 }])).send(input)).rejects.toThrow('WEBHOOK_REQUEST_INVALID');
    expect(transportDouble.request).not.toHaveBeenCalled();
  });
  it('accepts the maximum payload and prevents delivery to blocked destinations', async () => {
    const { promise, respond } = await pendingDelivery({ ...webhookInput, body: 'x'.repeat(65536) });
    respond({ resume() {}, statusCode: 202 }); await expect(promise).resolves.toBe(202);
    transportDouble.request.mockClear();
    await expect(new PublicHttpsWebhookTransport(resolver([{ address: '10.0.0.1', family: 4 }])).send(webhookInput)).rejects.toThrow('WEBHOOK_URL_PRIVATE_ADDRESS');
    expect(transportDouble.request).not.toHaveBeenCalled();
  });
  it.each(['https://8.8.8.8/hook', 'https://[2606:4700:4700::1111]/hook'])('validates a public literal without a DNS lookup (%s)', async (url) => {
    const lookup = vi.fn(async (): Promise<Address[]> => []);
    await expect(new PublicHttpsWebhookUrlValidator({ lookup }).validate(url)).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });
  it.each(['not-url', 'x'.repeat(2049)])('rejects malformed or oversized URLs (%#)', async (url) => {
    await expect(new PublicHttpsWebhookUrlValidator(resolver([])).validate(url)).rejects.toThrow('WEBHOOK_URL_INVALID');
  });
  it('uses the injected system DNS boundary without external resolution', async () => {
    await expect(new PublicHttpsWebhookUrlValidator().validate(webhookInput.url)).resolves.toBeUndefined();
    expect(transportDouble.systemLookup).toHaveBeenCalledOnce();
  });
  it.each(['public', 'private', 'empty', 'failed'] as const)('revalidates DNS at connection time (%s)', async (mode) => {
    let count = 0;
    const dns: WebhookDnsResolver = { async lookup() {
      count += 1;
      if (count === 1 || mode === 'public') return [{ address: '8.8.8.8', family: 4 }];
      if (mode === 'failed') throw new Error('DNS_FAILED');
      return mode === 'empty' ? [] : [{ address: '127.0.0.1', family: 4 }];
    } };
    const { promise, options, respond } = await pendingDelivery(webhookInput, dns);
    const result = await new Promise<{ error: NodeJS.ErrnoException | null; address: string | Address[]; family?: number }>((resolve) => {
      options.lookup('hooks.example.test', {}, (error, address, family) => resolve({ error, address, ...(family === undefined ? {} : { family }) }));
    });
    if (mode === 'public') expect(result).toEqual({ error: null, address: '8.8.8.8', family: 4 });
    else {
      expect(result.error?.message).toBe(mode === 'failed' ? 'WEBHOOK_URL_DNS_FAILED' : 'WEBHOOK_URL_PRIVATE_ADDRESS');
      expect(result.address).toBe('');
      expect(result.family).toBe(0);
    }
    respond({ resume() {}, statusCode: 200 }); await promise;
  });
});
