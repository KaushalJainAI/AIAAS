/** A file's type icon. A component, so callers never hold a component in a variable during render. */
import { createElement } from 'react';

import type { Document } from '../../api/documents';
import { fileIcon, fileTint } from '../../lib/fileDisplay';
import { cn } from '../../lib/utils';

export default function FileIcon({
  doc, className, tinted = true,
}: { doc: Pick<Document, 'filename' | 'file_type'>; className?: string; tinted?: boolean }) {
  return createElement(fileIcon(doc), { className: cn('shrink-0', tinted && fileTint(doc), className) });
}
