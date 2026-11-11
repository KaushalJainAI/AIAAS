// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../contexts/authState', () => ({
  useAuth: () => ({ isAuthenticated: true, user: null }),
}));
vi.mock('../../../hooks/useHitlPending', () => ({
  useHitlPending: () => ({ data: [] }),
}));
vi.mock('../../../hooks/useActivityLive', () => ({
  useLiveCount: () => 0,
}));

import MobileBottomNav from '../MobileBottomNav';

afterEach(cleanup);

describe('MobileBottomNav', () => {
  it('is a 60px bar with five items in one row', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/runs']}>
        <MobileBottomNav />
      </MemoryRouter>,
    );
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy();
    expect(container.querySelector('.h-\\[60px\\]')).not.toBeNull();
    expect(container.querySelector('.grid-cols-5')).not.toBeNull();
  });

  it('keeps New chat as a plain item with a label, not a raised round button', () => {
    render(
      <MemoryRouter initialEntries={['/runs']}>
        <MobileBottomNav />
      </MemoryRouter>,
    );
    const newChat = screen.getByRole('button', { name: 'New chat' });
    expect(newChat.textContent).toContain('New');
    expect(newChat.className).not.toMatch(/rounded-full/);
    expect(newChat.className).not.toMatch(/-translate-y/);
    expect(newChat.className).not.toMatch(/shadow-md/);
  });

  it('keeps the existing destinations and their labels', () => {
    render(
      <MemoryRouter initialEntries={['/runs']}>
        <MobileBottomNav />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /Ask/ }).getAttribute('href')).toBe('/ai-chat');
    expect(screen.getByRole('link', { name: /Agents/ }).getAttribute('href')).toBe('/agents');
    expect(screen.getByRole('link', { name: /Activity/ }).getAttribute('href')).toBe('/runs');
    expect(screen.getByRole('button', { name: 'More destinations' })).toBeTruthy();
  });

  it('marks the active destination', () => {
    render(
      <MemoryRouter initialEntries={['/runs']}>
        <MobileBottomNav />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /Activity/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /Ask/ }).getAttribute('aria-current')).toBeNull();
  });
});
