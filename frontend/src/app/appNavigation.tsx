import { ClockCounterClockwise, HandPalm, Heartbeat, PlugsConnected, Robot, ShieldCheck, SquaresFour, UsersThree, Wallet } from '@phosphor-icons/react';
import type { ReactElement } from 'react';

export interface AppNavigationLink {
  readonly label: string;
  readonly href: string;
  readonly icon: ReactElement;
}

export interface AppNavigationGroup {
  readonly label: string;
  readonly links: readonly AppNavigationLink[];
}

export const APP_NAV: readonly AppNavigationGroup[] = [
  {
    label: 'Workspace',
    links: [
      { label: 'Overview', href: '/app/overview', icon: <SquaresFour size={18} weight="regular" /> },
      { label: 'Agents', href: '/app/agents', icon: <Robot size={18} weight="regular" /> },
      { label: 'Policies', href: '/app/policies', icon: <ShieldCheck size={18} weight="regular" /> },
      { label: 'Approvals', href: '/app/approvals', icon: <HandPalm size={18} weight="regular" /> },
      { label: 'Activity', href: '/app/activity', icon: <ClockCounterClockwise size={18} weight="regular" /> },
    ],
  },
  {
    label: 'Configure',
    links: [
      { label: 'Team', href: '/app/settings/team', icon: <UsersThree size={18} weight="regular" /> },
      { label: 'Accounts', href: '/app/settings/accounts', icon: <Wallet size={18} weight="regular" /> },
      { label: 'Integrations', href: '/app/settings/integrations', icon: <PlugsConnected size={18} weight="regular" /> },
      { label: 'System health', href: '/app/system-health', icon: <Heartbeat size={18} weight="regular" /> },
    ],
  },
];
