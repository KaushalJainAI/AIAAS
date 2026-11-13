/**
 * Ionicons for every file kind and app. `display.ts` and `apps/catalogue.ts`
 * name icons in lucide (the web's set); this maps each name to the Ionicons
 * glyph the app draws everywhere else.
 */
import type { IconName } from '../../components/Icon';
import { fileIconName, type Shown } from './display';

const LUCIDE_TO_IONICON: Record<string, IconName> = {
  // File kinds (display.ts)
  'scroll-text': 'document-text-outline',
  'file-image': 'image-outline',
  'file-video': 'videocam-outline',
  'file-audio': 'musical-notes-outline',
  'file-spreadsheet': 'grid-outline',
  presentation: 'easel-outline',
  'file-json': 'code-slash-outline',
  'file-code-2': 'code-slash-outline',
  'file-text': 'document-text-outline',
  'file-archive': 'archive-outline',
  file: 'document-outline',
  // App icons (apps/catalogue.ts)
  folder: 'folder-outline',
  table: 'grid-outline',
  'notebook-pen': 'create-outline',
  'check-square': 'checkbox-outline',
  'code-2': 'code-slash-outline',
  sigma: 'calculator-outline',
  globe: 'globe-outline',
  image: 'image-outline',
  'pen-tool': 'brush-outline',
  film: 'film-outline',
  'layout-dashboard': 'analytics-outline',
  'app-window': 'browsers-outline',
};

export const FOLDER_ICON: IconName = 'folder-outline';

/** The Ionicons glyph for a lucide name from the catalogue; a plain document when unknown. */
export function ionIconFor(lucide: string): IconName {
  return LUCIDE_TO_IONICON[lucide] ?? 'document-outline';
}

/** The Ionicons glyph for a file, by the web's rules. */
export function fileIcon(doc: Shown): IconName {
  return ionIconFor(fileIconName(doc));
}
