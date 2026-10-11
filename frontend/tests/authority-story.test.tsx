import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { AuthorityStory } from '../src/app/AuthorityStory';

it('renders an accessible text-only lifecycle without rights-held media', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<MemoryRouter><AuthorityStory /></MemoryRouter>));
    expect(host.querySelectorAll('.story-chapter')).toHaveLength(6);
    expect(host.textContent).toContain('Submitted is not settled.');
    expect(host.querySelector('video, img, canvas')).toBeNull();
    expect(host.querySelector('a[href="/app/overview"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
