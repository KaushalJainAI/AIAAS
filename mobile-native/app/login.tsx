import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../src/components/Text';

import { useAuth } from '../src/auth/AuthContext';
import { GoogleButton } from '../src/auth/GoogleButton';
import { Button } from '../src/components/Button';
import { ErrorText } from '../src/components/ErrorText';
import { Screen } from '../src/components/Screen';
import { TextField } from '../src/components/TextField';
import { fontFamily, pressedOpacity, useTheme } from '../src/theme';

/** Mirrors the web's sign-in page (better-n8n-frontend/src/pages/Login.tsx): same words, same order. */
export default function LoginScreen() {
  const { signIn, signInWithGoogle } = useAuth();
  const router = useRouter();
  const { colors, spacing, fontSize, typography } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy && !googleBusy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      // On success the gate in _layout.tsx moves the user into the app.
      await signIn(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.');
      setBusy(false);
    }
  }

  async function continueWithGoogle() {
    if (busy || googleBusy) return;
    setGoogleBusy(true);
    setError(null);
    try {
      // Resolves false when the person closed the browser; nothing to report then.
      await signInWithGoogle();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google sign-in failed. Please try again.');
    } finally {
      setGoogleBusy(false);
    }
  }

  function openLegal(path: '/terms' | '/privacy', title: string) {
    router.push({ pathname: '/web', params: { path, title } });
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <View style={styles.header}>
          <Text style={[typography.title, { color: colors.text }]} accessibilityRole="header">
            Welcome back
          </Text>
          <Text style={[typography.body, { color: colors.mutedText, marginTop: spacing.xs }]}>
            Sign in to your workspace.
          </Text>
        </View>

        <View style={{ gap: spacing.lg }}>
          <ErrorText message={error} />

          {/* Google first: on a phone it is the one-tap way in. */}
          <GoogleButton label="Continue with Google" busy={googleBusy} onPress={continueWithGoogle} />

          <View style={styles.divider}>
            <View style={[styles.rule, { backgroundColor: colors.border }]} />
            <Text style={[typography.caption, { color: colors.mutedText }]}>or with email</Text>
            <View style={[styles.rule, { backgroundColor: colors.border }]} />
          </View>

          <TextField
            label="Email"
            placeholder="name@example.com"
            value={email}
            onChangeText={setEmail}
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
          />
          <View style={{ gap: spacing.xs }}>
            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              editable={!busy}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Forgot password"
              onPress={() => router.push('/forgot-password')}
              style={({ pressed }) => [styles.alignEnd, { opacity: pressed ? pressedOpacity : 1 }]}
            >
              <Text style={[typography.bodyStrong, { color: colors.primary, fontSize: fontSize.md }]}>
                Forgot password?
              </Text>
            </Pressable>
          </View>

          <Button title="Sign in" onPress={submit} loading={busy} disabled={!canSubmit} />
        </View>

        <View style={[styles.footer, { gap: spacing.md }]}>
          <Text style={[typography.body, { color: colors.mutedText, textAlign: 'center' }]}>
            Don&apos;t have an account?{' '}
            <Text
              accessibilityRole="link"
              onPress={() => router.push('/signup')}
              style={[typography.bodyStrong, { color: colors.primary }]}
            >
              Sign up
            </Text>
          </Text>
          <Text style={[typography.caption, { color: colors.mutedText, textAlign: 'center' }]}>
            By continuing you agree to our{' '}
            <Text
              accessibilityRole="link"
              onPress={() => openLegal('/terms', 'Terms of Service')}
              style={{ color: colors.text, textDecorationLine: 'underline', fontFamily: fontFamily.regular }}
            >
              Terms of Service
            </Text>{' '}
            and{' '}
            <Text
              accessibilityRole="link"
              onPress={() => openLegal('/privacy', 'Privacy policy')}
              style={{ color: colors.text, textDecorationLine: 'underline', fontFamily: fontFamily.regular }}
            >
              Privacy policy
            </Text>
            .
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'center' },
  header: { marginBottom: 24 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  alignEnd: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center' },
  footer: { marginTop: 32 },
});
