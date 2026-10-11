import { describe, expect, it } from 'vitest';
import { APP_NAV } from '../src/app/appNavigation';

describe('console navigation', () => {
  it('gives each destination a distinct semantic icon', () => {
    const links = APP_NAV.flatMap((group) => group.links);

    expect(links.map(({ label }) => label)).toEqual([
      'Overview', 'Agents', 'Policies', 'Approvals', 'Activity',
      'Team', 'Accounts', 'Integrations', 'System health',
    ]);
    expect(links.every(({ icon }) => icon !== null && icon !== undefined)).toBe(true);
    expect(new Set(links.map(({ icon }) => icon.type)).size).toBe(links.length);
  });
});
