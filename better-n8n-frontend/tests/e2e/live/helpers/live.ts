/**
 * Shared setup for live specs: a fresh account, an OpenRouter key, the chat
 * model set through the API, and one helper per API call the specs make.
 *
 * Every live test starts from a new account, so no test depends on what an
 * earlier one left behind.
 */
import { expect, type APIRequestContext } from '@playwright/test';

import { API, apiAs, registerAccount, type Account } from '../../helpers/session';
import { appendLiveResult, LIVE_MODEL, spentThisRun } from './budget';

export { API, apiAs, registerAccount, signIn, type Account } from '../../helpers/session';

/** A fresh account with the OpenRouter key and the Haiku model set. */
export async function liveAccount(): Promise<{ account: Account; api: APIRequestContext }> {
  const account = await registerAccount();
  const api = await apiAs(account.access);
  await addOpenRouterKey(api, `e2e-openrouter-${Date.now()}`);
  await setChatModel(api);
  return { account, api };
}

/**
 * Store an OpenRouter key on the account, the same way the Credentials page
 * does (POST /api/credentials/). The key comes from E2E_OPENROUTER_KEY and is
 * sent once, to the API. It is never printed.
 */
export async function addOpenRouterKey(api: APIRequestContext, name: string): Promise<number> {
  const key = process.env.E2E_OPENROUTER_KEY;
  if (!key) throw new Error('E2E_OPENROUTER_KEY is not set');
  const types = await api.get(`${API}/api/credentials/types/`);
  const { types: list } = (await types.json()) as { types: { id: number; slug: string }[] };
  const openrouter = list.find((t) => t.slug === 'openrouter');
  if (!openrouter) throw new Error('no openrouter credential type seeded');
  const created = await api.post(`${API}/api/credentials/`, {
    data: { name, credential_type: openrouter.id, data: { apiKey: key } },
  });
  expect(created.status(), 'adding the OpenRouter key should succeed').toBe(201);
  return ((await created.json()) as { id: number }).id;
}

/**
 * Make Haiku the account's chat model, at medium effort, so new chats and
 * agents start on it. The profile fields are the same ones Settings writes.
 */
export async function setChatModel(api: APIRequestContext): Promise<void> {
  const r = await api.patch(`${API}/api/auth/profile/`, {
    data: {
      llm_provider: LIVE_MODEL.provider,
      llm_model: LIVE_MODEL.model,
      llm_effort: LIVE_MODEL.effort,
    },
  });
  expect(r.ok(), `setting the chat model should succeed (HTTP ${r.status()})`).toBeTruthy();
}

export interface ChatReply {
  user_message: { id: number; content: string };
  ai_response: {
    id: number;
    content: string;
    metadata: { tool_trace?: { tool: string }[]; tokens?: unknown };
  };
}

/** A new chat session on the Haiku model. */
export async function createChatSession(api: APIRequestContext, title: string): Promise<string> {
  const r = await api.post(`${API}/api/chat/sessions/`, {
    data: {
      title,
      llm_provider: LIVE_MODEL.provider,
      llm_model: LIVE_MODEL.model,
      llm_effort: LIVE_MODEL.effort,
    },
  });
  expect(r.status(), 'creating a chat session should succeed').toBe(201);
  return ((await r.json()) as { id: string }).id;
}

/**
 * Send one message and wait for the whole reply. Uses the non-streaming route
 * so the test reads the finished answer and its tool trace from one response.
 */
export async function sendChat(
  api: APIRequestContext,
  sessionId: string,
  content: string,
): Promise<ChatReply> {
  const r = await api.post(`${API}/api/chat/sessions/${sessionId}/message/`, {
    data: {
      content,
      llm_provider: LIVE_MODEL.provider,
      llm_model: LIVE_MODEL.model,
      llm_effort: LIVE_MODEL.effort,
    },
    timeout: 85_000,
  });
  expect(r.ok(), `sending the chat message should succeed (HTTP ${r.status()})`).toBeTruthy();
  return (await r.json()) as ChatReply;
}

/** Create an agent from the flat AgentSerializer shape. Returns its id. */
export async function createAgent(
  api: APIRequestContext,
  body: Record<string, unknown>,
): Promise<number> {
  const r = await api.post(`${API}/api/orchestrator/agents/`, {
    data: {
      provider: LIVE_MODEL.provider,
      model: LIVE_MODEL.model,
      effort: LIVE_MODEL.effort,
      ...body,
    },
  });
  expect(r.ok(), `creating the agent should succeed (HTTP ${r.status()}: ${await r.text()})`).toBeTruthy();
  return ((await r.json()) as { id: number }).id;
}

/** Start a run and return its execution id (202 from the execute route). */
export async function startRun(api: APIRequestContext, agentId: number, goal: string): Promise<string> {
  const r = await api.post(`${API}/api/orchestrator/agents/${agentId}/execute/`, {
    data: { goal },
  });
  expect(r.status(), 'starting the run should be accepted (202)').toBe(202);
  return ((await r.json()) as { execution_id: string }).execution_id;
}

export interface RunStatus {
  status: string;
  error_message: string | null;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'timeout']);

/** Poll the run until it finishes or the timeout passes. */
export async function waitForRun(
  api: APIRequestContext,
  executionId: string,
  timeoutMs: number,
): Promise<RunStatus> {
  const deadline = Date.now() + timeoutMs;
  let last: RunStatus = { status: 'unknown', error_message: null };
  while (Date.now() < deadline) {
    const r = await api.get(`${API}/api/logs/executions/${executionId}/`);
    if (r.ok()) {
      last = (await r.json()) as RunStatus;
      if (TERMINAL.has(last.status)) return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  return last;
}

/**
 * The file named `name` in the account's files, or null. Matches the exact
 * filename, not a fuzzy hit, so `total.txt` never answers for `subtotal.txt`.
 */
export async function findFile(
  api: APIRequestContext,
  name: string,
): Promise<{ id: number; name: string } | null> {
  const r = await api.get(`${API}/api/inference/documents/search/`, { params: { q: name } });
  expect(r.ok(), `searching files should succeed (HTTP ${r.status()})`).toBeTruthy();
  const body = (await r.json()) as {
    exact: { id: number; filename?: string; title?: string }[];
    fuzzy: { id: number; filename?: string; title?: string }[];
  };
  const hit = [...body.exact, ...body.fuzzy].find(
    (d) => d.filename === name || d.title === name,
  );
  return hit ? { id: hit.id, name } : null;
}

/** The text of a file in the account's files, read through its download route. */
export async function readFileText(api: APIRequestContext, id: number): Promise<string> {
  const r = await api.get(`${API}/api/inference/documents/${id}/download/`);
  expect(r.ok(), `downloading file ${id} should succeed (HTTP ${r.status()})`).toBeTruthy();
  return await r.text();
}

/**
 * Run one live test body and record its outcome, its seconds and its spend.
 * The record is written whether the body passes or throws, and the error still
 * propagates so the test is marked failed.
 */
export async function liveTest<T>(name: string, body: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const before = await spentThisRun();
  let passed = false;
  try {
    const value = await body();
    passed = true;
    return value;
  } finally {
    const after = await spentThisRun();
    const spendUsd =
      before !== null && after !== null ? Math.max(0, Number((after - before).toFixed(6))) : null;
    appendLiveResult({
      name,
      passed,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      spendUsd,
    });
  }
}
