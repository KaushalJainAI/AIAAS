import katex from 'katex';
import { describe, expect, it } from 'vitest';

import { isLatexFile, parseLatex, plainText, sourceOutline, type Block, type Inline } from '../latex';

const TODAY = 'October 10, 2026';
const parse = (src: string) => parseLatex(src, { today: TODAY });

function paras(blocks: Block[]): string[] {
  return blocks.filter((b) => b.t === 'para').map((b) => plainText((b as { c: Inline[] }).c));
}

describe('parseLatex — structure', () => {
  it('reads the title block, numbered sections and paragraphs', () => {
    const doc = parse(String.raw`
\documentclass{article}
\title{A Small Paper}
\author{Ada \and Grace}
\begin{document}
\maketitle
\section{Intro}
First paragraph
continues here.

Second paragraph.
\subsection{Detail}
\section*{Thanks}
\end{document}`);
    expect(doc.blocks[0]).toMatchObject({ t: 'title' });
    const title = doc.blocks[0] as Extract<Block, { t: 'title' }>;
    expect(plainText(title.title)).toBe('A Small Paper');
    expect(plainText(title.author!)).toBe('Ada · Grace');
    expect(plainText(title.date!)).toBe(TODAY);
    expect(doc.outline.map((o) => [o.number, o.text])).toEqual([
      ['1', 'Intro'], ['1.1', 'Detail'], [null, 'Thanks'],
    ]);
    expect(paras(doc.blocks)).toEqual(['First paragraph continues here.', 'Second paragraph.']);
  });

  it('renders a file with no document environment as its body', () => {
    const doc = parse('Just \\textbf{bold} text.');
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]).toMatchObject({
      t: 'para',
      c: [{ t: 'text', v: 'Just ' }, { t: 'style', s: 'bold' }, { t: 'text', v: ' text.' }],
    });
  });

  it('numbers sections under chapters', () => {
    const doc = parse('\\chapter{One}\\section{A}\\chapter{Two}\\section{B}');
    expect(doc.outline.map((o) => o.number)).toEqual(['1', '1.1', '2', '2.1']);
  });

  it('a comment does not split the paragraph it sits in', () => {
    const doc = parse('one\n% a note\ntwo, 50\\% done');
    expect(paras(doc.blocks)).toEqual(['one two, 50% done']);
  });

  it('keeps verbatim text exactly, comment signs and all', () => {
    const doc = parse('\\begin{verbatim}\nx = 1 % not a comment\n\\textbf{raw}\n\\end{verbatim}');
    expect(doc.blocks).toEqual([{ t: 'code', v: 'x = 1 % not a comment\n\\textbf{raw}' }]);
  });

  it('reads nested lists and description terms', () => {
    const doc = parse(String.raw`
\begin{enumerate}
\item one
\item two
  \begin{itemize}
  \item inner
  \end{itemize}
\end{enumerate}
\begin{description}
\item[Term] meaning
\end{description}`);
    const list = doc.blocks[0] as Extract<Block, { t: 'list' }>;
    expect(list.ordered).toBe(true);
    expect(list.items).toHaveLength(2);
    expect(list.items[1][1]).toMatchObject({ t: 'list', ordered: false });
    const desc = doc.blocks[1] as Extract<Block, { t: 'desc' }>;
    expect(plainText(desc.items[0].term)).toBe('Term');
  });

  it('reads a table with a header rule and a spanning cell', () => {
    const doc = parse(String.raw`
\begin{tabular}{lr}
\toprule
Name & Value \\
\midrule
A \& B & $x_1$ \\
\multicolumn{2}{c}{Total} \\
\bottomrule
\end{tabular}`);
    const table = doc.blocks[0] as Extract<Block, { t: 'table' }>;
    expect(table.header).toBe(true);
    expect(table.rows).toHaveLength(3);
    expect(plainText(table.rows[1][0].c)).toBe('A & B');
    expect(table.rows[1][1].c[0]).toEqual({ t: 'math', v: 'x_1' });
    expect(table.rows[2][0].span).toBe(2);
  });

  it('numbers figures and resolves references to them', () => {
    const doc = parse(String.raw`
See Figure~\ref{fig:a} and \eqref{eq:x}.
\begin{figure}[h]
\centering
\includegraphics[width=3cm]{plot.png}
\caption{A plot}\label{fig:a}
\end{figure}
\begin{equation}
E = mc^2 \label{eq:x}
\end{equation}`);
    expect(doc.labels['fig:a']).toBe('1');
    expect(doc.labels['eq:x']).toBe('1');
    const float = doc.blocks.find((b) => b.t === 'float') as Extract<Block, { t: 'float' }>;
    expect(float.label).toBe('Figure 1');
    expect(float.files).toEqual(['plot.png']);
    expect(plainText(float.caption!)).toBe('A plot');
  });

  it('collects footnotes and numbers citations from the bibliography', () => {
    const doc = parse(String.raw`
Text\footnote{A note.} cites \cite{knuth,missing}.
\begin{thebibliography}{9}
\bibitem{lamport} Lamport.
\bibitem{knuth} Knuth.
\end{thebibliography}`);
    expect(doc.footnotes.map(plainText)).toEqual(['A note.']);
    expect(doc.cites).toMatchObject({ lamport: 1, knuth: 2 });
    expect(doc.cites.missing).toBeUndefined();
  });
});

