/**
 * LaTeX source → a small document tree the preview draws.
 *
 * This is a *reader*, not a TeX engine: it understands the structure most
 * papers, notes and CVs are written in (title, sections, lists, tables,
 * figures, footnotes, references, theorem-like blocks) and hands every piece
 * of math to KaTeX untouched. Nothing is executed and nothing is fetched, so a
 * `.tex` file from anyone is safe to open. What it does not understand is
 * reported in `warnings` rather than dropped silently — a preview that quietly
 * loses a paragraph is worse than one that says what it skipped.
 *
 * Pure and DOM-free, so it is covered by `__tests__/latex.test.ts`.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'math'; v: string }
  | { t: 'style'; s: InlineStyle; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'footnote'; n: number }
  | { t: 'ref'; label: string; paren: boolean }
  | { t: 'cite'; keys: string[] }
  | { t: 'code'; v: string }
  | { t: 'image'; file: string }
  | { t: 'break' };

export type InlineStyle = 'bold' | 'italic' | 'code' | 'underline' | 'smallcaps' | 'strike' | 'sup' | 'sub';

export interface TableCell {
  c: Inline[];
  span: number;
}

export type Block =
  | { t: 'title'; title: Inline[]; author: Inline[] | null; date: Inline[] | null }
  | { t: 'heading'; level: number; number: string | null; c: Inline[]; id: string }
  | { t: 'para'; c: Inline[] }
  | { t: 'math'; v: string }
  | { t: 'list'; ordered: boolean; items: Block[][] }
  | { t: 'desc'; items: { term: Inline[]; body: Block[] }[] }
  | { t: 'box'; kind: 'quote' | 'abstract' | 'center'; c: Block[] }
  | { t: 'theorem'; label: string; c: Block[] }
  | { t: 'code'; v: string }
  | { t: 'table'; rows: TableCell[][]; header: boolean }
  | { t: 'float'; label: string; caption: Inline[] | null; files: string[]; c: Block[] }
  | { t: 'bibliography'; items: { key: string; c: Inline[] }[] }
  | { t: 'note'; v: string }
  | { t: 'toc' }
  | { t: 'rule' };

export interface OutlineItem {
  level: number;
  number: string | null;
  text: string;
  id: string;
}

export interface LatexDoc {
  blocks: Block[];
  footnotes: Inline[][];
  /** `\label` → the number it names, for `\ref`. */
  labels: Record<string, string>;
  /** `\bibitem` key → its position, for `\cite`. */
  cites: Record<string, number>;
  /** `\newcommand`s, in the shape KaTeX takes. */
  macros: Record<string, string>;
  outline: OutlineItem[];
  warnings: string[];
}

export interface LatexOptions {
  /** What `\today` prints. Passed in so the output is reproducible. */
  today?: string;
}

interface Ctx {
  footnotes: Inline[][];
  labels: Record<string, string>;
  cites: Record<string, number>;
  macros: Record<string, string>;
  outline: OutlineItem[];
  warnings: string[];
  seenWarnings: Set<string>;
  verbatim: string[];
  counters: number[];
  hasChapters: boolean;
  equation: number;
  figure: number;
  table: number;
  theorem: number;
  /** What a `\label` met right now would name. */
  current: string;
  title: string | null;
  author: string | null;
  date: string | null;
  today: string;
  depth: number;
}

// Private-use characters fence off verbatim text, so comment stripping and
// the parsers never look inside it.
const VERB_OPEN = '\uE000';
const VERB_CLOSE = '\uE001';
const MAX_WARNINGS = 12;

/** A lookup table with no inherited keys, so `\constructor` is just unknown. */
function dict<T>(entries: Record<string, T>): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, entries);
}

const SECTIONS: Record<string, number> = dict({
  chapter: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4, subparagraph: 4,
});

const MATH_ENVS = new Set([
  'equation', 'align', 'gather', 'multline', 'eqnarray', 'displaymath', 'alignat', 'flalign', 'math',
]);
const MULTILINE_MATH: Record<string, string> = dict({
  align: 'align*', gather: 'gather*', multline: 'gather*', eqnarray: 'align*', flalign: 'align*',
  alignat: 'alignat*',
});

const THEOREMS: Record<string, string> = dict({
  theorem: 'Theorem', lemma: 'Lemma', proposition: 'Proposition', corollary: 'Corollary',
  definition: 'Definition', remark: 'Remark', example: 'Example', claim: 'Claim',
  conjecture: 'Conjecture', proof: 'Proof',
});

const STYLES: Record<string, InlineStyle> = dict({
  textbf: 'bold', bf: 'bold', bfseries: 'bold', textit: 'italic', emph: 'italic', textsl: 'italic',
  it: 'italic', itshape: 'italic', em: 'italic', texttt: 'code', tt: 'code', ttfamily: 'code',
  underline: 'underline', uline: 'underline', textsc: 'smallcaps', sc: 'smallcaps', scshape: 'smallcaps',
  sout: 'strike', st: 'strike', textsuperscript: 'sup', textsubscript: 'sub',
});

