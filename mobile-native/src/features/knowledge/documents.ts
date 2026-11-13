/**
 * The signed-in person's own files, read for the knowledge screens: the source
 * names a search result cites, the files a knowledge base holds, and the picker
 * an extraction run takes its documents from. Reads only, through the Files API.
 */
import { listDocuments } from '../files/api';
import type { Document } from '../files/types';

/** Rows per page the server allows on the document listing. */
const PAGE = 100;

/**
 * Up to `maxPages` pages of the person's own files, oldest page first. The flag
 * says the listing was cut short, so a screen can say the list may be partial.
 */
export async function fetchPersonalDocuments(
  maxPages = 10,
): Promise<{ documents: Document[]; truncated: boolean }> {
  const documents: Document[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i += 1) {
    const page = await listDocuments({ scope: 'personal', limit: PAGE, my_cursor: cursor });
    documents.push(...page.my_documents);
    if (!page.my_has_more || !page.my_next_cursor) return { documents, truncated: false };
    cursor = page.my_next_cursor;
  }
  return { documents, truncated: true };
}

/** A file's name as a person knows it: its title, else its file name. */
export function documentName(doc: Pick<Document, 'title' | 'filename'>): string {
  return doc.title || doc.filename;
}
