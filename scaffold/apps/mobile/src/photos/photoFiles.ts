import * as FileSystem from 'expo-file-system/legacy';

const PHOTO_DIR = 'progress-photos';
const KNOWN_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp']);

function extensionFor(uri: string) {
  const clean = uri.split(/[?#]/)[0] ?? '';
  const match = /\.([a-zA-Z0-9]{3,5})$/.exec(clean);
  const ext = match?.[1]?.toLowerCase();
  return ext && KNOWN_EXTENSIONS.has(ext) ? ext : 'jpg';
}

export async function persistProgressPhotoFile(sourceUri: string, id: string): Promise<string> {
  const root = FileSystem.documentDirectory;
  if (!root) return sourceUri;

  const dir = `${root}${PHOTO_DIR}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

  const destination = `${dir}${id}.${extensionFor(sourceUri)}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destination });
  return destination;
}

export async function removeProgressPhotoFile(imageUri: string): Promise<void> {
  const root = FileSystem.documentDirectory;
  if (!root || !imageUri.startsWith(`${root}${PHOTO_DIR}/`)) return;
  await FileSystem.deleteAsync(imageUri, { idempotent: true });
}
