import { describe, expect, it } from 'vitest';

import {
  AUDIENCES, DEFAULT_AUDIENCE, audienceLabel, filePathFor, mailtoLink, pageUrl, shareTitle,
} from '../share';

describe('share', () => {
  it('offers the three audiences narrowest first and starts on the narrowest', () => {
    expect(AUDIENCES.map((a) => a.value)).toEqual(['link', 'platform', 'public']);
    expect(DEFAULT_AUDIENCE).toBe('link');
  });

  it('labels an audience, and an unknown one as the narrowest', () => {
    expect(audienceLabel('public')).toBe('Anyone on the internet');
    expect(audienceLabel(undefined)).toBe('People I send the link to');
  });

  it('builds the page address from the slug', () => {
    expect(pageUrl('q3-report', 'https://app.example/')).toBe('https://app.example/p/q3-report');
  });

  it('titles a page by the file name without its extension', () => {
    expect(shareTitle('Q3 report.final.docx')).toBe('Q3 report.final');
    expect(shareTitle('.env')).toBe('.env');
    expect(shareTitle('x'.repeat(300)).length).toBe(200);
  });

  it('drafts an email that carries the link', () => {
    const link = mailtoLink('a & b.pdf', 'https://app.example/p/a-b');
    expect(link.startsWith('mailto:?subject=a%20%26%20b.pdf&body=')).toBe(true);
    expect(decodeURIComponent(link.split('body=')[1])).toContain('https://app.example/p/a-b');
  });

  it('names a file by the path the file tools read', () => {
    expect(filePathFor({ filename: 'a.md', folder_path: '/Reports/' })).toBe('/Reports/a.md');
    expect(filePathFor({ filename: 'a.md', folder_path: null })).toBe('/a.md');
    expect(filePathFor({ filename: 'a.md', folder_path: '/' })).toBe('/a.md');
  });
});
