/**
 * Connections page: happy / sad / angry rendering against a mocked network.
 *
 * Replaces Connectors.test.tsx, which imported `src/pages/Connectors` — a page
 * merged into Connections and deleted, so the whole file failed to load. Mount
 * the real page, let it call the network boundary (MSW), assert what a user
 * sees.
 */
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { server } from './setup';

import Connections from '../../src/pages/Connections';

const SERVERS = 'http://localhost:8000/api/mcp/servers/';

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Connections />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Connections page — happy', () => {
  it('renders the connections returned by /api/mcp/servers/', async () => {
    renderPage();
    expect(await screen.findByText('Notion', {}, { timeout: 5000 })).toBeInTheDocument();
  });
});

describe('Connections page — sad', () => {
  it('says so when the server returns no connections', async () => {
    server.use(http.get(SERVERS, () => HttpResponse.json({ servers: [] })));
    renderPage();
    expect(
      await screen.findByText(/No connections available/i, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});

describe('Connections page — angry', () => {
  it('surfaces a 500 instead of an empty screen', async () => {
    server.use(http.get(SERVERS, () => HttpResponse.json({ detail: 'boom' }, { status: 500 })));
    renderPage();
    expect(
      await screen.findByText(/Could not load your connections/i, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('does not crash when the network errors out', async () => {
    server.use(http.get(SERVERS, () => HttpResponse.error()));
    renderPage();
    expect(
      await screen.findByText(/Could not load your connections/i, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});
