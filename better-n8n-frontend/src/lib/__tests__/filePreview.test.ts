import { describe as group, expect, it } from 'vitest';
import { extensionOfDoc, kindOf, legacySentence } from '../filePreview';

/**
 * One filename per row of the Phase F table to the kind it must preview as,
 * so a new format cannot fall back to "icon and download" by accident.
 */
const TABLE: [string, string, ReturnType<typeof kindOf>][] = [
  ['r.pdf', 'pdf', 'pdf'],
  ['old.doc', 'doc_legacy', 'legacy_office'],
  ['old.doc', 'docx', 'legacy_office'],
  ['old.xls', 'xls_legacy', 'legacy_office'],
  ['old.ppt', 'ppt_legacy', 'legacy_office'],
  ['scan.tiff', 'image', 'converted_image'],
  ['scan.tif', 'image', 'converted_image'],
  ['pic.bmp', 'image', 'converted_image'],
  ['photo.heic', 'image', 'converted_image'],
  ['a.zip', 'zip', 'archive'],
  ['m.eml', 'eml', 'email'],
  ['t.odt', 'odt', 'opendocument'],
  ['s.ods', 'ods', 'opendocument'],
  ['p.odp', 'odp', 'opendocument'],
  ['n.md', 'md', 'markdown'],
  ['b.xlsx', 'xlsx', 'office'],
  ['d.docx', 'docx', 'office'],
  ['p.pptx', 'pptx', 'office'],
  ['v.mp4', 'video', 'media'],
  ['s.mp3', 'audio', 'media'],
  ['blob.bin', 'other', 'media'],
  ['code.py', 'txt', 'code'],
  ['n.txt', 'txt', 'text'],
];

group('kindOf', () => {
  for (const [filename, file_type, kind] of TABLE) {
    it(`${filename} previews as ${kind}`, () => {
      expect(kindOf({ filename, file_type })).toBe(kind);
    });
  }

  it('names the conversion target for legacy files', () => {
    expect(legacySentence({ filename: 'old.doc', file_type: 'doc_legacy' })).toContain('.docx');
    expect(legacySentence({ filename: 'old.xls', file_type: 'xls_legacy' })).toContain('.xlsx');
  });

  it('reads the extension case-insensitively', () => {
    expect(extensionOfDoc({ filename: 'SCAN.TIFF', file_type: 'image' })).toBe('tiff');
    expect(kindOf({ filename: 'A.ZIP', file_type: 'other' })).toBe('archive');
  });
});
