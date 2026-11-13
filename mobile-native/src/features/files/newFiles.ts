import type { NewFileOption } from '../apps/catalogue';

/** What "New" makes in the file browser. Same list and labels as `better-n8n-frontend/src/pages/Documents.tsx`. */
export const NEW_FILES: NewFileOption[] = [
  { ext: 'txt', label: 'Text document' },
  { ext: 'md', label: 'Markdown document', content: '# Untitled\n' },
  { ext: 'docx', label: 'Word document' },
  { ext: 'xlsx', label: 'Excel workbook' },
  { ext: 'csv', label: 'CSV table', content: 'Name,Value\n' },
  { ext: 'pptx', label: 'PowerPoint presentation' },
  { ext: 'html', label: 'Web page', content: '<!DOCTYPE html>\n<html>\n  <body>\n    <h1>Hello</h1>\n  </body>\n</html>\n' },
];

/** The name a new file is created under: the extension is added unless the name already has it. */
export function newFileName(name: string, ext: string): string {
  const trimmed = name.trim();
  return trimmed.toLowerCase().endsWith(`.${ext}`) ? trimmed : `${trimmed}.${ext}`;
}
