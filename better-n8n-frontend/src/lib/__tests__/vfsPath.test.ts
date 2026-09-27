import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/documents', () => ({
  documentsService: { list: vi.fn() },
  foldersService: { list: vi.fn() },
}));

import { documentsService, foldersService } from '../../api/documents';
import { documentsHrefFor, linkablePath, resolvePath, segments } from '../vfsPath';

const listDocs = vi.mocked(documentsService.list);
const listFolders = vi.mocked(foldersService.list);

/** A tree: root → Chat(1) → evals(2) holding harness.py(10). */
const FOLDERS: Record<string, { id: number; name: string }[]> = {
  root: [{ id: 1, name: 'Chat' }],
  1: [{ id: 2, name: 'evals' }],
  2: [],
};
const DOCS: Record<string, { id: number; filename: string }[]> = {
  root: [],
  1: [{ id: 11, filename: 'notes.md' }],
  2: [{ id: 10, filename: 'harness.py' }],
};

describe('segments', () => {
  it('resolves . and .. the way vfs.segments does, clamped at the root', () => {
    expect(segments('/Chat/./evals/../evals/a.py')).toEqual(['Chat', 'evals', 'a.py']);
    expect(segments('/../../Chat')).toEqual(['Chat']);
    expect(segments('\\Chat\\a.md')).toEqual(['Chat', 'a.md']);
  });
});

describe('linkablePath', () => {
  it('links paths under the homes the file tools write to', () => {
    expect(linkablePath('/Chat/evals/agent_eval_harness.py')).toBe('/Chat/evals/agent_eval_harness.py');
    expect(linkablePath('/Agents/Reporter/q1.md')).toBe('/Agents/Reporter/q1.md');
    expect(linkablePath('/Chat/evals/')).toBe('/Chat/evals/');
  });

  it('strips the backticks a double-wrapped code span still carries', () => {
    expect(linkablePath('`/Chat/evals/a.py`')).toBe('/Chat/evals/a.py');
  });

  it('leaves ordinary code alone', () => {
    expect(linkablePath('/api/users/')).toBeNull();
    expect(linkablePath('/etc/hosts')).toBeNull();
    expect(linkablePath('https://x.com/Chat/a')).toBeNull();
    expect(linkablePath('/Chat')).toBeNull();
    expect(linkablePath('npm run dev')).toBeNull();
  });

  it('builds an encoded Documents URL', () => {
    expect(documentsHrefFor('/Chat/my file.md')).toBe('/documents?path=%2FChat%2Fmy%20file.md');
  });
});

describe('resolvePath', () => {
  beforeEach(() => {
    listFolders.mockReset().mockImplementation(async (parent) => ({
      folder: null, breadcrumbs: [], count: 0, truncated: false,
      folders: FOLDERS[parent ?? 'root'] as never,
    }));
    listDocs.mockReset().mockImplementation(async (params) => ({
      my_documents: DOCS[String(params?.folder_id)] as never,
      public_documents: [], my_next_cursor: null, public_next_cursor: null,
      my_has_more: false, public_has_more: false, next_cursor: null, has_more: false, limit: 100,
    }));
  });

  it('walks to the folder and finds the file', async () => {
    const r = await resolvePath('/Chat/evals/harness.py');
    expect(r).toMatchObject({ folderId: 2, found: true });
    expect(r.doc?.id).toBe(10);
  });

  it('resolves a folder path to the folder with no file', async () => {
    expect(await resolvePath('/Chat/evals')).toEqual({ folderId: 2, doc: null, found: true });
  });

  it('stops at the deepest folder it reached when a segment is missing', async () => {
    expect(await resolvePath('/Chat/gone/x.py')).toEqual({ folderId: 1, doc: null, found: false });
    expect(await resolvePath('/Chat/evals/missing.py')).toEqual({ folderId: 2, doc: null, found: false });
  });
});
