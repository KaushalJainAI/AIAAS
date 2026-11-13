/**
 * Deciding how a file opens: natively for an image or a plain-text / Markdown
 * file, and in its web app for everything else.
 */
import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { defaultAppFor, openInAppPath, type AppMeta } from '../apps/catalogue';
import { extensionOfDoc, kindOf } from './display';
import { useRecordOpen } from './queries';
import { webHref } from './web';
import type { Document } from './types';

const NATIVE_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/** True for the files this app shows itself: pictures, and plain text or Markdown. */
export function canPreviewNatively(doc: Pick<Document, 'filename' | 'file_type'>): boolean {
  const kind = kindOf(doc);
  if (kind === 'markdown' || kind === 'text') return true;
  return kind === 'media' && doc.file_type === 'image' && NATIVE_IMAGE_EXTS.has(extensionOfDoc(doc));
}

/** `native`: shown here. `web`: opened in its web app. `none`: no app opens it. */
export type OpenResult = 'native' | 'web' | 'none';

/**
 * Opens a file. A picture or a text file is shown natively; anything else goes
 * to the web app that opens it (`app` picks one explicitly, for "Open with").
 * Every open is recorded, so Recent lists it.
 */
export function useOpenFile(): (doc: Document, app?: AppMeta) => OpenResult {
  const router = useRouter();
  const record = useRecordOpen();
  const { mutate } = record;

  return useCallback(
    (doc: Document, app?: AppMeta): OpenResult => {
      if (!app && canPreviewNatively(doc)) {
        mutate({ documentId: doc.id, app: 'preview' });
        router.push(`/files/file/${doc.id}`);
        return 'native';
      }
      const target = app ?? defaultAppFor(doc);
      const path = openInAppPath(doc, target);
      if (!target || !path) return 'none';
      mutate({ documentId: doc.id, app: target.id });
      router.push(webHref(path, target.title));
      return 'web';
    },
    [mutate, router],
  );
}
