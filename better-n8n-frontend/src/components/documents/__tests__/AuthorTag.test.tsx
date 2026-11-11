// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import AuthorTag from '../AuthorTag';

afterEach(cleanup);

describe('AuthorTag', () => {
  it('tags a file an agent wrote, in the agent colour', () => {
    render(<AuthorTag author={{ kind: 'agent', name: 'Reporter', agent_id: 4, execution_id: null }} />);
    const tag = screen.getByText('by Reporter');
    expect(tag.parentElement?.className).toContain('text-agent');
    expect(tag.parentElement?.className).toContain('bg-agent-subtle');
  });

  it('says nothing for a file a person wrote in chat', () => {
    const { container } = render(
      <AuthorTag author={{ kind: 'chat', name: 'Asha', agent_id: null, execution_id: null }} />,
    );
    expect(container.textContent).toBe('');
  });

  it('says nothing for an older row with no author', () => {
    const { container } = render(<AuthorTag author={null} />);
    expect(container.innerHTML).toBe('');
  });
});
