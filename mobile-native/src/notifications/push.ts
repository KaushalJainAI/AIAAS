/**
 * Push notifications for the app. Tokens come from the Expo push service
 * (expo-notifications), which delivers through FCM on Android and APNs on iOS.
 * The backend keeps one row per token (POST/DELETE /api/notifications/push/devices/).
 *
 * Rules:
 *  - Permission is asked only inside `enablePush()`, when the person turns the
 *    feature on. Nothing else asks.
 *  - `registerIfPermitted()` runs at start and after sign-in. It registers only
 *    when the phone already allows notifications and the person has not turned
 *    them off in the app. It never asks.
 *  - Registration needs a signed-in session, and a real phone with an EAS
 *    project id. Without the id it is skipped with a log line, not an error.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

import { api } from '../api/client';
import { getAccessToken } from '../api/tokens';

const ENABLED_KEY = 'aiaas.push_enabled';
const TOKEN_KEY = 'aiaas.push_token';
const CHANNEL_ID = 'default';
const DEVICES_PATH = '/notifications/push/devices/';

// A push that arrives while the app is open still shows a banner, as it does in the background.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export type EnablePushResult = 'enabled' | 'denied' | 'unavailable';

/** Whether the person has turned notifications on in this app. */
export async function isPushEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(ENABLED_KEY)) === '1';
}

/**
 * Asks the phone for permission and registers this device. Call only from a
 * control the person pressed. Resolves to 'denied' when the phone refuses, and
 * 'unavailable' when push cannot work here (a simulator, or no EAS project id).
 */
export async function enablePush(): Promise<EnablePushResult> {
  if (!Device.isDevice) return 'unavailable';
  let { granted } = await Notifications.getPermissionsAsync();
  if (!granted) ({ granted } = await Notifications.requestPermissionsAsync());
  if (!granted) return 'denied';

  await ensureChannel();
  const token = await fetchToken();
  if (!token) return 'unavailable';
  await registerDevice(token);
  await SecureStore.setItemAsync(ENABLED_KEY, '1');
  return 'enabled';
}

/** Turns notifications off in the app and tells the server to stop sending here. */
export async function disablePush(): Promise<void> {
  await unregisterDevice();
  await SecureStore.setItemAsync(ENABLED_KEY, '0');
}

/**
 * Registers this device if the phone already allows notifications and the
 * person has not switched them off here. Silent when it cannot: a failed
 * registration must never block the app from starting.
 */
export async function registerIfPermitted(): Promise<void> {
  try {
    if (!Device.isDevice || !getAccessToken()) return;
    const { granted } = await Notifications.getPermissionsAsync();
    if (!granted) return;
    if ((await SecureStore.getItemAsync(ENABLED_KEY)) === '0') return;

    await ensureChannel();
    const token = await fetchToken();
    if (!token) return;
    const previous = await SecureStore.getItemAsync(TOKEN_KEY);
    if (previous && previous !== token) await deleteRemote(previous);
    await registerDevice(token);
  } catch (error) {
    console.warn('[push] Registration skipped:', error);
  }
}

/**
 * Forgets this device on the server. Called before sign-out, while the session
 * can still authorise the request. Best effort: a token the server does not
 * know is dropped there anyway.
 */
export async function unregisterDevice(): Promise<void> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) return;
  await deleteRemote(token);
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function ensureChannel(): Promise<void> {
  try {
    // Android only. On iOS the call resolves to null, so it runs on both platforms.
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Default',
      // eslint-disable-next-line import/namespace -- re-exported through `export *`; tsc resolves it
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  } catch (error) {
    console.warn('[push] Notification channel not set:', error);
  }
}

async function fetchToken(): Promise<string | null> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) {
    console.warn(
      '[push] No EAS project id (expo.extra.eas.projectId in app.json). Push is skipped until EAS is set up.',
    );
    return null;
  }
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}

async function registerDevice(token: string): Promise<void> {
  await api(DEVICES_PATH, {
    method: 'POST',
    body: {
      token,
      platform: Constants.platform?.ios ? 'ios' : 'android',
      app_version: Constants.expoConfig?.version ?? '',
    },
  });
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

async function deleteRemote(token: string): Promise<void> {
  try {
    await api(DEVICES_PATH, { method: 'DELETE', body: { token } });
  } catch {
    // Best effort: an unreachable server keeps the row until its next refusal.
  }
}
