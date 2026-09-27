import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers } from './msw/handlers';

// Mock IntersectionObserver / ResizeObserver / matchMedia for libraries that need them
class MockObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error -- jsdom polyfill
globalThis.IntersectionObserver = MockObserver;
// @ts-expect-error -- jsdom polyfill
globalThis.ResizeObserver = MockObserver;

if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  });
}

export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
