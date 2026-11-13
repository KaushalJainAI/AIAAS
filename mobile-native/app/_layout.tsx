import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, type Href, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { ConfirmHost } from '../src/components/confirm';
import { useAppFonts } from '../src/fonts';
import { registerIfPermitted } from '../src/notifications/push';
import { hrefFromNotificationData } from '../src/notifications/route';
import { fontFamily, useTheme } from '../src/theme';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

/** Screens a signed-out person may see. `web` serves the terms and privacy pages. */
const SIGNED_OUT_ROUTES = ['login', 'signup', 'forgot-password', 'web'];
/** The sign-in and sign-up screens, which a signed-in person is taken away from. */
const AUTH_ROUTES = ['login', 'signup', 'forgot-password'];

export default function RootLayout() {
  // The web app's fonts. Nothing renders until they are in, so no screen flashes in the system font.
  const fontsLoaded = useAppFonts();
  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <NavigationTheme>
            <StatusBar style="auto" />
            <AuthGate />
            <PushLifecycle />
            <ConfirmHost />
          </NavigationTheme>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/**
 * Headers, back buttons and the tab bar take the web app's colours and font
 * from here, so every screen's chrome matches without each layout setting it.
 */
function NavigationTheme({ children }: { children: React.ReactNode }) {
  const { dark, colors } = useTheme();
  const theme = useMemo(() => {
    const base = dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.primary,
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        notification: colors.danger,
      },
      fonts: {
        regular: { fontFamily: fontFamily.regular, fontWeight: '400' as const },
        medium: { fontFamily: fontFamily.medium, fontWeight: '500' as const },
        bold: { fontFamily: fontFamily.semibold, fontWeight: '600' as const },
        heavy: { fontFamily: fontFamily.bold, fontWeight: '700' as const },
      },
    };
  }, [dark, colors]);
  return <ThemeProvider value={theme}>{children}</ThemeProvider>;
}

/** Keeps signed-out users on the sign-in screens, and signed-in users out of them. */
function AuthGate() {
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const { colors } = useTheme();

  useEffect(() => {
    if (status === 'loading') return;
    const first = segments[0] ?? '';
    if (status === 'signedOut' && !SIGNED_OUT_ROUTES.includes(first)) router.replace('/login');
    if (status === 'signedIn' && AUTH_ROUTES.includes(first)) router.replace('/(tabs)/chat');
  }, [status, segments, router]);

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}

/**
 * Push, from outside the screens: registers this phone once a person is signed
 * in (and at every start), and opens the screen a tapped notification names.
 * A tap that arrives before sign-in is held until the person is in.
 */
function PushLifecycle() {
  const { status } = useAuth();
  const router = useRouter();
  const signedIn = status === 'signedIn';
  const signedInRef = useRef(signedIn);
  const held = useRef<Href | null>(null);

  useEffect(() => {
    signedInRef.current = signedIn;
    if (signedIn) {
      void registerIfPermitted();
      if (held.current) {
        router.push(held.current);
        held.current = null;
      }
    }
  }, [signedIn, router]);

  useEffect(() => {
    const open = (data: unknown) => {
      const href = hrefFromNotificationData(data);
      if (!href) return;
      if (signedInRef.current) router.push(href);
      else held.current = href;
    };

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      open(response.notification.request.content.data);
    });

    // The tap that launched the app. Cleared after reading so a later start does not replay it.
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      open(last.notification.request.content.data);
      Notifications.clearLastNotificationResponse();
    }

    return () => subscription.remove();
  }, [router]);

  return null;
}
