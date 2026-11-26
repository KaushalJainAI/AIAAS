// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Activity } from 'lucide-react';

import PageHeader from '../PageHeader';
import HubTabs from '../HubTabs';
import { HubHeaderProvider } from '../hubHeader';

afterEach(cleanup);

function inShell(path: string, header: boolean) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HubHeaderProvider>
        <HubTabs />
        {header && (
          <PageHeader
            title="Agents"
            subtitle="31 agents · 11 categories · 63 runs"
            icon={Activity}
            actions={<button type="button">New agent</button>}
          />
        )}
      </HubHeaderProvider>
    </MemoryRouter>,
  );
}

describe('PageHeader', () => {
  it('draws one row: title and actions, and no subtitle', () => {
    const { container } = render(
      <PageHeader
        title="Activity"
        subtitle="2 need you · 3 live"
        icon={Activity}
        actions={<button type="button">Refresh</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeTruthy();
    expect(screen.queryByText('2 need you · 3 live')).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    const row = container.querySelector('.h-11');
    expect(row?.className).toMatch(/md:h-14/);
    expect(row?.className).toMatch(/border-b/);
  });

  it('keeps the mobile menu button in the row', () => {
    render(<PageHeader title="Documents" subtitle="" icon={Activity} />);
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeTruthy();
  });

  it('renders children beneath the row', () => {
    render(
      <PageHeader title="Skills" subtitle="" icon={Activity}>
        <div>Filter row</div>
      </PageHeader>,
    );
    expect(screen.getByText('Filter row')).toBeTruthy();
  });
});

describe('hub pages: tabs and actions in one row', () => {
  it('puts the hub tabs inside the header and hides the standalone strip', () => {
    inShell('/agents', true);
    // Exactly one tab strip on the page, and it is the header's.
    const navs = screen.getAllByRole('navigation', { name: 'Agents sections' });
    expect(navs).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'My agents' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'New agent' })).toBeTruthy();
    // The title stays for screen readers; the count line is gone.
    expect(screen.getByRole('heading', { name: 'Agents' })).toBeTruthy();
    expect(screen.queryByText(/31 agents/)).toBeNull();
  });

  it('keeps the standalone strip for a hub page with no header', () => {
    inShell('/documents', false);
    expect(screen.getAllByRole('navigation', { name: 'Library sections' })).toHaveLength(1);
  });

  it('shows no tabs on a page outside a hub', () => {
    inShell('/runs', true);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Agents' })).toBeTruthy();
  });
});
