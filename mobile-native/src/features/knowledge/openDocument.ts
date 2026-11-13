import { useRouter } from 'expo-router';

/**
 * Opens one of the person's files in the web Files app. The file is addressed
 * by id, the one locator the Files page accepts; a plain document is not one
 * of the native editors, so it goes through the embedded web app.
 */
export function openDocument(router: ReturnType<typeof useRouter>, id: number, title: string): void {
  router.push({ pathname: '/web', params: { path: `/documents?doc=${id}`, title: title.slice(0, 60) } });
}
