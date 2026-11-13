import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '../../components/Button';
import { ErrorText } from '../../components/ErrorText';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { success } from '../../lib/haptics';
import { connectGoogleAccount } from '../connections/oauthConnect';
import { connectionKeys } from '../connections/queries';
import { errorMessage } from '../settings/errors';
import { Notice, type NoticeTone } from '../settings/Notice';
import { PickerRow } from '../settings/PickerRow';
import { PickerSheet } from '../settings/Picker';
import { createCredential, listCredentials, updateCredential, verifyCredential } from './api';
import { credentialKeys } from './queries';
import type { Credential, CredentialFieldSchema, CredentialType } from './types';
import { fontFamily, fontSize, pressedOpacity, spacing, useTheme } from '../../theme';

/** The values a form starts with: the stored ones when editing, the schema defaults when creating. */
function initialValues(type: CredentialType, credential?: Credential): Record<string, string> {
  if (credential) {
    return Object.fromEntries(credential.fields.map((f) => [f.key, f.value]));
  }
  return Object.fromEntries(type.fields_schema.map((f) => [f.name, f.default ?? '']));
}

interface Props {
  type: CredentialType;
  /** Set to edit. Secrets come back masked, so only fields the user retyped are sent. */
  credential?: Credential;
}

/**
 * The schema-driven form for one credential. Create stores the values and then
 * verifies them at once, so the user learns whether the key works. Edit sends
 * only what changed, then verifies again, as the web's CredentialModal does.
 */
