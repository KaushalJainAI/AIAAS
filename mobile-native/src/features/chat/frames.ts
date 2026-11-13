/**
 * Readers for stream frames and saved-message metadata. The wire has no schema,
 * so every field is checked here before a screen touches it. Each reader
 * returns a typed value or an empty one; a malformed item is dropped, never
 * rendered as "undefined".
 */
import type { SseEvent } from '../../api/sse';
import type {
  BlockedAttachment,
  ChartKind,
  ChartPoint,
  ChartSeries,
  ChartSpec,
  ChatImage,
  ChatSource,
  CommandCardData,
  FileCard,
  HtmlArtifact,
  PendingApproval,
  PendingQuestion,
  QuestionKind,
  SolutionUsed,
  TodoItem,
  TodoStatus,
  ToolCallField,
  WorkerPlan,
} from './types';

export const str = (value: unknown): string => (typeof value === 'string' ? value : '');
export const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const TODO_STATUSES: string[] = ['open', 'doing', 'done', 'blocked'];
const QUESTION_KINDS: string[] = ['choice', 'multi_choice', 'number', 'text'];
const CHART_KINDS: string[] = ['bar', 'column', 'line', 'area', 'scatter', 'pie'];

export function parseTodos(raw: unknown): TodoItem[] {
  return arr(raw).flatMap((item) => {
    const t = obj(item);
    const text = str(t.text).trim();
    if (!text) return [];
    const status = (TODO_STATUSES.includes(str(t.status)) ? str(t.status) : 'open') as TodoStatus;
    return [{ text, status, note: str(t.note) || undefined, owner: str(t.owner) || undefined }];
  });
}

export function parseApproval(event: SseEvent): PendingApproval | null {
  const callId = str(event.call_id);
  if (!callId) return null; // nothing to answer without the call id
  const tool = str(event.tool);
  const detail = obj(event.detail);
  const fields: ToolCallField[] = arr(detail.fields).flatMap((f) => {
    const field = obj(f);
    const label = str(field.label);
    return label ? [{ label, value: str(field.value) }] : [];
  });
  const effect = str(detail.effect);
  return {
    callId,
    tool,
    title: str(detail.title) || tool || 'Action',
    sentence: str(detail.sentence) || `Allow ${tool || 'this action'}?`,
    fields,
    actionLabel: str(detail.action_label) || 'Approve',
    effect: effect === 'read' || effect === 'reversible' || effect === 'irreversible' ? effect : undefined,
    leavesWorkspace: detail.leaves_workspace === true,
    firstContact: detail.first_contact === true,
  };
}

export function parseQuestion(event: SseEvent): PendingQuestion | null {
  const question = str(event.question).trim();
  const callId = str(event.call_id);
  if (!question || !callId) return null;
  const kind = (QUESTION_KINDS.includes(str(event.kind)) ? str(event.kind) : 'text') as QuestionKind;
  const options = arr(event.options).flatMap((o) => (typeof o === 'string' && o.trim() ? [o] : []));
  // A choice with fewer than two options cannot be drawn as a choice.
  if ((kind === 'choice' || kind === 'multi_choice') && options.length < 2) return null;
  return {
    callId,
    question,
    assumption: str(event.assumption) || undefined,
    kind,
    options,
    allowOther: event.allow_other === true,
    min: num(event.min),
    max: num(event.max),
    unit: str(event.unit),
  };
}

/** Sources the answer cites. Whole list per frame. */
export function parseSources(raw: unknown): ChatSource[] {
  return arr(raw).flatMap((item) => {
    const s = obj(item);
    const url = str(s.url);
    if (!/^https?:\/\//i.test(url)) return [];
    return [{
      url,
      title: str(s.title) || undefined,
      snippet: str(s.snippet) || undefined,
      thumbnail: str(s.thumbnail) || undefined,
      publisher: str(s.publisher) || str(s.source) || undefined,
    }];
  });
}

/** Images the turn produced or found. Only http(s) and data: sources can be drawn. */
export function parseImages(raw: unknown): ChatImage[] {
  return arr(raw).flatMap((item) => {
    const i = obj(item);
    const url = str(i.url) || str(i.image) || str(i.thumbnail);
    if (!/^(https?:\/\/|data:image\/)/i.test(url)) return [];
    return [{ url, title: str(i.title) || undefined }];
  });
}

export function parseFiles(raw: unknown): FileCard[] {
  return arr(raw).flatMap((item) => {
    const f = obj(item);
    const id = num(f.document_id);
    if (id === null) return [];
    const action = str(f.action);
    return [{
      document_id: id,
      path: str(f.path),
      name: str(f.name) || str(f.path) || 'File',
      action: (['created', 'updated', 'appended', 'edited'].includes(action) ? action : 'updated') as FileCard['action'],
      type: str(f.type) || undefined,
      bytes: num(f.bytes),
    }];
  });
}

/** Parses one chart spec. Gaps stay null: a missing measurement is not a zero. */
export function parseChart(raw: unknown): ChartSpec | null {
  const c = obj(raw);
  const kind = str(c.kind);
  if (!CHART_KINDS.includes(kind)) return null;
  const series: ChartSeries[] = arr(c.series).flatMap((item) => {
    const s = obj(item);
    const name = str(s.name);
    const points: ChartPoint[] = arr(s.points).flatMap((p) => {
      const pt = obj(p);
      const x = str(pt.x) || (typeof pt.x === 'number' ? String(pt.x) : '');
      if (!x) return [];
      return [{ x, y: num(pt.y) }];
    });
    return name ? [{ name, points }] : [];
  });
  if (series.length === 0) return null;
  return {
    kind: kind as ChartKind,
    title: str(c.title) || 'Chart',
    series,
    x_label: str(c.x_label) || undefined,
    y_label: str(c.y_label) || undefined,
    stacked: c.stacked === true,
    note: str(c.note) || undefined,
  };
}

export function parseCharts(raw: unknown): ChartSpec[] {
  return arr(raw).flatMap((item) => {
    const chart = parseChart(item);
    return chart ? [chart] : [];
  });
}

export function parseArtifacts(raw: unknown): HtmlArtifact[] {
  return arr(raw).flatMap((item) => {
    const a = obj(item);
    const html = str(a.html);
    return html ? [{ title: str(a.title) || 'Preview', html }] : [];
  });
}

export function parseSolutions(raw: unknown): SolutionUsed[] {
  return arr(raw).flatMap((item) => {
    const s = obj(item);
    const id = num(s.id);
    if (id === null) return [];
    return [{
      id,
      problem: str(s.problem) || 'Team solution',
      solved_by: str(s.solved_by),
      last_known_true: str(s.last_known_true) || null,
      checks_needed: num(s.checks_needed) ?? 0,
      doubtful: s.doubtful === true,
    }];
  });
}

export function parseBlocked(raw: unknown): BlockedAttachment[] {
  return arr(raw).flatMap((item) => {
    const b = obj(item);
    return [{ id: num(b.id) ?? undefined, name: str(b.name) || undefined, reason: str(b.reason) || undefined }];
  });
}

/** Worker plans keyed by execution id, from a saved message's metadata. */
export function workerPlansFrom(raw: unknown): WorkerPlan[] {
  return Object.entries(obj(raw)).flatMap(([execution_id, value]) => {
    const w = obj(value);
    const todos = parseTodos(w.todos);
    if (todos.length === 0) return [];
    return [{ execution_id, agent_name: str(w.agent_name) || 'Agent', todos }];
  });
}

export function parseCommandCard(raw: unknown): CommandCardData | null {
  const card = obj(raw);
  const type = str(card.type);
  return type ? { ...card, type } : null;
}