describe('parseLatex — inline text', () => {
  it('handles typography, accents and escapes', () => {
    const doc = parse("``Quoted'' --- caf\\'e, na\\\"{\\i}ve, 5\\$ \\& \\#1, A~B, \\LaTeX{} rocks");
    expect(paras(doc.blocks)[0]).toBe('“Quoted” — café, naïve, 5$ & #1, A\u00a0B, LaTeX rocks'.replace(/\u00a0/g, ' '));
  });

  it('only links to web and mail addresses', () => {
    const doc = parse('\\href{https://a.example/x}{ok} \\href{javascript:alert(1)}{bad} \\url{b.example}');
    const para = doc.blocks[0] as Extract<Block, { t: 'para' }>;
    const links = para.c.filter((n) => n.t === 'link') as Extract<Inline, { t: 'link' }>[];
    expect(links.map((l) => l.href)).toEqual(['https://a.example/x', 'https://b.example']);
    expect(plainText(para.c)).toContain('bad');
  });

  it('expands the document\'s own zero-argument macros in text', () => {
    const doc = parse('\\newcommand{\\prod}{AIAAS}\\begin{document}Use \\prod{} daily.\\end{document}');
    expect(paras(doc.blocks)).toEqual(['Use AIAAS daily.']);
    expect(doc.macros['\\prod']).toBe('AIAAS');
  });

  it('says what it left out instead of dropping it silently', () => {
    const doc = parse('Before \\mysteryCommand{kept text} after. \\begin{oddenv}inside\\end{oddenv}');
    expect(plainText((doc.blocks[0] as Extract<Block, { t: 'para' }>).c)).toBe('Before kept text after.');
    expect(doc.warnings.join(' ')).toContain('\\mysteryCommand');
    expect(doc.warnings.join(' ')).toContain('oddenv');
    expect(paras(doc.blocks)).toContain('inside');
  });

  it('is not confused by names an object inherits', () => {
    const doc = parse('\\constructor{x} \\toString \\begin{constructor}y\\end{constructor} \\ref{constructor}');
    expect(doc.warnings.length).toBeGreaterThan(0);
    expect(doc.labels.constructor).toBeUndefined();
  });
});

describe('parseLatex — math', () => {
  const render = (v: string, macros = {}) =>
    katex.renderToString(v, { displayMode: true, throwOnError: true, macros: { ...macros } });

  it('numbers each row of an align and KaTeX accepts the result', () => {
    const doc = parse(String.raw`
\begin{align}
a &= b + c \label{eq:one} \\
d &= e \nonumber \\
f &= g
\end{align}`);
    const math = doc.blocks[0] as Extract<Block, { t: 'math' }>;
    expect(math.v).toContain('\\begin{align*}');
    expect(math.v).toContain('\\tag{1}');
    expect(math.v).toContain('\\tag{2}');
    expect(math.v).not.toContain('\\tag{3}');
    expect(math.v).not.toContain('\\label');
    expect(doc.labels['eq:one']).toBe('1');
    expect(() => render(math.v)).not.toThrow();
  });

  it('leaves starred and bracket display math unnumbered', () => {
    const doc = parse('\\[ x^2 \\] $$y$$ \\begin{equation*}z\\end{equation*}');
    expect(doc.blocks.map((b) => (b as { v: string }).v)).toEqual(['x^2', 'y', 'z']);
  });

  it('hands user macros to KaTeX', () => {
    const doc = parse('\\newcommand{\\vect}[1]{\\mathbf{#1}}\\DeclareMathOperator{\\argmax}{arg\\,max} $$\\vect{x} \\argmax$$');
    expect(doc.macros['\\vect']).toBe('\\mathbf{#1}');
    const math = doc.blocks.find((b) => b.t === 'math') as Extract<Block, { t: 'math' }>;
    expect(() => render(math.v, doc.macros)).not.toThrow();
  });
});

describe('sourceOutline', () => {
  it('finds headings with their lines and skips commented ones', () => {
    const src = '\\section{One}\ntext\n% \\section{Hidden}\n\\subsection*{Two \\emph{b}}';
    expect(sourceOutline(src)).toEqual([
      { level: 2, title: 'One', line: 1 },
      { level: 3, title: 'Two b', line: 4 },
    ]);
  });
});

describe('isLatexFile', () => {
  it('matches source files only', () => {
    expect(isLatexFile('paper.TEX')).toBe(true);
    expect(isLatexFile('refs.bib')).toBe(false);
    expect(isLatexFile('context.txt')).toBe(false);
  });
});
