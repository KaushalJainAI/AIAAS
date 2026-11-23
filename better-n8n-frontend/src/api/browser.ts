/**
 * The agent's browser, as the web app sees it (`Backend/browsing/views.py`).
 *
 * A `BrowserView` is one browser call the agent made: its page, the steps it
 * took and, when the provider offers one, a live view. The pictures are not in
 * the view. `frame_id` names a picture kept on the server for one owner, and
 * `frameBlob` fetches it with the auth header, because an <img> cannot send one.
 *
 * The shape is the backend's contract. Typed text never appears in `steps`.
 */
import apiClient from './client';

/** One step of a call. `selector` is cut to 120 characters on the server. */
export interface BrowserStep {
  action: string;
  selector: string;
  ok: boolean;
}

export interface BrowserView {
  /** Empty when no picture was kept for this call. */
  frame_id: string;
  url: string;
  title: string;
  /** The browser session the call used, or empty. */
  session: string;
  /** The provider's live view, or empty. Opened in a new tab, never framed. */
  live_url: string;
  steps: BrowserStep[];
  /** What the page needs from the person (a code, a login), or null. */
  needs_user: string | null;
}

/** What `POST /api/browser/preview/` returns for one link. */
export interface BrowserPreview {
  url: string;
  title: string;
  /** Empty when no picture was kept. */
  frame_id: string;
  /** At most 2,000 characters of the page's text. */
  text_excerpt: string;
}

export const browserService = {
  /** Whether this server has a browser the agent can use. */
  async status(): Promise<boolean> {
    const r = await apiClient.get<{ available: boolean }>('/browser/status/');
    return r.data?.available === true;
  },

  /**
   * Read one link: title, picture and text. Read only, nothing is clicked.
   * Rejects with the HTTP error: 404 (no browser), 400, 429 (rate limited), 502.
   */
  async preview(url: string): Promise<BrowserPreview> {
    const r = await apiClient.post<BrowserPreview>('/browser/preview/', { url });
    return r.data;
  },

  /** One picture, as a Blob, for `useBrowserFrameUrl` to turn into an object URL. */
  async frameBlob(frameId: string): Promise<Blob> {
    const r = await apiClient.get<Blob>(`/browser/frames/${encodeURIComponent(frameId)}/`, {
      responseType: 'blob',
    });
    return r.data;
  },
};
