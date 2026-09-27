/**
 * Hosted pages: snapshots of a report, an HTML page or a file, shareable by link.
 *
 * Two read doors, as for shared agents: the public one needs no account and
 * answers only `public` pages; the signed-in one also answers `link` and
 * `platform` pages. Every refusal from either is the same 404, so a caller can
 * only ever learn "not found", never why.
 */
import apiClient from './client';

export type PageKind = 'report' | 'html' | 'file';
export type PageVisibility = 'link' | 'platform' | 'public';

export interface PublishedPage {
  slug: string;
  title: string;
  kind: PageKind;
  body: string;
  file_name: string;
  has_file: boolean;
  updated_at: string;
  /** Signed-in reads only. */
  visibility?: PageVisibility;
  is_listed?: boolean;
  is_mine?: boolean;
  created_at?: string;
}

export const pagesService = {
  publicGet: async (slug: string): Promise<PublishedPage> =>
    (await apiClient.get<PublishedPage>(`/inference/public/pages/${slug}/`)).data,

  get: async (slug: string): Promise<PublishedPage> =>
    (await apiClient.get<PublishedPage>(`/inference/pages/${slug}/`)).data,

  /** The caller's own pages, or with `platform` everyone's listed pages. */
  list: async (scope?: 'platform'): Promise<{ results: PublishedPage[]; truncated: boolean }> =>
    (await apiClient.get('/inference/pages/', { params: scope ? { scope } : undefined })).data,

  /** Unlists the page: the link stops resolving; nothing is deleted. */
  withdraw: async (slug: string): Promise<void> => {
    await apiClient.delete(`/inference/pages/${slug}/`);
  },

  download: async (slug: string, isPublic: boolean): Promise<Blob> => {
    const path = isPublic ? `/inference/public/pages/${slug}/download/` : `/inference/pages/${slug}/download/`;
    return (await apiClient.get(path, { responseType: 'blob' })).data;
  },

  previewBlobUrl: async (slug: string, isPublic: boolean): Promise<string> => {
    const path = isPublic ? `/inference/public/pages/${slug}/download/` : `/inference/pages/${slug}/download/`;
    const blob = (await apiClient.get<Blob>(path, { responseType: 'blob', params: { inline: '1' } })).data;
    return URL.createObjectURL(blob);
  },
};

export default pagesService;
