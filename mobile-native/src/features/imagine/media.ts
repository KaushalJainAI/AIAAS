/**
 * Getting a finished generation out of the app. Images and audio are downloaded
 * to the cache and handed to the system share sheet, which is how a phone saves a
 * file (Save to Files, Save image, or any app). Video and audio play in the
 * in-app browser: there is no native media player in this build.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';

/** Download a generated file and open the share sheet for it. */
export async function saveOrShare(url: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  const file = await File.downloadFileAsync(url, Paths.cache);
  await Sharing.shareAsync(file.uri);
}

/** Play a video or audio result in the in-app browser. */
export async function openMedia(url: string): Promise<void> {
  await WebBrowser.openBrowserAsync(url);
}

/** Width over height from a `W:H` ratio string, for the frame of a result. */
export function aspectOf(ratio: string | null | undefined): number {
  if (!ratio || !ratio.includes(':')) return 1;
  const [w, h] = ratio.split(':').map(Number);
  return w > 0 && h > 0 ? w / h : 1;
}
