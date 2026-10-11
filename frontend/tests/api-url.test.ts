import { describe, expect, it } from 'vitest';
import { resolveApiUrl } from '../src/api/url.js';

describe('resolveApiUrl', () => {
  it('keeps same-origin paths when no API origin is configured', () => {
    expect(resolveApiUrl('/api/v1/me', '')).toBe('/api/v1/me');
  });

  it('joins API paths to the configured HTTPS API origin', () => {
    expect(resolveApiUrl('/api/v1/me', 'https://mandate-api.example')).toBe('https://mandate-api.example/api/v1/me');
  });

  it('allows HTTP only for loopback development', () => {
    expect(resolveApiUrl('/ops/readiness', 'http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/ops/readiness');
    expect(() => resolveApiUrl('/api/v1/me', 'http://api.example')).toThrow('HTTPS origin');
  });

  it('rejects path, credential, and external URL injection in API configuration', () => {
    expect(() => resolveApiUrl('/api/v1/me', 'https://user:pass@api.example')).toThrow('origin only');
    expect(() => resolveApiUrl('/api/v1/me', 'https://api.example/base')).toThrow('origin only');
    expect(() => resolveApiUrl('//evil.example/path', 'https://api.example')).toThrow('local API path');
    expect(() => resolveApiUrl('https://evil.example/path', 'https://api.example')).toThrow('local API path');
  });
});
