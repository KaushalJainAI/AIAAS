import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { Text } from '../src/components/Text';

import { useAuth } from '../src/auth/AuthContext';
import { GoogleButton } from '../src/auth/GoogleButton';
import { Button } from '../src/components/Button';
import { ErrorText } from '../src/components/ErrorText';
import { Screen } from '../src/components/Screen';
import { TextField } from '../src/components/TextField';
import { useTheme } from '../src/theme';

/** Mirrors the web's sign-up page (better-n8n-frontend/src/pages/Signup.tsx): same fields, checks and wording. */
export default function SignupScreen() {
  const { signUp, signInWithGoogle } = useAuth();
  const router = useRouter();
  const { colors, spacing, typography } = useTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && confirmPassword.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    // The same checks, in the same order, as the website.
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signUp({ name, email: email.trim(), password });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create your account. Please try again.');
      setBusy(false);
    }
  }

  async function continueWithGoogle() {
    if (busy || googleBusy) return;
    setGoogleBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google sign-in failed. Please try again.');
    } finally {
      setGoogleBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <View style={styles.header}>
          <Text style={[typography.title, { color: colors.text }]} accessibilityRole="header">
            Create an account
          </Text>
          <Text style={[typography.body, { color: colors.mutedText, marginTop: spacing.xs }]}>
            Get started with your free workspace today.
          </Text>
        </View>

        <View style={{ gap: spacing.lg }}>
          <ErrorText message={error} />

          <GoogleButton label="Continue with Google" busy={googleBusy} onPress={continueWithGoogle} />

          <View style={styles.divider}>
            <View style={[styles.rule, { backgroundColor: colors.border }]} />
            <Text style={[typography.caption, { color: colors.mutedText }]}>or with email</Text>
            <View style={[styles.rule, { backgroundColor: colors.border }]} />
          </View>

          <TextField
            label="Name"
            placeholder="John Doe"
            value={name}
            onChangeText={setName}
            editable={!busy}
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
          />
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
          <TextField
            label="Password"
            placeholder="At least 8 characters"
            value={password}
            onChangeText={setPassword}
            editable={!busy}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
          />
          <TextField
            label="Confirm password"
            placeholder="Re-enter your password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            editable={!busy}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={submit}
          />

          <Button title="Create account" onPress={submit} loading={busy} disabled={!canSubmit} />
        </View>

        <View style={[styles.footer, { gap: spacing.md }]}>
          <Text style={[typography.caption, { color: colors.mutedText, textAlign: 'center' }]}>
            By clicking create account, you agree to our{' '}
            <Text
              accessibilityRole="link"
              onPress={() => router.push({ pathname: '/web', params: { path: '/terms', title: 'Terms of Service' } })}
              style={{ color: colors.text, textDecorationLine: 'underline' }}
            >
              Terms of Service
            </Text>{' '}
            and{' '}
            <Text
              accessibilityRole="link"
              onPress={() => router.push({ pathname: '/web', params: { path: '/privacy', title: 'Privacy policy' } })}
              style={{ color: colors.text, textDecorationLine: 'underline' }}
            >
              Privacy policy
            </Text>
            .
          </Text>
          <Text style={[typography.body, { color: colors.mutedText, textAlign: 'center' }]}>
            Already have an account?{' '}
            <Text
              accessibilityRole="link"
              onPress={() => router.replace('/login')}
              style={[typography.bodyStrong, { color: colors.primary }]}
            >
              Sign in
            </Text>
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
  footer: { marginTop: 32 },
});
