// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import Code from '../Code';

afterEach(cleanup);

describe('Code placeholder page', () => {
  it('says the coding workspace is not available yet', () => {
    render(
      <MemoryRouter>
        <Code />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Code' })).toBeTruthy();
    expect(screen.getByText('The coding workspace is not available yet')).toBeTruthy();
    expect(screen.getByText(/Chat still works for questions about code/)).toBeTruthy();
  });

  it('links back to chat', () => {
    render(
      <MemoryRouter>
        <Code />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Back to chat' });
    expect(link.getAttribute('href')).toBe('/ai-chat');
  });
});
