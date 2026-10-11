import { describe, expect, it } from 'vitest';
import { SidebarAmbient } from '../src/app/SidebarAmbient';

describe('sidebar ambient field', () => {
  it('marks top and inter-section fields as decorative and keeps their placement explicit', () => {
    const top = SidebarAmbient({ placement: 'top' });
    const gap = SidebarAmbient({ placement: 'gap' });

    expect(top.props).toMatchObject({ className: 'sidebar-ambient-field sidebar-ambient-top', 'aria-hidden': 'true' });
    expect(gap.props).toMatchObject({ className: 'sidebar-ambient-field sidebar-ambient-gap', 'aria-hidden': 'true' });
  });
});
