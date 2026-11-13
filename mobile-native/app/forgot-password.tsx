import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../src/components/Text';

import { confirmPasswordReset, requestPasswordReset, verifyPasswordResetOtp } from '../src/features/account/api';
import { Button } from '../src/components/Button';
import { ErrorText } from '../src/components/ErrorText';
import { Icon } from '../src/components/Icon';
import { Screen } from '../src/components/Screen';
import { TextField } from '../src/components/TextField';
import { pressedOpacity, useTheme } from '../src/theme';

type Step = 'email' | 'otp' | 'password';

/**
 * Forgot password, as the web does it (better-n8n-frontend/src/pages/ForgotPassword.tsx):
 * email, then the 6-digit code, then a new password. Signed out; the three
 * endpoints are the ones the web calls.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { colors, spacing, typography } = useTheme();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  const sendCode = () =>
    run(async () => {
      await requestPasswordReset(email.trim());
      setStep('otp');
    }, 'Failed to send OTP.');

  const verifyCode = () =>
    run(async () => {
      const result = await verifyPasswordResetOtp(email.trim(), otp);
      setVerificationToken(result.verification_token);
      setStep('password');
    }, 'Invalid or expired OTP.');

  const resetPassword = () => {
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    void run(async () => {
      await confirmPasswordReset({
        email: email.trim(),
        verification_token: verificationToken,
        new_password: password,
        confirm_password: confirmPassword,
      });
      router.replace('/login');
    }, 'Failed to reset password.');
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Back to login"
          onPress={() => router.replace('/login')}
          style={({ pressed }) => [styles.back, { opacity: pressed ? pressedOpacity : 1 }]}
        >
          <Icon name="arrow-back" size={18} color={colors.mutedText} />
          <Text style={[typography.body, { color: colors.mutedText }]}>Back to login</Text>
        </Pressable>

        <View style={styles.header}>
          <Text style={[typography.title, { color: colors.text }]} accessibilityRole="header">
            Reset password
          </Text>
          <Text style={[typography.body, { color: colors.mutedText, marginTop: spacing.xs }]}>
            Verify your email with a 6-digit OTP.
          </Text>
        </View>

        <View style={{ gap: spacing.lg }}>
          <ErrorText message={error} />

          {step === 'email' && (
            <>
              <TextField
                label="Email"
                placeholder="name@example.com"
                value={email}
                onChangeText={setEmail}
                editable={!busy}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="go"
                onSubmitEditing={sendCode}
              />
              <Button title="Send OTP" onPress={sendCode} loading={busy} disabled={!email.trim() || busy} />
            </>
          )}

          {step === 'otp' && (
            <>
              <TextField
                label="6-digit OTP"
                placeholder="000000"
                value={otp}
                onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
                editable={!busy}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                maxLength={6}
                returnKeyType="go"
                onSubmitEditing={verifyCode}
              />
              <Button title="Verify OTP" onPress={verifyCode} loading={busy} disabled={otp.length !== 6 || busy} />
            </>
          )}

          {step === 'password' && (
            <>
              <TextField
                label="New password"
                placeholder="New password"
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
                placeholder="Confirm new password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                editable={!busy}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="go"
                onSubmitEditing={resetPassword}
              />
              <Button
                title="Reset Password"
                onPress={resetPassword}
                loading={busy}
                disabled={!password || !confirmPassword || busy}
              />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, alignSelf: 'flex-start', marginBottom: 16 },
  header: { marginBottom: 24 },
});
