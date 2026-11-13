import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';

import { Button } from '../../components/Button';
import { ErrorText } from '../../components/ErrorText';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { success } from '../../lib/haptics';
import { spacing, typography, useTheme } from '../../theme';
import { errorMessage } from '../settings/errors';
import { Notice, type NoticeTone } from '../settings/Notice';
import {
  useAccountProfile,
  useChangePassword,
  useConfirmEmailChange,
  useRequestEmailChange,
  useRequestPasswordChangeOtp,
  useVerifyPasswordChangeOtp,
} from './queries';

type PasswordStep = 'start' | 'code' | 'new';
type EmailStep = 'idle' | 'request' | 'confirm';

interface Message {
  text: string;
  tone: NoticeTone;
}

/**
 * Change the password or the sign-in email. Both need a code emailed to the
 * account (for the password, the current one is checked first). Each change
 * ends every other session; this phone keeps working.
 */
export function SecurityScreen() {
  const { colors } = useTheme();
  const profile = useAccountProfile();

  const requestOtp = useRequestPasswordChangeOtp();
  const verifyOtp = useVerifyPasswordChangeOtp();
  const changePassword = useChangePassword();
  const requestEmail = useRequestEmailChange();
  const confirmEmail = useConfirmEmailChange();

  const [pwStep, setPwStep] = useState<PasswordStep>('start');
  const [oldPassword, setOldPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwMessage, setPwMessage] = useState<Message | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  const [emailStep, setEmailStep] = useState<EmailStep>('idle');
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [code, setCode] = useState('');
  const [emailMessage, setEmailMessage] = useState<Message | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  if (profile.isPending) return <LoadingState text="Loading" />;
  if (profile.isError || !profile.data) {
    return <ErrorState message="Could not load your account. Check your connection and try again." onRetry={() => void profile.refetch()} />;
  }
  const currentEmail = profile.data.email;
  const busyPw = requestOtp.isPending || verifyOtp.isPending || changePassword.isPending;
  const busyEmail = requestEmail.isPending || confirmEmail.isPending;

  function sendPasswordCode() {
    setPwError(null);
    setPwMessage(null);
    requestOtp.mutate(oldPassword, {
      onSuccess: (res) => {
        setPwMessage({ text: res.detail, tone: 'success' });
        setPwStep('code');
      },
      onError: (err) => setPwError(errorMessage(err, 'Could not send a code. Check your current password.')),
    });
  }

  function checkPasswordCode() {
    setPwError(null);
    verifyOtp.mutate(otp, {
      onSuccess: (res) => {
        setToken(res.verification_token);
        setPwMessage({ text: res.detail, tone: 'success' });
        setPwStep('new');
      },
      onError: (err) => setPwError(errorMessage(err, 'That code is not right or has expired.')),
    });
  }

  function savePassword() {
    setPwError(null);
    if (newPassword !== confirmPassword) {
      setPwError('The new passwords do not match.');
      return;
    }
    changePassword.mutate(
      { old_password: oldPassword, verification_token: token, new_password: newPassword, confirm_password: confirmPassword },
      {
        onSuccess: (res) => {
          success();
          setOldPassword('');
          setOtp('');
          setToken('');
          setNewPassword('');
          setConfirmPassword('');
          setPwStep('start');
          setPwMessage({ text: res.detail || 'Password changed.', tone: 'success' });
        },
        onError: (err) => setPwError(errorMessage(err, 'Failed to change password')),
      },
    );
  }

  function sendEmailCode() {
    setEmailError(null);
    setEmailMessage(null);
    requestEmail.mutate(
      { newEmail: newEmail.trim(), password: emailPassword },
      {
        onSuccess: (res) => {
          setEmailMessage({ text: res.detail, tone: 'success' });
          setEmailStep('confirm');
        },
        onError: (err) => setEmailError(errorMessage(err, 'Could not send a code.')),
      },
    );
  }

  function confirmNewEmail() {
    setEmailError(null);
    confirmEmail.mutate(code.trim(), {
      onSuccess: (res) => {
        success();
        setEmailMessage({ text: `Your email is now ${res.email}`, tone: 'success' });
        setEmailStep('idle');
        setNewEmail('');
        setEmailPassword('');
        setCode('');
      },
      onError: (err) => setEmailError(errorMessage(err, 'That code did not work.')),
    });
  }

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'Password & email' }} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.xxl }}>
        <Section title="Change password" footer="We check your current password, then email you a code. Changing it ends every other session.">
          <View style={{ padding: spacing.lg, gap: spacing.lg }}>
            <Notice message={pwMessage?.text} tone={pwMessage?.tone} />

            {pwStep === 'start' ? (
              <>
                <TextField label="Current password" value={oldPassword} onChangeText={setOldPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" />
                <Button title="Send code" loading={requestOtp.isPending} disabled={!oldPassword || busyPw} onPress={sendPasswordCode} />
              </>
            ) : null}

            {pwStep === 'code' ? (
              <>
                <TextField
                  label="Email code"
                  value={otp}
                  onChangeText={(text) => setOtp(text.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  maxLength={6}
                />
                <Button title="Verify code" loading={verifyOtp.isPending} disabled={otp.length !== 6 || busyPw} onPress={checkPasswordCode} />
              </>
            ) : null}

            {pwStep === 'new' ? (
              <>
                <TextField label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" />
                <TextField label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" />
                <Button title="Update Password" loading={changePassword.isPending} disabled={!newPassword || !confirmPassword || busyPw} onPress={savePassword} />
              </>
            ) : null}

            <ErrorText message={pwError} />
          </View>
        </Section>

        <Section title="Email address" footer="We send a code to the new address. Your email changes once you enter it.">
          <View style={{ padding: spacing.lg, gap: spacing.lg }}>
            <ListRow title={currentEmail} chevron={false} />
            <Notice message={emailMessage?.text} tone={emailMessage?.tone} />

            {emailStep === 'idle' ? (
              <Button title="Change email" variant="secondary" onPress={() => setEmailStep('request')} />
            ) : null}

            {emailStep === 'request' ? (
              <>
                <TextField label="New email address" value={newEmail} onChangeText={setNewEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} textContentType="emailAddress" />
                <TextField
                  label="Current password (leave blank if you sign in with Google)"
                  value={emailPassword}
                  onChangeText={setEmailPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button title="Cancel" variant="secondary" disabled={busyEmail} onPress={() => setEmailStep('idle')} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button title="Send code" loading={requestEmail.isPending} disabled={!newEmail.trim() || busyEmail} onPress={sendEmailCode} />
                  </View>
                </View>
              </>
            ) : null}

            {emailStep === 'confirm' ? (
              <>
                <Text style={[typography.caption, { color: colors.mutedText }]}>Enter the code sent to {newEmail.trim()}.</Text>
                <TextField label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button title="Cancel" variant="secondary" disabled={busyEmail} onPress={() => setEmailStep('idle')} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button title="Confirm" loading={confirmEmail.isPending} disabled={!code.trim() || busyEmail} onPress={confirmNewEmail} />
                  </View>
                </View>
              </>
            ) : null}

            <ErrorText message={emailError} />
          </View>
        </Section>
      </ScrollView>
    </Screen>
  );
}
