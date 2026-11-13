/**
 * Picking files for a message. A file is chosen first and uploaded when the
 * message is sent, so removing its chip before then really removes it. The web
 * uploads at pick time; the upload itself is the same call either way.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import type { UploadFile } from '../files/upload';

/** A file chosen in the composer and not yet uploaded. */
export interface StagedFile extends UploadFile {
  /** Stable key for the chip list. */
  key: string;
  size?: number;
}

/** Any document from the device. Cancel answers an empty list. */
export async function pickDocuments(): Promise<StagedFile[]> {
  const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (res.canceled) return [];
  return res.assets.map((a) => ({
    key: a.uri,
    uri: a.uri,
    name: a.name,
    type: a.mimeType ?? 'application/octet-stream',
    size: a.size,
  }));
}

/** Photos from the library. Cancel answers an empty list. */
export async function pickPhotos(): Promise<StagedFile[]> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    quality: 1,
  });
  if (res.canceled) return [];
  return res.assets.map((a, i) => ({
    key: a.uri,
    uri: a.uri,
    name: a.fileName ?? `photo-${Date.now()}-${i}.jpg`,
    type: a.mimeType ?? 'image/jpeg',
    size: a.fileSize,
  }));
}
