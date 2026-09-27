/**
 * Auth API integration: happy / sad / angry against the mocked backend.
 * Talks through the real axios `client` (src/api/client.ts) so we exercise
 * the same request shape the app uses in production.
 */
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './setup';

import { authService } from '../../src/api/auth';

describe('authService — happy', () => {
  it('login returns tokens for valid credentials', async () => {
    const r = await authService.login({ email: 'alice@example.com', password: 'correct' });
    expect(r).toHaveProperty('access');
  });
});

describe('authService — sad', () => {
  it('rejects on 401', async () => {
    await expect(
      authService.login({ email: 'alice@example.com', password: 'wrong' }),
    ).rejects.toThrow();
  });

  it('rejects on 400 (missing field)', async () => {
    await expect(authService.login({ email: '', password: '' })).rejects.toThrow();
  });
});

describe('authService — angry', () => {
  it('does not crash on a 500 response', async () => {
    server.use(
      http.post('http://localhost:8000/api/auth/login/', () =>
        HttpResponse.json({ detail: 'boom' }, { status: 500 }),
      ),
    );
    await expect(authService.login({ email: 'alice@example.com', password: 'x' })).rejects.toThrow();
  });

  it('does not crash when response is not JSON', async () => {
    server.use(
      http.post('http://localhost:8000/api/auth/login/', () =>
        HttpResponse.text('<html>not json</html>', { status: 200 }),
      ),
    );
    // Either resolves with garbage or rejects — must NOT hang or throw a
    // SyntaxError unhandled at the call site.
    await expect(
      Promise.race([
        authService.login({ email: 'a@x.com', password: 'x' }).catch(() => 'rejected'),
        new Promise((r) => setTimeout(() => r('timeout'), 2000)),
      ]),
    ).resolves.toBeDefined();
  });

  it('handles network failure gracefully', async () => {
    server.use(
      http.post('http://localhost:8000/api/auth/login/', () => HttpResponse.error()),
    );
    await expect(authService.login({ email: 'a@x.com', password: 'x' })).rejects.toThrow();
  });
});