/** Commands whose one argument is ordinary text in the same style. */
const PASS = new Set([
  'textrm', 'textsf', 'textnormal', 'mbox', 'text', 'textup', 'textmd', 'hbox', 'makebox', 'fbox',
  'centerline', 'uppercase', 'lowercase',
]);

/** Commands that print one fixed string. */
const SYMBOLS: Record<string, string> = dict({
  LaTeX: 'LaTeX', TeX: 'TeX', ldots: '…', dots: '…', textbackslash: '\\', S: '§', P: '¶',
  copyright: '©', pounds: '£', euro: '€', textbar: '|', textless: '<', textgreater: '>',
  textasciitilde: '~', textasciicircum: '^', textregistered: '®', texttrademark: '™',
  textendash: '–', textemdash: '—', textquoteleft: '‘', textquoteright: '’',
  textquotedblleft: '“', textquotedblright: '”', ss: 'ß', o: 'ø', O: 'Ø', ae: 'æ', AE: 'Æ',
  aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı', quad: ' ', qquad: '  ', hfill: ' ', and: ' · ',
  textbullet: '•', dag: '†', ddag: '‡', slash: '/',
});

/** Layout commands with no arguments: nothing to show. */
const DROP = new Set([
  'noindent', 'centering', 'raggedright', 'raggedleft', 'small', 'footnotesize', 'scriptsize', 'tiny',
  'large', 'Large', 'LARGE', 'huge', 'Huge', 'normalsize', 'normalfont', 'rmfamily', 'sffamily',
  'mdseries', 'upshape', 'maketitle', 'tableofcontents', 'clearpage', 'newpage', 'pagebreak',
  'bigskip', 'medskip', 'smallskip', 'vfill', 'par', 'indent', 'item', 'appendix', 'frontmatter',
  'mainmatter', 'backmatter', 'sloppy', 'protect', 'displaystyle', 'hline', 'toprule', 'midrule',
  'bottomrule', 'onecolumn', 'twocolumn', 'listoffigures', 'listoftables', 'printbibliography',
  'nonumber', 'notag', 'relax', 'null', 'strut', 'doublespacing', 'singlespacing', 'onehalfspacing',
  'makeatletter', 'makeatother', 'justifying', 'nopagebreak', 'samepage', 'flushbottom', 'raggedbottom',
]);

/** Commands whose arguments are settings, not text: how many groups to skip. */
const DROP_ARGS: Record<string, number> = dict({
  vspace: 1, hspace: 1, usepackage: 1, documentclass: 1, pagestyle: 1, thispagestyle: 1,
  bibliographystyle: 1, bibliography: 1, setlength: 2, addtolength: 2, setcounter: 2,
  addtocounter: 2, addcontentsline: 3, color: 1, input: 1, include: 1, graphicspath: 1,
  pagenumbering: 1, phantom: 1, vphantom: 1, hphantom: 1, thanks: 1, index: 1, caption: 1,
  linespread: 1, renewcommand: 2, newcommand: 2, providecommand: 2, definecolor: 3, hypersetup: 1,
  geometry: 1, title: 1, author: 1, date: 1, newtheorem: 2, theoremstyle: 1, DeclareMathOperator: 2,
  cline: 1, cmidrule: 1, rule: 2, addbibresource: 1, nocite: 1, fontsize: 2, selectfont: 0,
  captionsetup: 1, numberwithin: 2, newenvironment: 3, renewenvironment: 3, def: 1, let: 0,
});

/** Commands that take a colour (or similar) first and the text second. */
const SECOND_ARG = new Set(['textcolor', 'colorbox', 'raisebox', 'resizebox', 'scalebox', 'parbox']);

const REFS = new Set(['ref', 'eqref', 'autoref', 'cref', 'Cref', 'pageref', 'nameref', 'vref']);
const CITES = new Set([
  'cite', 'citep', 'citet', 'citeauthor', 'citeyear', 'parencite', 'textcite', 'autocite', 'footcite',
  'citealp', 'citealt',
]);

const ACCENTS: Record<string, string> = dict({
  "'": '\u0301', '`': '\u0300', '^': '\u0302', '"': '\u0308', '~': '\u0303', '=': '\u0304',
  '.': '\u0307', c: '\u0327', v: '\u030C', u: '\u0306', H: '\u030B', r: '\u030A', k: '\u0328',
});

// ---------------------------------------------------------------------------
// Scanning helpers
// ---------------------------------------------------------------------------

const CMD = /\\([a-zA-Z@]+)(\*?)/y;
const BLANK = /\n[ \t]*\n\s*/y;

function matchAt(re: RegExp, s: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(s);
}

