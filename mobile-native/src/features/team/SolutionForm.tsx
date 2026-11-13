import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { pressedOpacity, spacing, typography, useTheme } from '../../theme';
import {
  claimKindInfo,
  hasErrors,
  LIMITS,
  SAVED_CLAIM_KINDS,
  toDraft,
  validate,
  type ClaimRow,
  type EnvRow,
  type FormErrors,
  type FormValues,
} from './form';
import type { DraftFields } from './types';

export interface SolutionFormProps {
  initial: FormValues;
  /** Only a new solution offers "Share with <org>". */
  shareOption?: boolean;
  orgName?: string | null;
  /** Offers "I checked this is still true" (edits of a saved solution). */
  verifiable?: boolean;
  submitLabel: string;
  busy?: boolean;
  /** A refusal from the server, shown under the form. */
  serverError?: string | null;
  onSubmit: (draft: DraftFields, options: { share: boolean; verified: boolean }) => void;
  onCancel?: () => void;
}

/**
 * The form for writing a solution by hand: new, edit, and reviewing a draft.
 * It collects and checks; the parent makes the request and shows the outcome.
 */
export function SolutionForm({
  initial,
  shareOption = false,
  orgName,
  verifiable = false,
  submitLabel,
  busy = false,
  serverError,
  onSubmit,
  onCancel,
}: SolutionFormProps) {
  const { colors } = useTheme();
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [share, setShare] = useState(false);
  const [verified, setVerified] = useState(false);
  const [showClaims, setShowClaims] = useState(initial.claims.length > 0);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const submit = () => {
    const found = validate(values);
    setErrors(found);
    if (hasErrors(found) || busy) return;
    onSubmit(toDraft(values), { share: shareOption && share, verified: verifiable && verified });
  };

  const updateEnv = (index: number, patch: Partial<EnvRow>) =>
    set('environment', values.environment.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const updateClaim = (index: number, patch: Partial<ClaimRow>) =>
    set('claims', values.claims.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <View style={styles.form}>
      <TextField
        label="The problem *"
        value={values.problem}
        maxLength={LIMITS.problem}
        onChangeText={(v) => set('problem', v)}
        error={errors.problem}
        placeholder="One sentence. What does someone see when it goes wrong?"
        placeholderTextColor={colors.mutedText}
      />

      <TextField
        label="Symptoms"
        value={values.symptoms}
        onChangeText={(v) => set('symptoms', v)}
        error={errors.symptoms}
        multiline
        placeholder="The error text or what you saw. Paste it as it is."
        placeholderTextColor={colors.mutedText}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.multi}
      />

      <TextField
        label="What caused it"
        value={values.root_cause}
        onChangeText={(v) => set('root_cause', v)}
        error={errors.root_cause}
        multiline
        style={styles.multiSmall}
      />

      <TextField
        label="What fixed it *"
        value={values.resolution}
        onChangeText={(v) => set('resolution', v)}
        error={errors.resolution}
        multiline
        placeholder="The steps or change that made it work."
        placeholderTextColor={colors.mutedText}
        style={styles.multi}
      />

      <TextField
        label="Tags"
        value={values.tags}
        onChangeText={(v) => set('tags', v)}
        error={errors.tags}
        placeholder="Comma separated, for example: ci, windows, cache."
        placeholderTextColor={colors.mutedText}
        autoCapitalize="none"
      />

      <View style={styles.block}>
        <Text style={[typography.label, { color: colors.text }]}>Where it applies</Text>
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          Versions and settings this fix depends on. A later answer for a different setup is marked to check.
        </Text>
        {values.environment.map((row, index) => (
          <View key={index} style={styles.envRow}>
            <View style={styles.envKey}>
              <TextField
                label={`Environment name ${index + 1}`}
                value={row.key}
                maxLength={LIMITS.envKey}
                onChangeText={(v) => updateEnv(index, { key: v })}
                placeholder="Name, e.g. os"
                placeholderTextColor={colors.mutedText}
                autoCapitalize="none"
              />
            </View>
            <View style={styles.envValue}>
              <TextField
                label={`Environment value ${index + 1}`}
                value={row.value}
                maxLength={LIMITS.envValue}
                onChangeText={(v) => updateEnv(index, { value: v })}
                placeholder="Value, e.g. Windows 11"
                placeholderTextColor={colors.mutedText}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove environment row ${index + 1}`}
              onPress={() => set('environment', values.environment.filter((_, i) => i !== index))}
              style={styles.remove}
            >
              <Icon name="close" size={20} color={colors.mutedText} />
            </Pressable>
          </View>
        ))}
        <ErrorText message={errors.environment} />
        {values.environment.length < LIMITS.envRows ? (
          <View style={styles.addButton}>
            <Button
              title="Add a setting"
              variant="secondary"
              onPress={() => set('environment', [...values.environment, { key: '', value: '' }])}
            />
          </View>
        ) : null}
      </View>

      <View style={[styles.block, styles.claimsBox, { borderColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showClaims }}
          onPress={() => setShowClaims((v) => !v)}
          style={({ pressed }) => [styles.claimsHead, { opacity: pressed ? pressedOpacity : 1 }]}
        >
          <Text style={[typography.label, { color: colors.text, flex: 1 }]}>
            Advanced: how fast each part goes out of date
          </Text>
          <Icon name={showClaims ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedText} />
        </Pressable>
        {showClaims ? (
          <View style={styles.block}>
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              Write each statement the fix relies on and pick how quickly it changes. A statement past its window is
              marked “check” for everyone who reads it. Leave this empty and the fix is kept as one claim.
            </Text>
            {values.claims.map((row, index) => {
              const info = claimKindInfo(row.kind);
              return (
                <View key={index} style={[styles.claim, { backgroundColor: colors.surfaceMuted }]}>
                  <View style={styles.envRow}>
                    <View style={styles.envValue}>
                      <TextField
                        label={`Claim ${index + 1}`}
                        value={row.text}
                        maxLength={LIMITS.claimText}
                        onChangeText={(v) => updateClaim(index, { text: v })}
                        placeholder="A statement the fix relies on"
                        placeholderTextColor={colors.mutedText}
                      />
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove claim ${index + 1}`}
                      onPress={() => set('claims', values.claims.filter((_, i) => i !== index))}
                      style={styles.remove}
                    >
                      <Icon name="close" size={20} color={colors.mutedText} />
                    </Pressable>
                  </View>
                  <View style={styles.kinds}>
                    {SAVED_CLAIM_KINDS.map((k) => {
                      const on = k.value === row.kind;
                      return (
                        <Pressable
                          key={k.value}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={`How fast claim ${index + 1} changes: ${k.label}`}
                          onPress={() => updateClaim(index, { kind: k.value })}
                          style={[
                            styles.kind,
                            { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface },
                          ]}
                        >
                          <Text style={[typography.caption, { color: on ? colors.primaryText : colors.text }]}>{k.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={[typography.caption, { color: colors.mutedText }]}>{info.help}</Text>
                </View>
              );
            })}
            <ErrorText message={errors.claims} />
            {values.claims.length < LIMITS.claims ? (
              <View style={styles.addButton}>
                <Button
                  title="Add a claim"
                  variant="secondary"
                  onPress={() => set('claims', [...values.claims, { text: '', kind: 'procedure' }])}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {shareOption ? (
        <CheckRow
          checked={share}
          onChange={setShare}
          label={`Share with ${orgName ?? 'my organisation'}`}
          hint="Leave it off to keep it to yourself. You can share it later from the page."
        />
      ) : null}

      {verifiable ? (
        <CheckRow
          checked={verified}
          onChange={setVerified}
          label="I checked this is still true"
          hint="Tick it only after you have confirmed the fix works today. Leave it off for a typo or wording change."
        />
      ) : null}

      <ErrorText message={serverError} />

      <View style={styles.actions}>
        <View style={styles.action}>
          <Button title={submitLabel} loading={busy} disabled={busy} onPress={submit} />
        </View>
        {onCancel ? (
          <View style={styles.action}>
            <Button title="Cancel" variant="secondary" disabled={busy} onPress={onCancel} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      style={styles.check}
    >
      <Icon name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? colors.primary : colors.mutedText} />
      <View style={styles.checkText}>
        <Text style={[typography.body, { color: colors.text }]}>{label}</Text>
        <Text style={[typography.caption, { color: colors.mutedText }]}>{hint}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  multi: { minHeight: 96, textAlignVertical: 'top' },
  multiSmall: { minHeight: 64, textAlignVertical: 'top' },
  block: { gap: spacing.sm },
  envRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  envKey: { width: '34%' },
  envValue: { flex: 1 },
  remove: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  addButton: { alignSelf: 'stretch' },
  claimsBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, padding: spacing.md, gap: spacing.md },
  claimsHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  claim: { borderRadius: 6, padding: spacing.md, gap: spacing.sm },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  kind: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, minHeight: 44 },
  checkText: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', gap: spacing.md },
  action: { flex: 1 },
});
