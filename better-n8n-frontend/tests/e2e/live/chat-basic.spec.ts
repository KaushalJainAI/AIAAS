/**
 * LIVE: one plain chat turn on the real model (costs money).
 *
 * Skipped unless E2E_LIVE_MODEL=1 and E2E_OPENROUTER_KEY are set, and skipped
 * again if the run's budget is spent. See tests/README.md.
 *
 * The prompt is tiny on purpose: a single word back keeps the spend to a few
 * cents, and a reply that contains PONG proves the whole path works: the
 * credential, the model choice, the provider call and the answer coming back.
 */
import { expect, test } from '@playwright/test';

import { LIVE_ENABLED, budgetBlock } from './helpers/budget';
import { createChatSession, liveAccount, liveTest, sendChat } from './helpers/live';

test.skip(!LIVE_ENABLED, 'live spec: set E2E_LIVE_MODEL=1 and E2E_OPENROUTER_KEY to run it');
test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  const reason = await budgetBlock();
  test.skip(reason !== null, reason ?? '');
});

test.describe('@live chat — live basic turn', () => {
  test('the model answers a one-word prompt with PONG', async () => {
    test.setTimeout(90_000);
    await liveTest('chat-basic', async () => {
      const { api } = await liveAccount();
      try {
        const sessionId = await createChatSession(api, 'e2e basic');
        const reply = await sendChat(api, sessionId, 'Reply with exactly the word PONG.');
        // Case-insensitive: the model may add a full stop or change the case.
        expect(reply.ai_response.content).toMatch(/PONG/i);
      } finally {
        await api.dispose();
      }
    });
  });
});