function skipSpace(s: string, i: number): number {
  let j = i;
  while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j++;
  if (s[j] === '\n') {
    j++;
    while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j++;
  }
  return j;
}

/** The `{...}` starting at (or just after spaces from) `i`: its contents and where it ends. */
export function readGroup(s: string, i: number): [string, number] | null {
  const j = skipSpace(s, i);
  if (s[j] !== '{') return null;
  let depth = 0;
  for (let k = j; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\\') k++;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return [s.slice(j + 1, k), k + 1];
  }
  // Unbalanced: the rest is the group, so nothing after it is lost.
  return [s.slice(j + 1), s.length];
}

function readOptional(s: string, i: number): [string, number] | null {
  let j = i;
  while (s[j] === ' ' || s[j] === '\t') j++;
  if (s[j] !== '[') return null;
  let depth = 0;
  for (let k = j; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\\') k++;
    else if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === ']' && depth === 0) return [s.slice(j + 1, k), k + 1];
    else if (ch === '\n' && s[k + 1] === '\n') return null;
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Where the environment opened just before `from` closes: `[bodyEnd, afterEnd]`. */
function findEnvEnd(s: string, from: number, env: string): [number, number] {
  const re = new RegExp(`\\\\(begin|end)\\{${escapeRe(env)}\\}`, 'g');
  re.lastIndex = from;
  let depth = 1;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    depth += m[1] === 'begin' ? 1 : -1;
    if (depth === 0) return [m.index, m.index + m[0].length];
  }
  return [s.length, s.length];
}

/** Split on `sep` where it is not inside braces, math or an escape. */
function splitTop(s: string, sep: '\\\\' | '&'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let math = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') {
      if (sep === '\\\\' && s[i + 1] === '\\' && depth === 0) {
        parts.push(s.slice(start, i));
        i += 2;
        if (s[i] === '*') i++;
        const opt = readOptional(s, i);
        if (opt) i = opt[1];
        start = i;
        i--;
        continue;
      }
      i++;
    } else if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '$') math = !math;
    else if (ch === '&' && sep === '&' && depth === 0 && !math) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

function warn(ctx: Ctx, message: string) {
  if (ctx.seenWarnings.has(message)) return;
  ctx.seenWarnings.add(message);
  if (ctx.warnings.length < MAX_WARNINGS) ctx.warnings.push(message);
}

/** The first `\name{...}` in `s`: its argument and `s` without it. */
function takeCommand(s: string, name: string): [string | null, string] {
  const re = new RegExp(`\\\\${name}(?![a-zA-Z])\\*?`);
  const m = re.exec(s);
  if (!m) return [null, s];
  let at = m.index + m[0].length;
  const opt = readOptional(s, at);
  if (opt) at = opt[1];
  const g = readGroup(s, at);
  if (!g) return [null, s];
  return [g[0], s.slice(0, m.index) + s.slice(g[1])];
}

export function plainText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text': case 'code': case 'math': return n.v;
        case 'style': case 'link': return plainText(n.c);
        case 'break': return ' ';
        default: return '';
      }
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

function safeHref(raw: string): string | null {
  const href = raw.trim().replace(/\\([%#&_~])/g, '$1');
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

function findMathEnd(s: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '$') return i;
  }
  return -1;
}

function tidy(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.t === 'text' && last?.t === 'text') last.v += n.v;
    else out.push(n.t === 'text' ? { ...n } : n);
  }
  for (const n of out) if (n.t === 'text') n.v = n.v.replace(/[ \t\n]+/g, ' ');
  return out.filter((n) => n.t !== 'text' || n.v !== '');
}

function parseInline(s: string, ctx: Ctx): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ t: 'text', v: text });
    text = '';
  };
  const push = (n: Inline) => {
    flush();
    out.push(n);
  };
  const inner = (body: string) => parseInline(body, ctx);

  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === VERB_OPEN) {
      const end = s.indexOf(VERB_CLOSE, i);
      push({ t: 'code', v: ctx.verbatim[Number(s.slice(i + 1, end).replace('B', ''))] ?? '' });
      i = end + 1;
    } else if (ch === '$') {
      const end = findMathEnd(s, i + 1);
      if (end < 0) {
        text += ch;
        i++;
      } else {
        push({ t: 'math', v: s.slice(i + 1, end) });
        i = end + 1;
      }
    } else if (ch === '~') {
      text += '\u00A0';
      i++;
    } else if (ch === '-' && s[i + 1] === '-') {
      const em = s[i + 2] === '-';
      text += em ? '—' : '–';
      i += em ? 3 : 2;
    } else if (ch === '`') {
      const double = s[i + 1] === '`';
      text += double ? '“' : '‘';
      i += double ? 2 : 1;
    } else if (ch === "'" && s[i + 1] === "'") {
      text += '”';
      i += 2;
    } else if (ch === '{') {
      const [body, end] = readGroup(s, i)!;
      const decl = /^\s*\\(bfseries|bf|itshape|it|em|ttfamily|tt|scshape|sc)(?![a-zA-Z])/.exec(body);
      if (decl) push({ t: 'style', s: STYLES[decl[1]], c: inner(body.slice(decl[0].length)) });
      else {
        flush();
        out.push(...inner(body));
      }
      i = end;
    } else if (ch === '}') {
      i++;
    } else if (ch === '\\') {
      i = command(s, i, ctx, {
        push, inner,
        text: (v) => {
          text += v;
        },
        splice: (nodes) => {
          flush();
          out.push(...nodes);
        },
      });
    } else {
      text += ch;
      i++;
    }
  }
  flush();
  return tidy(out);
}

