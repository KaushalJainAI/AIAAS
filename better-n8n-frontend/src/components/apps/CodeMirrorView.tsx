/**
 * Code while typing, in colour: a lazy CodeMirror 6 mount.
 *
 * Only this file (and its language packages) pulls CodeMirror in, and it
 * loads lazily inside the Code Editor, so no other page downloads it. The
 * parent owns the text (load, save, dirty tracking); this owns the view:
 * language per file extension, find/replace (Ctrl/Cmd+F), bracket matching,
 * auto-indent and the app's own light/dark theme. Undo is CodeMirror's own,
 * so there is no history stack here: Ctrl+Z works because the view owns the
 * keystroke.
 */
import { useEffect, useRef } from 'react';
import { Compartment } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { indentUnit } from '@codemirror/language';
import { indentWithTab } from '@codemirror/commands';
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
import type { Extension } from '@codemirror/state';

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
    default:
      return [];
  }
}

interface Props {
  value: string;
  language: string | null;
  dark: boolean;
  wrap: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}

export default function CodeMirrorView({ value, language, dark, wrap, onChange, onSave }: Props) {
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

  // One view per mount; the parent remounts on file change.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const view = new EditorView({
      doc: value,
      extensions: [
        basicSetup,
        indentUnit.of('  '),
        keymap.of([
          indentWithTab,
          { key: 'Ctrl-s', mac: 'Cmd-s', run: () => (onSaveRef.current(), true), preventDefault: true },
        ]),
        languageCompartment.current.of(languageFor(language)),
        themeCompartment.current.of(dark ? oneDark : []),
        wrapCompartment.current.of(wrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
        EditorView.theme({
          '&': { flex: '1 1 auto', minHeight: 0, fontSize: '13px' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, monospace' },
        }),
      ],
      parent: container,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once; value/language/theme/wrap travel through effects below.
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

  return <div ref={containerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Code editor" />;
}
