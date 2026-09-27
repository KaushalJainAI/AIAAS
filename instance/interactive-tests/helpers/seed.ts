/**
 * API seed helpers for Playwright tests — create the minimal records each
 * scenario needs via the same endpoints the frontend uses.
 *
 * Each scenario should call these in beforeAll / beforeEach to get isolated
 * data; don't rely on seed_instance.py having run.
 */
import type { APIRequestContext } from '@playwright/test';
import { env, testClientHeaders } from './testenv';

const API = env('E2E_API_URL', 'http://localhost:8000');

function authHeader(access: string): Record<string, string> {
  // Includes the test-client rate-lane header: these are the harness's own API
  // calls, not the browser's. See `testClientHeaders` for why it is applied
  // here rather than globally.
  return { Authorization: `Bearer ${access}`, ...testClientHeaders() };
}

export async function createFolder(
  request: APIRequestContext,
  access: string,
  name: string,
  parentId: number | null = null,
): Promise<{ id: number; path: string; name: string }> {
  const r = await request.post(`${API}/api/inference/folders/`, {
    headers: authHeader(access),
    data: { name, parent_id: parentId },
  });
  if (!r.ok()) throw new Error(`createFolder ${name} → ${r.status()} ${await r.text().then(s => s.slice(0, 600))}`);
  return r.json();
}

export async function uploadDocument(
  request: APIRequestContext,
  access: string,
  filename: string,
  content: string | Buffer,
  opts: { folderId?: number; kbName?: string } = {},
): Promise<{ id: string | number; status: string }> {
  const form: Record<string, string | Buffer> = {};
  // Playwright's request.post with multipart is manual — use fetch-style multipart
  // Simpler: use api/inference/documents/ with file field
  const boundary = '----InstanceBoundary' + Date.now();
  // Fallback: if Playwright's multipart helper exists, use it
  const r = await request.post(`${API}/api/inference/documents/`, {
    headers: authHeader(access),
    multipart: {
      file: { name: filename, mimeType: 'text/plain', buffer: Buffer.from(typeof content === 'string' ? content : content) },
      ...(opts.folderId ? { folder_id: String(opts.folderId) } : {}),
    },
  } as any);
  if (!r.ok()) throw new Error(`uploadDocument ${filename} → ${r.status()} ${await r.text().then(s => s.slice(0, 600))}`);
  return r.json();
}

export async function createAgent(
  request: APIRequestContext,
  access: string,
  cfg: Record<string, any>,
): Promise<{ id: number; name: string }> {
  const r = await request.post(`${API}/api/orchestrator/agents/`, {
    headers: { ...authHeader(access), 'Content-Type': 'application/json' },
    data: cfg,
  });
  if (!r.ok()) throw new Error(`createAgent ${cfg.name} → ${r.status()} ${await r.text().then(s => s.slice(0, 800))}`);
  return r.json();
}

export async function listAgents(request: APIRequestContext, access: string): Promise<any> {
  const r = await request.get(`${API}/api/orchestrator/agents/`, { headers: authHeader(access) });
  if (!r.ok()) throw new Error(`listAgents → ${r.status()} ${await r.text().then(s => s.slice(0, 400))}`);
  return r.json();
}

export async function executeAgent(
  request: APIRequestContext,
  access: string,
  agentId: number,
  goal: string,
): Promise<{ execution_id: string; status: string } & Record<string, any>> {
  const r = await request.post(`${API}/api/orchestrator/agents/${agentId}/execute/`, {
    headers: { ...authHeader(access), 'Content-Type': 'application/json' },
    data: { goal },
  });
  // 202 is success; 402 is a named refusal (spend/creds) — return it for assertion
  if (r.status() === 402) return { _refused: true, ...(await r.json()) } as any;
  if (!r.ok()) throw new Error(`executeAgent ${agentId} → ${r.status()} ${await r.text().then(s => s.slice(0, 800))}`);
  return r.json();
}

export async function getExecution(
  request: APIRequestContext,
  access: string,
  executionId: string,
): Promise<any> {
  const r = await request.get(`${API}/api/logs/executions/${executionId}/`, { headers: authHeader(access) });
  if (!r.ok()) throw new Error(`getExecution ${executionId} → ${r.status()} ${await r.text().then(s => s.slice(0, 400))}`);
  return r.json();
}

/**
 * Poll a run to a terminal status and return the final record.
 *
 * Exists because asserting on the 202 alone proves only that the run was
 * *accepted*. A run that reached the provider, got an HTTP 200 whose SSE body
 * carried `{"error": {"code": 503}}`, and closed with an empty answer looks
 * identical at the 202 -- and was reported green by every harness here until
 * the answer itself was checked.
 */
export async function waitForRun(
  request: APIRequestContext,
  access: string,
  executionId: string,
  timeoutMs = 60_000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    last = await getExecution(request, access, executionId);
    const status = String(last.status ?? last.execution?.status ?? '').toLowerCase();
    if (['completed', 'failed', 'timeout', 'cancelled', 'paused'].includes(status)) return last;
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return last;
}

export async function previewTrigger(
  request: APIRequestContext,
  access: string,
  cron: string,
  timezone = 'UTC',
): Promise<{ valid: boolean; description?: string; upcoming?: string[] }> {
  const r = await request.post(`${API}/api/orchestrator/triggers/preview/`, {
    headers: { ...authHeader(access), 'Content-Type': 'application/json' },
    data: { cron, timezone },
  });
  if (!r.ok()) throw new Error(`previewTrigger → ${r.status()} ${await r.text().then(s => s.slice(0, 400))}`);
  return r.json();
}

export async function listTools(request: APIRequestContext, access: string): Promise<any> {
  const r = await request.get(`${API}/api/tools/`, { headers: authHeader(access) });
  if (!r.ok()) throw new Error(`listTools → ${r.status()} ${await r.text().then(s => s.slice(0, 400))}`);
  return r.json();
}
