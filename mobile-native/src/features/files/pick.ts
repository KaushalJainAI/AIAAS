/**
 * Files and photos picked on the device, in the shape the upload calls take.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import type { UploadFile } from './upload';

/** Any file from the device's file picker. Empty when the user cancels. */
export async function pickFiles(): Promise<UploadFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
    type: '*/*',
  });
  if (result.canceled) return [];
  return result.assets.map((asset) => ({
    uri: asset.uri,
    name: asset.name,
    type: asset.mimeType ?? 'application/octet-stream',
  }));
}

/** Photos from the photo library. Empty when the user cancels. */
export async function pickPhotos(): Promise<UploadFile[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    quality: 1,
  });
  if (result.canceled) return [];
  return result.assets.map((asset, i) => ({
    uri: asset.uri,
    name: asset.fileName ?? `photo-${Date.now()}-${i}.jpg`,
    type: asset.mimeType ?? 'image/jpeg',
  }));
}
