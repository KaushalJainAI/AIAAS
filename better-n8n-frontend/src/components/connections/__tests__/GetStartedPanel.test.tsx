// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { SetupGuide } from '@/api/mcp';
import GetStartedPanel from '../GetStartedPanel';

afterEach(cleanup);

const guide = (over: Partial<SetupGuide> = {}): SetupGuide => ({
  you_need: [],
  admin_needed: null,
  cost: '',
  time: '',
  steps: [{ text: 'Open the app' }],
  limits: [],
  ...over,
});

describe('GetStartedPanel', () => {
  it('renders the steps as a numbered list in order', () => {
    render(
      <GetStartedPanel
        guide={guide({
          steps: [{ text: 'First' }, { text: 'Second' }, { text: 'Third' }],
        })}
      />,
    );
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['First', 'Second', 'Third']);
    expect(screen.getByRole('list').tagName).toBe('OL');
  });

  it('opens a step link in a new tab without leaking the opener', () => {
    render(
      <GetStartedPanel
        guide={guide({
          steps: [{ text: 'Create a key', url: 'https://example.com/keys' }],
        })}
      />,
    );
    const link = screen.getByRole('link', { name: /open page/i });
    expect(link.getAttribute('href')).toBe('https://example.com/keys');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('does not render a link for a step whose url is not http(s)', () => {
    render(
      <GetStartedPanel
        guide={guide({ steps: [{ text: 'Click', url: 'javascript:alert(1)' }] })}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Click')).toBeTruthy();
  });

  it('renders nothing for empty you_need, limits, cost, time and admin_needed', () => {
    render(<GetStartedPanel guide={guide()} />);
    expect(screen.queryByText('You need')).toBeNull();
    expect(screen.queryByText('Good to know')).toBeNull();
    expect(screen.queryByText(/Admin approval/)).toBeNull();
    expect(screen.queryByText(/Cost:/)).toBeNull();
    expect(screen.queryByText(/Time:/)).toBeNull();
    expect(screen.getByText('Open the app')).toBeTruthy();
  });

  it('renders the sections that are filled, in order, with cost and time on one line', () => {
    const { container } = render(
      <GetStartedPanel
        guide={guide({
          you_need: ['A Google account'],
          admin_needed: 'Your workspace admin must approve it.',
          cost: 'Free',
          time: '5 minutes',
          limits: ['Read-only access'],
        })}
      />,
    );
    expect(screen.getByText('A Google account')).toBeTruthy();
    expect(screen.getByText(/Your workspace admin must approve it/)).toBeTruthy();
    expect(screen.getByText('Cost: Free')).toBeTruthy();
    expect(screen.getByText('Time: 5 minutes')).toBeTruthy();
    expect(screen.getByText('Read-only access')).toBeTruthy();

    const headings = Array.from(container.querySelectorAll('h3')).map((h) => h.textContent);
    expect(headings).toEqual(['You need', 'Steps', 'Good to know']);
  });
});