interface Sink {
  push: (n: Inline) => void;
  text: (v: string) => void;
  splice: (nodes: Inline[]) => void;
  inner: (body: string) => Inline[];
}

/** One backslash command at `i`; returns where reading continues. */
function command(s: string, i: number, ctx: Ctx, sink: Sink): number {
  const next = s[i + 1];
  if (next === undefined) return i + 1;

  if (!/[a-zA-Z@]/.test(next)) {
    if (next === '\\') {
      let j = i + 2;
      if (s[j] === '*') j++;
      const opt = readOptional(s, j);
      sink.push({ t: 'break' });
      return opt ? opt[1] : j;
    }
    if (next === '(') {
      const end = s.indexOf('\\)', i + 2);
      if (end < 0) return i + 2;
      sink.push({ t: 'math', v: s.slice(i + 2, end) });
      return end + 2;
    }
    if ('%&$#_{}'.includes(next)) {
      sink.text(next);
      return i + 2;
    }
    if (next === ',') {
      sink.text('\u2009');
      return i + 2;
    }
    if (' ;:\n'.includes(next)) {
      sink.text(' ');
      return i + 2;
    }
    if (ACCENTS[next]) return accent(s, i + 2, ACCENTS[next], sink);
    return i + 2;
  }

  const m = matchAt(CMD, s, i)!;
  const name = m[1];
  let j = i + m[0].length;
  const arg = (): string => {
    let opt = readOptional(s, j);
    while (opt) {
      j = opt[1];
      opt = readOptional(s, j);
    }
    const g = readGroup(s, j);
    if (!g) return '';
    j = g[1];
    return g[0];
  };

  if (STYLES[name]) {
    const body = arg();
    if (body) sink.push({ t: 'style', s: STYLES[name], c: sink.inner(body) });
    return j;
  }
  if (PASS.has(name)) {
    sink.splice(sink.inner(arg()));
    return j;
  }
  if (SECOND_ARG.has(name)) {
    arg();
    if (name === 'raisebox' || name === 'resizebox' || name === 'parbox') {
      // These take further optional/size arguments before the text.
      if (name === 'resizebox') arg();
    }
    sink.splice(sink.inner(arg()));
    return j;
  }
  if (name in SYMBOLS || name === 'today') {
    sink.text(name === 'today' ? ctx.today : SYMBOLS[name]);
    // TeX eats the spaces after a control word; `\LaTeX{}` keeps one.
    while (s[j] === ' ') j++;
    if (s[j] === '{' && s[j + 1] === '}') j += 2;
    return j;
  }
  if (name === 'newline' || name === 'linebreak') {
    sink.push({ t: 'break' });
    return j;
  }
  if (name === 'href') {
    const href = safeHref(arg());
    const label = sink.inner(arg());
    if (href) sink.push({ t: 'link', href, c: label });
    else sink.splice(label);
    return j;
  }
  if (name === 'url' || name === 'nolinkurl') {
    const raw = arg();
    const href = safeHref(raw) ?? safeHref(`https://${raw}`);
    const label: Inline[] = [{ t: 'text', v: raw.replace(/\\([%#&_~])/g, '$1') }];
    if (href && name === 'url') sink.push({ t: 'link', href, c: label });
    else sink.splice(label);
    return j;
  }
  if (name === 'footnote') {
    const body = arg();
    ctx.footnotes.push([]);
    const n = ctx.footnotes.length;
    ctx.footnotes[n - 1] = sink.inner(body);
    sink.push({ t: 'footnote', n });
    return j;
  }
  if (REFS.has(name)) {
    sink.push({ t: 'ref', label: arg().trim(), paren: name === 'eqref' });
    return j;
  }
  if (CITES.has(name)) {
    const keys = arg().split(',').map((k) => k.trim()).filter(Boolean);
    if (keys.length) sink.push({ t: 'cite', keys });
    return j;
  }
  if (name === 'label') {
    const key = arg().trim();
    if (key) ctx.labels[key] = ctx.current;
    return j;
  }
  if (name === 'includegraphics') {
    const file = arg().trim();
    if (file) sink.push({ t: 'image', file });
    return j;
  }
  if (name === 'verb') return j;
  if (ACCENTS[name] && name.length === 1) return accent(s, j, ACCENTS[name], sink);
  if (DROP.has(name)) {
    if (s[j] === ' ') j++;
    return j;
  }
  if (name in DROP_ARGS) {
    for (let n = 0; n < DROP_ARGS[name]; n++) arg();
    if (name === 'input' || name === 'include') warn(ctx, `\\${name} — other files are not pulled into the preview`);
    return j;
  }

  // A macro the document defined itself, used in running text.
  const own = ctx.macros[`\\${name}`];
  if (own !== undefined && !own.includes('#') && ctx.depth < 8) {
    ctx.depth++;
    sink.splice(sink.inner(own));
    ctx.depth--;
    if (s[j] === '{' && s[j + 1] === '}') j += 2;
    return j;
  }

  // Unknown: say so, and keep whatever text its arguments hold.
  warn(ctx, `\\${name} is not understood, so it is left out`);
  return j;
}

function accent(s: string, at: number, mark: string, sink: Sink): number {
  let j = at;
  while (s[j] === ' ') j++;
  let letter = '';
  if (s[j] === '{') {
    const g = readGroup(s, j)!;
    letter = g[0].replace(/\\([ij])/, (_m, c: string) => c);
    j = g[1];
  } else if (s[j] === '\\' && (s[j + 1] === 'i' || s[j + 1] === 'j')) {
    letter = s[j + 1];
    j += 2;
  } else if (s[j]) {
    letter = s[j];
    j++;
  }
  if (letter) sink.text((letter[0] + mark).normalize('NFC') + letter.slice(1));
  return j;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function mathBlock(env: string | null, starred: boolean, raw: string, ctx: Ctx): Block {
  const takeLabels = (src: string, number: string | null): string =>
    src.replace(/\\label\{([^}]*)\}/g, (_m, key: string) => {
      if (number !== null) ctx.labels[key.trim()] = number;
      return '';
    });

  if (env === null || env === 'displaymath' || env === 'math') {
    return { t: 'math', v: takeLabels(raw, null).trim() };
  }
  if (env === 'equation') {
    if (starred || /\\(nonumber|notag)(?![a-zA-Z])/.test(raw)) {
      return { t: 'math', v: takeLabels(raw, null).replace(/\\(nonumber|notag)(?![a-zA-Z])/g, '').trim() };
    }
    const n = String(++ctx.equation);
    return { t: 'math', v: `${takeLabels(raw, n).trim()} \\tag{${n}}` };
  }

  let body = raw;
  if (env === 'eqnarray') body = body.replace(/&\s*(=|<|>|\\[a-zA-Z]+)\s*&/g, '&$1 ');
  const rows = splitTop(body, '\\\\').map((row) => {
    const silent = starred || /\\(nonumber|notag)(?![a-zA-Z])/.test(row) || /\\tag\b/.test(row);
    const clean = row.replace(/\\(nonumber|notag)(?![a-zA-Z])/g, '');
    if (silent || !clean.trim()) return takeLabels(clean, null);
    const n = String(++ctx.equation);
    return `${takeLabels(clean, n)} \\tag{${n}}`;
  });
  const target = MULTILINE_MATH[env] ?? `${env}*`;
  return { t: 'math', v: `\\begin{${target}}${rows.join(' \\\\ ')}\\end{${target}}` };
}

function splitItems(body: string): string[] {
  const re = /\\(begin|end)\{[^}]*\}|\\item(?![a-zA-Z])/g;
  const items: string[] = [];
  let depth = 0;
  let start = -1;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m[1] === 'begin') depth++;
    else if (m[1] === 'end') depth--;
    else if (depth === 0) {
      if (start >= 0) items.push(body.slice(start, m.index));
      start = m.index + m[0].length;
    }
  }
  if (start >= 0) items.push(body.slice(start));
  return items;
}

function parseTable(raw: string, starred: boolean, env: string, ctx: Ctx): Block {
  let at = 0;
  const opt = readOptional(raw, at);
  if (opt) at = opt[1];
  // `tabular*` and `tabularx` take a width before the column spec.
  const groups = starred || env === 'tabularx' || env === 'tabulary' ? 2 : 1;
  for (let n = 0; n < groups; n++) {
    const g = readGroup(raw, at);
    if (g) at = g[1];
  }
  const body = raw.slice(at);
  const header = /\\midrule/.test(body) || /^(?:(?!\\\\)[\s\S])*\\\\\s*\\hline/.test(body);
  const clean = body
    .replace(/\\(hline|toprule|midrule|bottomrule|endhead|endfirsthead|endfoot|endlastfoot)(?![a-zA-Z])/g, '')
    .replace(/\\(cline|cmidrule)(\([^)]*\))?\{[^}]*\}/g, '');
  const rows = splitTop(clean, '\\\\')
    .filter((row) => row.trim())
    .map((row) =>
      splitTop(row, '&').map((cell): TableCell => {
        const multi = /^\s*\\multicolumn\s*\{(\d+)\}/.exec(cell);
        if (multi) {
          const spec = readGroup(cell, multi[0].length);
          const text = spec ? readGroup(cell, spec[1]) : null;
          return { c: parseInline(text ? text[0] : '', ctx), span: Number(multi[1]) || 1 };
        }
        return { c: parseInline(cell.trim(), ctx), span: 1 };
      }),
    );
  return { t: 'table', rows, header };
}

