/**
 * The one-line receipt under a finished reply: what the turn did, in plain
 * words. "Read 3 files · searched the web · wrote report.docx".
 *
 * Tool names are the `name` of each `@tool` declaration in `Backend/chat/tools/`.
 * A tool not listed here is still counted, as "used N other tools", so a new
 * tool never disappears from the receipt; it just is not named yet.
 */
import type { ToolTraceEntry } from '@/api/chat';

interface Kind {
  /** Groups tools that read the same way; the first tool seen fixes the order. */
  key: string;
  /** The words for `n` calls of this kind. */
  phrase: (n: number, name?: string) => string;
}

const times = (n: number) => (n === 1 ? '' : ` ${n} times`);

const READ: Kind = {
  key: 'read',
  phrase: (n) => (n === 1 ? 'read a file' : `read ${n} files`),
};
const BROWSE_FILES: Kind = {
  key: 'browse',
  phrase: (n) => `looked through files${times(n)}`,
};
const WROTE: Kind = {
  key: 'wrote',
  phrase: (n, name) => {
    if (n === 1 && name) return `wrote ${name}`;
    return n === 1 ? 'wrote a file' : `wrote ${n} files`;
  },
};
const WEB_SEARCH: Kind = {
  key: 'web-search',
  phrase: (n) => `searched the web${times(n)}`,
};
const WEB_PAGE: Kind = {
  key: 'web-page',
  phrase: (n) => (n === 1 ? 'read a web page' : `read ${n} web pages`),
};
const BROWSER: Kind = {
  key: 'browser',
  phrase: (n) => `used the browser${times(n)}`,
};
const CODE: Kind = {
  key: 'code',
  phrase: (n) => `ran code${times(n)}`,
};
const KNOWLEDGE: Kind = {
  key: 'knowledge',
  phrase: (n) => `searched your knowledge bases${times(n)}`,
};
const PLAN: Kind = {
  key: 'plan',
  phrase: (n) => `updated the plan${times(n)}`,
};
const DELEGATE: Kind = {
  key: 'delegate',
  phrase: (n) => (n === 1 ? 'handed work to an agent' : `handed work to agents ${n} times`),
};
const MESSAGE_SENT: Kind = {
  key: 'message-sent',
  phrase: (n) => (n === 1 ? 'sent a message' : `sent ${n} messages`),
};
const MESSAGE_DRAFT: Kind = {
  key: 'message-draft',
  phrase: (n) => (n === 1 ? 'drafted a message' : `drafted ${n} messages`),
};
const IMAGE: Kind = {
  key: 'image',
  phrase: (n) => (n === 1 ? 'made an image' : `made ${n} images`),
};
const CHART: Kind = {
  key: 'chart',
  phrase: (n) => (n === 1 ? 'made a chart' : `made ${n} charts`),
};

/** Tool name → the kind it is counted as. */
const KIND_OF: Record<string, Kind> = {
  read_file: READ,
  read_document: READ,
  read_attachment_text: READ,
  read_workbook: READ,
  read_tool_output: READ,
  ws_read: READ,
  list_files: BROWSE_FILES,
  find_files: BROWSE_FILES,
  ws_list: BROWSE_FILES,
  ws_search: BROWSE_FILES,
  list_documents: BROWSE_FILES,
  write_file: WROTE,
  edit_file: WROTE,
  edit_document: WROTE,
  edit_deck: WROTE,
  edit_workbook: WROTE,
  ws_write: WROTE,
  ws_edit: WROTE,
  ws_apply_patch: WROTE,
  render_document: WROTE,
  render_deck: WROTE,
  render_workbook: WROTE,
  render_pdf: WROTE,
  web_search: WEB_SEARCH,
  deep_research: WEB_SEARCH,
  read_url: WEB_PAGE,
  scrape_webpage: WEB_PAGE,
  browse_page: BROWSER,
  browser_act: BROWSER,
  execute_python: CODE,
  run_python_on_files: CODE,
  ws_run: CODE,
  workspace_exec: CODE,
  knowledge_base_search: KNOWLEDGE,
  keyword_search: KNOWLEDGE,
  update_todos: PLAN,
  run_agent: DELEGATE,
  invoke_subagent: DELEGATE,
  start_tasks: DELEGATE,
  start_mission: DELEGATE,
  message_send: MESSAGE_SENT,
  message_draft: MESSAGE_DRAFT,
  generate_image: IMAGE,
  render_chart: CHART,
};

/** Where a written file's name is kept in the call's arguments, if anywhere. */
const PATH_ARGS = ['path', 'filename', 'name'] as const;

function fileNameOf(entry: ToolTraceEntry): string | undefined {
  const args = entry.args;
  if (!args) return undefined;
  for (const key of PATH_ARGS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) {
      // Either slash, so a Windows-style path from a model still reads as a name.
      const base = value.trim().split(/[\\/]/).pop();
      if (base) return base;
    }
  }
  return undefined;
}

/**
 * The receipt line for a turn's tool calls, or `""` when there were none.
 * Kinds appear in the order the turn first used them; "other" comes last.
 */
export function summariseTrace(trace: ToolTraceEntry[]): string {
  const counts = new Map<string, { kind: Kind; n: number; name?: string }>();
  let other = 0;

  for (const entry of trace) {
    const tool = typeof entry.tool === 'string' ? entry.tool : '';
    if (!tool) continue;
    const kind = KIND_OF[tool];
    if (!kind) {
      other += 1;
      continue;
    }
    const seen = counts.get(kind.key);
    if (seen) {
      seen.n += 1;
    } else {
      counts.set(kind.key, { kind, n: 1, name: fileNameOf(entry) });
    }
  }

  const parts = [...counts.values()].map(({ kind, n, name }) => kind.phrase(n, name));
  if (other > 0) parts.push(other === 1 ? 'used 1 other tool' : `used ${other} other tools`);
  return parts.join(' · ');
}
