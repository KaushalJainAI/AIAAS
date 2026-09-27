/**
 * Which highlighter grammar a piece of code is in.
 *
 * Kept apart from `highlight.ts` so the decision can be tested and imported
 * without pulling the highlighter itself into a bundle: the grammars are the
 * heavy part and load only when code is actually on screen.
 *
 * The keys are what arrives in practice — a fence tag the model wrote (`py`,
 * `shell`, `ts`) or a file extension — and the values are the grammar names
 * registered in `highlight.ts`. An unknown answer is `null`, which renders as
 * plain text rather than as a guess: auto-detection colours prose as if it were
 * code, which looks more broken than no colour at all.
 */

const ALIASES: Record<string, string> = {
  py: 'python', python: 'python', ipynb: 'python',
  js: 'javascript', javascript: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', typescript: 'typescript', tsx: 'typescript',
  json: 'json', jsonl: 'json',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  css: 'css', scss: 'css',
  sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  sql: 'sql',
  yml: 'yaml', yaml: 'yaml',
  md: 'markdown', markdown: 'markdown',
  go: 'go',
  rs: 'rust', rust: 'rust',
  java: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', hpp: 'cpp', 'c++': 'cpp',
  cs: 'csharp', csharp: 'csharp',
  rb: 'ruby', ruby: 'ruby',
  php: 'php',
  kt: 'kotlin', kotlin: 'kotlin',
  swift: 'swift',
  r: 'r',
  toml: 'ini', ini: 'ini', cfg: 'ini', env: 'ini',
  dockerfile: 'dockerfile', docker: 'dockerfile',
  diff: 'diff', patch: 'diff',
};

/** Grammar for a fence tag or a bare extension; null when there is none. */
export function languageFor(tag: string | null | undefined): string | null {
  if (!tag) return null;
  return ALIASES[tag.trim().toLowerCase()] ?? null;
}

/** Grammar for a filename, by extension (or the whole name, for `Dockerfile`). */
export function languageForFile(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower === 'dockerfile' || lower.endsWith('.dockerfile')) return 'dockerfile';
  const dot = lower.lastIndexOf('.');
  return dot < 0 ? null : languageFor(lower.slice(dot + 1));
}