function pushEnv(rawName: string, body: string, ctx: Ctx, out: Block[]) {
  const starred = rawName.endsWith('*');
  const env = starred ? rawName.slice(0, -1) : rawName;

  if (MATH_ENVS.has(env)) {
    out.push(mathBlock(env, starred, body, ctx));
    return;
  }
  if (env === 'itemize' || env === 'enumerate') {
    out.push({ t: 'list', ordered: env === 'enumerate', items: splitItems(body).map((item) => {
      const opt = readOptional(item, 0);
      return parseBlocks(opt ? item.slice(opt[1]) : item, ctx);
    }) });
    return;
  }
  if (env === 'description') {
    out.push({ t: 'desc', items: splitItems(body).map((item) => {
      const opt = readOptional(item, 0);
      return {
        term: opt ? parseInline(opt[0], ctx) : [],
        body: parseBlocks(opt ? item.slice(opt[1]) : item, ctx),
      };
    }) });
    return;
  }
  if (env === 'quote' || env === 'quotation' || env === 'verse') {
    out.push({ t: 'box', kind: 'quote', c: parseBlocks(body, ctx) });
    return;
  }
  if (env === 'abstract') {
    out.push({ t: 'box', kind: 'abstract', c: parseBlocks(body, ctx) });
    return;
  }
  if (env === 'center') {
    out.push({ t: 'box', kind: 'center', c: parseBlocks(body, ctx) });
    return;
  }
  if (env === 'tabular' || env === 'tabularx' || env === 'tabulary' || env === 'longtable' || env === 'array') {
    out.push(parseTable(body, starred, env, ctx));
    return;
  }
  if (env === 'figure' || env === 'table' || env === 'wrapfigure' || env === 'subfigure') {
    const isTable = env === 'table';
    const number = String(isTable ? ++ctx.table : ++ctx.figure);
    const previous = ctx.current;
    ctx.current = number;
    const opt = readOptional(body, 0);
    let rest = opt ? body.slice(opt[1]) : body;
    const taken = takeCommand(rest, 'caption');
    const caption = taken[0];
    rest = taken[1];
    const files: string[] = [];
    rest = rest.replace(/\\includegraphics\s*(\[[^\]]*\])?\s*\{([^}]*)\}/g, (_m, _o, file: string) => {
      files.push(file.trim());
      return '';
    });
    out.push({
      t: 'float',
      label: `${isTable ? 'Table' : 'Figure'} ${number}`,
      caption: caption === null ? null : parseInline(caption, ctx),
      files,
      c: parseBlocks(rest, ctx),
    });
    ctx.current = previous;
    return;
  }
  if (env === 'thebibliography') {
    const start = readGroup(body, 0);
    const text = start ? body.slice(start[1]) : body;
    const items = text.split(/\\bibitem(?![a-zA-Z])/).slice(1).map((chunk) => {
      const opt = readOptional(chunk, 0);
      const key = readGroup(chunk, opt ? opt[1] : 0);
      return { key: key ? key[0].trim() : '', c: parseInline(key ? chunk.slice(key[1]) : chunk, ctx) };
    });
    items.forEach((item, index) => {
      if (item.key) ctx.cites[item.key] = index + 1;
    });
    out.push({ t: 'bibliography', items });
    return;
  }
  if (THEOREMS[env]) {
    const opt = readOptional(body, 0);
    let label = THEOREMS[env];
    if (env !== 'proof' && !starred) {
      const n = String(++ctx.theorem);
      ctx.current = n;
      label += ` ${n}`;
    }
    if (opt) label += ` (${plainText(parseInline(opt[0], ctx))})`;
    out.push({ t: 'theorem', label, c: parseBlocks(opt ? body.slice(opt[1]) : body, ctx) });
    return;
  }
  if (env === 'tikzpicture' || env === 'pgfpicture' || env === 'picture' || env === 'axis') {
    out.push({ t: 'note', v: 'A drawing made with code (TikZ). It is not drawn in this preview.' });
    return;
  }
  if (env === 'document' || env === 'minipage' || env === 'flushleft' || env === 'flushright'
    || env === 'small' || env === 'titlepage' || env === 'multicols' || env === 'spacing'
    || env === 'frame' || env === 'columns' || env === 'column' || env === 'block') {
    // Containers: their contents read fine without the layout.
    let rest = body;
    if (env === 'minipage' || env === 'multicols' || env === 'spacing' || env === 'column') {
      const opt = readOptional(rest, 0);
      const g = readGroup(rest, opt ? opt[1] : 0);
      if (g) rest = rest.slice(g[1]);
    }
    out.push(...parseBlocks(rest, ctx));
    return;
  }
  warn(ctx, `The "${rawName}" environment is shown as plain content`);
  out.push(...parseBlocks(body, ctx));
}

