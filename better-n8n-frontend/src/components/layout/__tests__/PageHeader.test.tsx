// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';

import PageHeader from '../PageHeader';

afterEach(cleanup);

describe('PageHeader', () => {
  it('draws one 44px row: title, inline subtitle, actions on the right', () => {
    const { container } = render(
      <PageHeader
        title="Activity"
        subtitle="2 need you · 3 live"
        icon={Activity}
        actions={<button type="button">Refresh</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeTruthy();
    expect(screen.getByText('2 need you · 3 live')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();

    const row = container.querySelector('.h-11');
    expect(row).not.toBeNull();
    expect(row?.className).toMatch(/border-b/);
  });

  it('keeps the mobile menu button in the title row', () => {
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
