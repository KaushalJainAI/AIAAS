/**
 * LIVE: a chat turn that must call a tool (costs money).
 *
 * Skipped unless E2E_LIVE_MODEL=1 and E2E_OPENROUTER_KEY are set, and skipped
 * again if the run's budget is spent.
 *
 * The clock tool is the cheapest honest tool: it reads nothing, changes
 * nothing, and the model cannot know the time without it. So a finished answer
 * plus a `get_current_time` step in the turn's tool trace shows the tool loop
 * ran end to end, the same step the chat shows as a tool receipt.
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

test.describe('@live chat — live tool turn', () => {
  test('the model calls the clock tool and answers', async () => {
    test.setTimeout(90_000);
    await liveTest('chat-tool', async () => {
      const { api } = await liveAccount();
      try {
        const sessionId = await createChatSession(api, 'e2e clock tool');
        const reply = await sendChat(
          api,
          sessionId,
          'What is the current date and time? Use your clock tool.',
        );
        // The tool step is recorded on the assistant message (the same trace
        // the chat draws as a receipt under the answer).
        const tools = (reply.ai_response.metadata.tool_trace ?? []).map((step) => step.tool);
        expect(tools, `tool steps seen: ${tools.join(', ') || 'none'}`).toContain('get_current_time');
        expect(reply.ai_response.content.trim().length).toBeGreaterThan(0);
      } finally {
        await api.dispose();
      }
    });
  });
});
