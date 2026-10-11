import { describe, expect, it } from 'vitest';
import { apiReadinessState } from '../src/app/apiReadinessState';

describe('API readiness badge', () => {
  it('reflects the authenticated, database-backed profile request', () => {
    expect(apiReadinessState(true, null, false)).toBe('checking');
    expect(apiReadinessState(false, null, true)).toBe('ready');
    expect(apiReadinessState(false, 'Request failed', false)).toBe('unavailable');
    expect(apiReadinessState(false, null, false)).toBe('unavailable');
  });
});