export function CredentialForm({ type, credential }: Props) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const editing = Boolean(credential);
  const isOAuth = type.auth_method === 'oauth2';

  const [snapshot] = useState(() => initialValues(type, credential));
  const [name, setName] = useState(credential?.name ?? '');
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...snapshot }));
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [pickerField, setPickerField] = useState<CredentialFieldSchema | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: NoticeTone } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: credentialKeys.all });
    void queryClient.invalidateQueries({ queryKey: connectionKeys.all });
  };

  /** A Google account: the browser returns to the website, so the credential list is read again. */
  async function connectAccount() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await connectGoogleAccount();
      const fresh = await queryClient.fetchQuery({ queryKey: credentialKeys.list, queryFn: listCredentials });
      refresh();
      if (fresh.some((c) => c.credential_type === type.id)) {
        success();
        router.back();
      } else {
        setNotice({ text: 'Not connected yet. Finish signing in, then come back here and check again.', tone: 'warning' });
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not start the sign-in. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setError(null);
    setNotice(null);
    if (!name.trim()) return setError('Name is required');

    // The server stores whatever it is given, so required fields are enforced here.
    if (!editing) {
      const missing = type.fields_schema.filter((f) => f.required && !(values[f.name] ?? '').trim()).map((f) => f.label);
      if (missing.length > 0) return setError(`Required: ${missing.join(', ')}`);
    }

    setBusy(true);
    try {
      let saved: Credential;
      if (credential) {
        const changed: Record<string, string> = {};
        for (const [key, value] of Object.entries(values)) {
          if (value !== snapshot[key]) changed[key] = value;
        }
        saved = await updateCredential(credential.id, { name: name.trim(), data: changed });
      } else {
        saved = await createCredential({ name: name.trim(), credential_type: type.id, data: values });
      }
      refresh();

      // Verify at once: a new or edited key is unusable until it checks out.
      try {
        const check = await verifyCredential(saved.id);
        if (check.valid) {
          success();
          setNotice({ text: editing ? 'Credential updated and verified' : 'Credential created and verified', tone: 'success' });
          router.back();
        } else {
          setNotice({ text: `Saved, but verification failed: ${check.message}`, tone: 'warning' });
        }
      } catch {
        setNotice({ text: editing ? 'Credential updated. Press Verify to activate it.' : 'Credential created. Press Verify to activate it.', tone: 'warning' });
      }
      refresh();
    } catch (err) {
      setError(errorMessage(err, 'Failed to save credential'));
    } finally {
      setBusy(false);
    }
  }

  const fieldOptions = pickerField?.options ?? [];

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xxl }}>
        <Text style={{ color: colors.mutedText, fontSize: fontSize.md, fontFamily: fontFamily.regular }}>{type.name}</Text>
        {type.description ? <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>{type.description}</Text> : null}

        {isOAuth ? (
          <View style={{ gap: spacing.md }}>
            <Text style={{ color: colors.text, fontSize: fontSize.md }}>
              Connect your account to authorize access. Tokens are stored and refreshed automatically.
            </Text>
            <Button title="Connect account" loading={busy} disabled={busy} onPress={() => void connectAccount()} />
            <Notice message={notice?.text} tone={notice?.tone} />
            <ErrorText message={error} />
          </View>
        ) : (
          <>
            <TextField label="Name" value={name} onChangeText={setName} placeholder="My Credential" />

            {type.fields_schema.map((field) => {
              const value = values[field.name] ?? '';
              const setValue = (next: string) => setValues((prev) => ({ ...prev, [field.name]: next }));
              const label = field.required ? `${field.label} *` : field.label;

              if (field.type === 'select') {
                return (
                  <PickerRow
                    key={field.name}
                    label={label}
                    value={field.options?.find((o) => o.value === value)?.label ?? ''}
                    placeholder="Select..."
                    onPress={() => setPickerField(field)}
                  />
                );
              }

              if (field.type === 'password') {
                const shown = revealed.has(field.name);
                return (
                  <View key={field.name} style={{ gap: spacing.xs }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={{ color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.medium }}>{label}</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={shown ? 'Hide value' : 'Show value'}
                        onPress={() =>
                          setRevealed((prev) => {
                            const next = new Set(prev);
                            if (next.has(field.name)) next.delete(field.name);
                            else next.add(field.name);
                            return next;
                          })
                        }
                        style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? pressedOpacity : 1 })}
                      >
                        <Text style={{ color: colors.primary, fontSize: fontSize.md, fontFamily: fontFamily.medium }}>
                          {shown ? 'Hide' : 'Show'}
                        </Text>
                      </Pressable>
                    </View>
                    <TextField
                      label={label}
                      value={value}
                      onChangeText={setValue}
                      placeholder={field.placeholder}
                      secureTextEntry={!shown}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={{ fontFamily: fontFamily.mono }}
                    />
                  </View>
                );
              }

              if (field.type === 'textarea') {
                return (
                  <TextField
                    key={field.name}
                    label={label}
                    value={value}
                    onChangeText={setValue}
                    placeholder={field.placeholder}
                    multiline
                    numberOfLines={3}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={{ minHeight: 72, textAlignVertical: 'top', fontFamily: fontFamily.mono }}
                  />
                );
              }

              return (
                <TextField
                  key={field.name}
                  label={label}
                  value={value}
                  onChangeText={setValue}
                  placeholder={field.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ fontFamily: fontFamily.mono }}
                />
              );
            })}

            <ErrorText message={error} />
            <Notice message={notice?.text} tone={notice?.tone} />

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button title="Cancel" variant="secondary" disabled={busy} onPress={() => router.back()} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title={editing ? 'Update Credential' : 'Create Credential'}
                  loading={busy}
                  disabled={busy}
                  onPress={() => void submit()}
                />
              </View>
            </View>
          </>
        )}
      </ScrollView>

      <PickerSheet
        visible={pickerField !== null}
        title={pickerField?.label ?? ''}
        options={[{ value: '', label: 'Select...' }, ...fieldOptions.map((o) => ({ value: o.value, label: o.label }))]}
        value={pickerField ? (values[pickerField.name] ?? '') : null}
        onPick={(value) => {
          if (pickerField) setValues((prev) => ({ ...prev, [pickerField.name]: value }));
        }}
        onClose={() => setPickerField(null)}
      />
    </Screen>
  );
}
