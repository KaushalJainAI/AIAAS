/**
 * Text while typing: a lazy CodeMirror 6 mount, shared by every text app.
 *
 * Only this file (and its language packages) pulls CodeMirror in, and it
 * loads lazily, so no other page downloads it. The parent owns the text
 * (load, save, dirty tracking); this owns the view: language per file
 * extension, find/replace (Ctrl/Cmd+F), bracket matching, auto-indent and the
 * app's own light/dark theme. Undo is CodeMirror's own, so there is no
 * history stack here: Ctrl+Z works because the view owns the keystroke.
 *
 * `plain` is the Notepad face of the same editor: no gutter, a reading font
 * and spellcheck, but the same find/replace and undo as the code face.
 *
 * Toolbar buttons reach the view through `apiRef` — the same commands the
 * keys run, so a button and its shortcut can never disagree.
 */
import { useEffect, useRef, type RefObject } from 'react';
import { Compartment, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view';
import { basicSetup, minimalSetup } from 'codemirror';
import { StreamLanguage, indentUnit } from '@codemirror/language';
import { indentWithTab, redo, selectAll, toggleComment, undo } from '@codemirror/commands';
import { gotoLine, highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { xml } from '@codemirror/lang-xml';
import { stex } from '@codemirror/legacy-modes/mode/stex';

/** CodeMirror language support by highlight.js grammar name (`lib/codeLanguage`). */
function languageFor(grammar: string | null): Extension[] {
  switch (grammar) {
    case 'javascript':
    case 'typescript':
      return [javascript({ typescript: grammar === 'typescript' })];
    case 'python':
      return [python()];
    case 'html':
    case 'xml':
      return grammar === 'html' ? [html()] : [xml()];
    case 'css':
      return [css()];
    case 'json':
      return [json()];
    case 'markdown':
      return [markdown()];
    case 'sql':
      return [sql()];
    case 'yaml':
      return [yaml()];
    case 'latex':
      // The mode is typed against `@codemirror/streamparser`'s copy of the
      // same interface, which differs from `language`'s only by declaration.
      return [StreamLanguage.define(stex as unknown as Parameters<typeof StreamLanguage.define>[0])];
    default:
      return [];
  }
}

/** What a toolbar can ask the editor to do. */
export interface CodeMirrorApi {
  undo: () => void;
  redo: () => void;
  find: () => void;
  gotoLine: () => void;
  /** Move the caret to a 1-based line and bring it into view. */
  jumpToLine: (line: number) => void;
  toggleComment: () => void;
  selectAll: () => void;
  /** Wrap the selection, or insert `fallback` wrapped and select it. */
  wrapSelection: (before: string, after: string, fallback?: string) => void;
  /** Insert a block on its own lines at the caret. */
  insertBlock: (text: string) => void;
  /** Insert text at the caret, replacing any selection. */
  insertText: (text: string) => void;
  /** Start every selected line with `prefix(i)`, replacing what `strip` matches. */
  prefixLines: (prefix: (index: number) => string, strip?: RegExp) => void;
  /** Rewrite the selection, or the whole text when nothing is selected. */
  transform: (change: (text: string) => string) => void;
  focus: () => void;
}

interface Props {
  value: string;
  language: string | null;
  dark: boolean;
  wrap: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  /** Editor text size in px. */
  fontSize?: number;
  /** Notepad face: no gutter, spellcheck on. */
  plain?: boolean;
  /** Proportional font instead of monospace. */
  sans?: boolean;
  placeholder?: string;
  apiRef?: RefObject<CodeMirrorApi | null>;
}

function look(fontSize: number, sans: boolean): Extension {
  return EditorView.theme({
    '&': { fontSize: `${fontSize}px` },
    '.cm-scroller': {
      fontFamily: sans ? 'inherit' : 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      lineHeight: sans ? '1.65' : '1.5',
    },
  });
}

export default function CodeMirrorView({
  value, language, dark, wrap, onChange, onSave, fontSize = 13, plain = false, sans = false,
  placeholder, apiRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
  });

  const languageCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());
  const wrapCompartment = useRef(new Compartment());
  const lookCompartment = useRef(new Compartment());

  // One view per mount; the parent remounts on file change.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const view = new EditorView({
      doc: value,
      extensions: [
        plain
          ? [
              minimalSetup,
              search(),
              highlightSelectionMatches(),
              keymap.of(searchKeymap),
              EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' }),
              EditorView.theme({ '.cm-content': { padding: '16px' } }),
            ]
          : basicSetup,
        indentUnit.of('  '),
        keymap.of([
          indentWithTab,
          { key: 'Ctrl-s', mac: 'Cmd-s', run: () => (onSaveRef.current(), true), preventDefault: true },
        ]),
        placeholder ? placeholderExt(placeholder) : [],
        languageCompartment.current.of(languageFor(language)),
        themeCompartment.current.of(dark ? oneDark : []),
        wrapCompartment.current.of(wrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
        EditorView.theme({
          '&': { flex: '1 1 auto', minHeight: 0 },
          '.cm-scroller': { overflow: 'auto' },
        }),
        lookCompartment.current.of(look(fontSize, sans)),
      ],
      parent: container,
    });
    viewRef.current = view;

    if (apiRef) {
      const run = (command: (target: EditorView) => boolean) => () => {
        view.focus();
        command(view);
      };
      apiRef.current = {
        undo: run(undo),
        redo: run(redo),
        find: run(openSearchPanel),
        gotoLine: run(gotoLine),
        toggleComment: run(toggleComment),
        selectAll: run(selectAll),
        focus: () => view.focus(),
        jumpToLine: (line) => {
          const target = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines));
          view.dispatch({
            selection: { anchor: target.from },
            effects: EditorView.scrollIntoView(target.from, { y: 'start', yMargin: 24 }),
          });
          view.focus();
        },
        wrapSelection: (before, after, fallback = '') => {
          const { from, to } = view.state.selection.main;
          const body = view.state.sliceDoc(from, to) || fallback;
          view.dispatch({
            changes: { from, to, insert: before + body + after },
            selection: { anchor: from + before.length, head: from + before.length + body.length },
            scrollIntoView: true,
          });
          view.focus();
        },
        insertBlock: (text) => {
          const { from, to } = view.state.selection.main;
          const line = view.state.doc.lineAt(from);
          const lead = from === line.from ? '' : '\n';
          const insert = `${lead}${text}\n`;
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length },
            scrollIntoView: true,
          });
          view.focus();
        },
        insertText: (text) => {
          const { from, to } = view.state.selection.main;
          view.dispatch({
            changes: { from, to, insert: text },
            selection: { anchor: from + text.length },
            scrollIntoView: true,
          });
          view.focus();
        },
        prefixLines: (prefix, strip) => {
          const { from, to } = view.state.selection.main;
          const first = view.state.doc.lineAt(from);
          const last = view.state.doc.lineAt(to);
          const lines = view.state.sliceDoc(first.from, last.to).split('\n');
          const insert = lines
            .map((line, index) => prefix(index) + (strip ? line.replace(strip, '') : line))
            .join('\n');
          view.dispatch({
            changes: { from: first.from, to: last.to, insert },
            selection: { anchor: first.from, head: first.from + insert.length },
            scrollIntoView: true,
          });
          view.focus();
        },
        transform: (change) => {
          const { from, to } = view.state.selection.main;
          const whole = from === to;
          const start = whole ? 0 : from;
          const end = whole ? view.state.doc.length : to;
          const insert = change(view.state.sliceDoc(start, end));
          view.dispatch({
            changes: { from: start, to: end, insert },
            selection: whole ? { anchor: Math.min(from, insert.length) } : { anchor: start, head: start + insert.length },
          });
          view.focus();
        },
      };
    }
    return () => {
      view.destroy();
      viewRef.current = null;
      if (apiRef) apiRef.current = null;
    };
    // Mount once; value/language/theme/wrap/size travel through effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Parent-driven updates (reload, Format JSON): adopt what differs.
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: languageCompartment.current.reconfigure(languageFor(language)) });
  }, [language]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeCompartment.current.reconfigure(dark ? oneDark : []) });
  }, [dark]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapCompartment.current.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  }, [wrap]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: lookCompartment.current.reconfigure(look(fontSize, sans)) });
  }, [fontSize, sans]);

  return <div ref={containerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Text editor" />;
}
