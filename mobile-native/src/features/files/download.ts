/**
 * Getting a copy of a file onto the device, for the share sheet. Downloads use
 * the bearer token (`authorizationHeaders`); a 401 refreshes the session once,
 * as `api()` does.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { refreshAccessToken } from '../../api/client';
import { documentDownloadPath } from './api';
import { authorizationHeaders, buildUrl } from './transfer';

function safeName(name: string): string {
  // Characters a file system refuses, and control characters.
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 200) || 'file';
}

/** Downloads a file into the cache folder and returns its local address. */
export async function downloadCopy(doc: { id: number; filename: string }): Promise<string> {
  const cache = FileSystem.cacheDirectory;
  if (!cache) throw new Error('This device has no folder to save the file in.');
  const dir = `${cache}shared/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
  const target = `${dir}${doc.id}-${safeName(doc.filename)}`;
  const url = buildUrl(documentDownloadPath(doc.id));
  const fetchIt = () => FileSystem.downloadAsync(url, target, { headers: authorizationHeaders() });

  let result = await fetchIt();
  if (result.status === 401) {
    const fresh = await refreshAccessToken();
    if (!fresh) throw new Error('Your sign-in has ended. Sign in again.');
    result = await fetchIt();
  }
  if (result.status < 200 || result.status >= 300) {
    throw new Error('The file could not be downloaded. Please try again.');
  }
  return result.uri;
}

/** Sends a copy of the file through the device's share sheet. */
export async function sendCopy(doc: { id: number; filename: string }): Promise<void> {
  const uri = await downloadCopy(doc);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, { dialogTitle: doc.filename });
}
