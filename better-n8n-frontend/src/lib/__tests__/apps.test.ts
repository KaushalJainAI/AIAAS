import { describe, expect, it } from 'vitest';

import { APPS, acceptsDoc, appsForDoc, defaultAppFor, getApp, openInAppPath, searchApps } from '../apps';

const doc = (filename: string, file_type: string) => ({ id: 7, filename, file_type });

describe('apps registry', () => {
  it('every app opens a real route, not a desktop window', () => {
    for (const app of APPS) {
      expect(app.path.startsWith('/')).toBe(true);
      if (app.kind === 'workspace') {
        expect(app.path).toBe(`/apps/${app.id}`);
        expect(app.editor).toBeTruthy();
        expect(app.accepts?.types.length).toBeGreaterThan(0);
      }
    }
  });

  it('ids are unique', () => {
    const ids = APPS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a new file is one the app itself would list', () => {
    for (const app of APPS) {
      for (const opt of app.newFiles ?? []) {
        const type = { md: 'md', txt: 'txt', csv: 'csv', html: 'html', json: 'json', docx: 'docx', xlsx: 'xlsx', pptx: 'pptx' }[opt.ext] ?? 'txt';
        expect(acceptsDoc(app, doc(`new.${opt.ext}`, type))).toBe(true);
      }
    }
  });

  it('search finds sheets by keyword', () => {
    expect(searchApps('excel')[0]?.id).toBe('sheets');
    expect(searchApps('deck')[0]?.id).toBe('slides');
    expect(searchApps('zzz-no-match')).toEqual([]);
  });
});

describe('opening a file', () => {
  it('picks the app that renders the file best', () => {
    expect(defaultAppFor(doc('q1.xlsx', 'xlsx'))?.id).toBe('sheets');
    expect(defaultAppFor(doc('notes.md', 'md'))?.id).toBe('docs');
    expect(defaultAppFor(doc('run.py', 'txt'))?.id).toBe('code');
    expect(defaultAppFor(doc('log.txt', 'txt'))?.id).toBe('notepad');
    expect(defaultAppFor(doc('a.png', 'image'))?.id).toBe('photos');
  });

  it('a .py stored as txt is code, not a note', () => {
    expect(acceptsDoc(getApp('notepad')!, doc('run.py', 'txt'))).toBe(false);
  });

  it('offers every capable app under Open with', () => {
    expect(appsForDoc(doc('notes.md', 'md')).map((a) => a.id)).toEqual(['docs', 'notepad', 'tasks']);
  });

  it('a file nothing opens has no app path', () => {
    expect(openInAppPath(doc('blob.bin', 'other'))).toBeNull();
    expect(openInAppPath(doc('deck.pptx', 'pptx'))).toBe('/apps/slides?file=7');
  });
});