function heading(name: string, starred: boolean, title: string, ctx: Ctx): Block {
  const index = SECTIONS[name];
  let number: string | null = null;
  if (!starred && index < 4) {
    ctx.counters[index]++;
    for (let k = index + 1; k < ctx.counters.length; k++) ctx.counters[k] = 0;
    number = ctx.counters.slice(ctx.hasChapters ? 0 : 1, index + 1).join('.');
    ctx.current = number;
  }
  const c = parseInline(title, ctx);
  const id = `sec-${ctx.outline.length + 1}`;
  ctx.outline.push({ level: index + 1, number, text: plainText(c), id });
  return { t: 'heading', level: index + 1, number, c, id };
}

function parseBlocks(s: string, ctx: Ctx): Block[] {
  const out: Block[] = [];
  let buf = '';
  const flush = () => {
    const text = buf.trim();
    buf = '';
    if (!text) return;
    const c = parseInline(text, ctx);
    if (c.some((n) => n.t !== 'text' || n.v.trim())) out.push({ t: 'para', c });
  };

  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === VERB_OPEN && s[i + 1] === 'B') {
      const end = s.indexOf(VERB_CLOSE, i);
      flush();
      out.push({ t: 'code', v: ctx.verbatim[Number(s.slice(i + 2, end))] ?? '' });
      i = end + 1;
      continue;
    }
    if (ch === '\n') {
      const blank = matchAt(BLANK, s, i);
      if (blank) {
        flush();
        i += blank[0].length;
      } else {
        buf += ' ';
        i++;
      }
      continue;
    }
    if (ch === '$' && s[i + 1] === '$') {
      const end = s.indexOf('$$', i + 2);
      if (end > 0) {
        flush();
        out.push(mathBlock(null, true, s.slice(i + 2, end), ctx));
        i = end + 2;
        continue;
      }
    }
    if (ch === '\\') {
      const next = s[i + 1];
      if (next === '\\') {
        buf += '\\\\';
        i += 2;
        continue;
      }
      if (next === '[') {
        const end = s.indexOf('\\]', i + 2);
        if (end > 0) {
          flush();
          out.push(mathBlock(null, true, s.slice(i + 2, end), ctx));
          i = end + 2;
          continue;
        }
      }
      const m = matchAt(CMD, s, i);
      if (m) {
        const name = m[1];
        const after = i + m[0].length;
        if (name === 'begin') {
          const g = readGroup(s, after);
          if (g) {
            const [bodyEnd, envEnd] = findEnvEnd(s, g[1], g[0]);
            flush();
            pushEnv(g[0], s.slice(g[1], bodyEnd), ctx, out);
            i = envEnd;
            continue;
          }
        }
        if (name in SECTIONS) {
          const opt = readOptional(s, after);
          const g = readGroup(s, opt ? opt[1] : after);
          if (g) {
            flush();
            out.push(heading(name, m[2] === '*', g[0], ctx));
            i = g[1];
            continue;
          }
        }
        if (name === 'maketitle') {
          flush();
          if (ctx.title !== null || ctx.author !== null) {
            out.push({
              t: 'title',
              title: parseInline(ctx.title ?? '', ctx),
              author: ctx.author === null ? null : parseInline(ctx.author, ctx),
              date: ctx.date === null
                ? [{ t: 'text', v: ctx.today }]
                : ctx.date.trim() ? parseInline(ctx.date, ctx) : null,
            });
          }
          i = after;
          continue;
        }
        if (name === 'tableofcontents') {
          flush();
          out.push({ t: 'toc' });
          i = after;
          continue;
        }
        if (name === 'hrule' || name === 'hrulefill') {
          flush();
          out.push({ t: 'rule' });
          i = after;
          continue;
        }
        if (name === 'par' || name === 'newpage' || name === 'clearpage' || name === 'pagebreak'
          || name === 'bigskip' || name === 'medskip' || name === 'smallskip') {
          flush();
          i = after;
          continue;
        }
        if (name === 'bibliography' || name === 'printbibliography') {
          flush();
          const g = readGroup(s, after);
          warn(ctx, 'The reference list comes from a .bib file, which the preview does not build');
          i = g && name === 'bibliography' ? g[1] : after;
          continue;
        }
      }
      // Any other command belongs to the paragraph: copy its head so a
      // blank line inside one of its arguments cannot be mistaken for a
      // paragraph break before the inline parser sees it.
      buf += ch;
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function readMacros(source: string): Record<string, string> {
  const macros: Record<string, string> = dict({});
  const define = /\\(?:re|provide)?newcommand\*?\s*\{?\s*(\\[a-zA-Z]+)\s*\}?\s*(?:\[\d\])?\s*(?:\[[^\]]*\])?\s*(?=\{)/g;
  for (let m = define.exec(source); m; m = define.exec(source)) {
    const g = readGroup(source, define.lastIndex);
    if (g) macros[m[1]] = g[0];
  }
  const def = /\\def\s*(\\[a-zA-Z]+)\s*(?=\{)/g;
  for (let m = def.exec(source); m; m = def.exec(source)) {
    const g = readGroup(source, def.lastIndex);
    if (g) macros[m[1]] = g[0];
  }
  const op = /\\DeclareMathOperator\*?\s*\{\s*(\\[a-zA-Z]+)\s*\}\s*(?=\{)/g;
  for (let m = op.exec(source); m; m = op.exec(source)) {
    const g = readGroup(source, op.lastIndex);
    if (g) macros[m[1]] = `\\operatorname{${g[0]}}`;
  }
  return macros;
}

function preambleArg(preamble: string, name: string): string | null {
  const [value] = takeCommand(preamble, name);
  return value;
}

export function parseLatex(source: string, options: LatexOptions = {}): LatexDoc {
  const ctx: Ctx = {
    footnotes: [], labels: dict({}), cites: dict({}), macros: dict({}), outline: [], warnings: [],
    seenWarnings: new Set(), verbatim: [], counters: [0, 0, 0, 0], hasChapters: false,
    equation: 0, figure: 0, table: 0, theorem: 0, current: '', title: null, author: null,
    date: null, depth: 0,
    today: options.today
      ?? new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
  };

  // Verbatim text first, so nothing below reads inside it.
  let text = source.replace(/\r\n?/g, '\n').replace(/[\uE000\uE001]/g, '');
  text = text.replace(
    /\\begin\{(verbatim\*?|Verbatim|lstlisting|minted)\}(?:\[[^\]\n]*\])?(?:\{[^}\n]*\})?\n?([\s\S]*?)\\end\{\1\}/g,
    (_m, _env, body: string) => {
      ctx.verbatim.push(body.replace(/\n[ \t]*$/, ''));
      return `${VERB_OPEN}B${ctx.verbatim.length - 1}${VERB_CLOSE}`;
    },
  );
  text = text.replace(/\\verb\*?([^a-zA-Z\s])(.*?)\1/g, (_m, _d, body: string) => {
    ctx.verbatim.push(body);
    return `${VERB_OPEN}${ctx.verbatim.length - 1}${VERB_CLOSE}`;
  });
  // A comment swallows its line end, exactly as TeX does — otherwise a
  // commented-out line in the middle of a paragraph would split it in two.
  text = text.replace(/(^|[^\\])%[^\n]*(\n[ \t]*)?/gm, '$1');

  ctx.macros = readMacros(text);

  const begin = text.indexOf('\\begin{document}');
  let body = text;
  let preamble = '';
  if (begin >= 0) {
    preamble = text.slice(0, begin);
    const end = text.indexOf('\\end{document}', begin);
    body = text.slice(begin + '\\begin{document}'.length, end < 0 ? undefined : end);
  }
  const meta = begin >= 0 ? preamble : text;
  ctx.title = preambleArg(meta, 'title');
  ctx.author = preambleArg(meta, 'author');
  ctx.date = preambleArg(meta, 'date');
  ctx.hasChapters = /\\chapter\*?\s*[[{]/.test(body);

  const blocks = parseBlocks(body, ctx);
  return {
    blocks,
    footnotes: ctx.footnotes,
    labels: ctx.labels,
    cites: ctx.cites,
    macros: ctx.macros,
    outline: ctx.outline,
    warnings: ctx.warnings,
  };
}

export interface SourceHeading {
  level: number;
  title: string;
  /** 1-based line in the source, for jumping the editor there. */
  line: number;
}

/** The headings as they sit in the source, with their lines. */
export function sourceOutline(source: string): SourceHeading[] {
  const out: SourceHeading[] = [];
  const lines = source.split('\n');
  const re = /\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(?:\[[^\]]*\])?\s*\{/g;
  lines.forEach((line, index) => {
    re.lastIndex = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      const before = line.slice(0, m.index);
      if (/(^|[^\\])%/.test(before)) break;
      const g = readGroup(line, m.index + m[0].length - 1);
      out.push({
        level: SECTIONS[m[1]] + 1,
        title: (g ? g[0] : '').replace(/\\[a-zA-Z]+\*?|[{}$]/g, '').replace(/\s+/g, ' ').trim(),
        line: index + 1,
      });
    }
  });
  return out;
}

/** Whether a file name is LaTeX source this reader can render. */
export function isLatexFile(filename: string): boolean {
  return /\.(tex|latex|ltx)$/i.test(filename);
}
