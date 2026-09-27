/**
 * Saves a generated asset to disk.
 *
 * Imagine outputs arrive two ways: images and audio as `data:` URLs (the
 * backend base64s the provider response) and video as a remote OpenRouter URL.
 * A plain `<a download>` covers the first but is ignored by browsers for
 * cross-origin hrefs, which would open the video in a tab instead of saving
 * it — so remote URLs are fetched into a blob first.
 */

/** Best-effort file extension from a data URL's media type or a URL's path. */
function extensionFor(url: string, fallback: string): string {
  if (url.startsWith('data:')) {
    const mediaType = url.slice(5, url.indexOf(';'));
    const subtype = mediaType.split('/')[1];
    if (!subtype) return fallback;
    return subtype === 'mpeg' ? 'mp3' : subtype.replace('+xml', '');
  }
  const path = url.split('?')[0];
  const match = /\.([a-z0-9]{2,4})$/i.exec(path);
  return match ? match[1] : fallback;
}

function triggerDownload(href: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * @param baseName Filename without extension; the extension is inferred.
 * @throws when a remote asset cannot be fetched, so callers can report it.
 */
export async function downloadFile(url: string, baseName: string, fallbackExt = 'bin'): Promise<void> {
  const safeName = baseName.replace(/[^\w\-. ]+/g, '').trim().slice(0, 60) || 'generation';
  const filename = `${safeName}.${extensionFor(url, fallbackExt)}`;

  if (url.startsWith('data:') || url.startsWith('blob:')) {
    triggerDownload(url, filename);
    return;
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    triggerDownload(objectUrl, filename);
  } finally {
    // Revoke on the next tick — revoking synchronously can race the click.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
  }
}

/** Save a blob the app already holds (a download, an export, a version). */
export function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    triggerDownload(objectUrl, filename);
  } finally {
    // Revoke on the next tick — revoking synchronously can race the click.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
  }
}

/** Default file extension per modality, used when the URL reveals nothing. */
export const DEFAULT_EXTENSION: Record<'image' | 'video' | 'audio', string> = {
  image: 'png',
  video: 'mp4',
  audio: 'mp3',
};
