import { http, HttpResponse } from 'msw';

const BASE = 'http://localhost:8000';

// Default fixtures — override in individual tests with server.use(...)
export const handlers = [
  http.post(`${BASE}/api/auth/login/`, async ({ request }) => {
    const body = (await request.json()) as { email?: string; password?: string };
    if (!body?.email || !body?.password) {
      return HttpResponse.json({ detail: 'Missing field' }, { status: 400 });
    }
    if (body.password === 'wrong') {
      return HttpResponse.json({ detail: 'Invalid' }, { status: 401 });
    }
    return HttpResponse.json({ access: 'fake-jwt', refresh: 'fake-refresh' });
  }),

  http.get(`${BASE}/api/auth/profile/`, () =>
    HttpResponse.json({ id: 1, username: 'alice', email: 'alice@example.com' }),
  ),

  http.get(`${BASE}/api/orchestrator/workflows/`, () => HttpResponse.json({ results: [] })),

  http.post(`${BASE}/api/orchestrator/workflows/`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ id: 42, ...body }, { status: 201 });
  }),

  // Shapes as `src/api/credentials.ts` and `src/api/mcp.ts` read them today:
  // both are wrapped objects, not bare arrays. The old fixtures predated that
  // and pointed at routes (`credentials/credentials/`) that no longer exist.
  http.get(`${BASE}/api/credentials/`, () => HttpResponse.json({ credentials: [] })),
  http.get(`${BASE}/api/credentials/types/`, () =>
    HttpResponse.json({
      types: [
        {
          id: 1,
          name: 'GitHub',
          slug: 'github',
          fields_schema: [{ name: 'token', label: 'Token', type: 'password', required: true }],
        },
      ],
    }),
  ),

  http.get(`${BASE}/api/mcp/servers/`, () =>
    HttpResponse.json({
      servers: [
        {
          id: 1,
          name: 'notion',
          label: 'Notion',
          category: 'productivity',
          type: 'http',
          required_credential_types: [],
          enabled: true,
          effective_enabled: true,
          coming_soon: false,
          is_system: true,
          user: null,
        },
      ],
    }),
  ),
];
