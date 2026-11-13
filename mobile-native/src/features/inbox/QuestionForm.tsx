import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { fontFamily, useTheme } from '../../theme';
import { answerProblem, type QuestionAnswer, type QuestionSpec } from './question';

const OTHER = '\u0000other';

interface Props {
  spec: QuestionSpec;
  busy: boolean;
  onSubmit: (answer: QuestionAnswer) => void;
  onSkip: () => void;
}

/**
 * An `ask_user` question: choice, multi_choice, number or text. Mirrors the web's
 * `components/chat/QuestionCard.tsx` (bare variant used in the Inbox detail).
 */
export function QuestionForm({ spec, busy, onSubmit, onSkip }: Props) {
  const { colors, spacing, fontSize, radius } = useTheme();
  const [choice, setChoice] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const [number, setNumber] = useState('');
  const [text, setText] = useState('');
  const multi = spec.kind === 'multi_choice';

  const answer = useMemo<QuestionAnswer | null>(() => {
    switch (spec.kind) {
      case 'choice':
        return choice === OTHER ? other.trim() : choice;
      case 'multi_choice': {
        const chosen = picked.filter((p) => p !== OTHER);
        return picked.includes(OTHER) && other.trim() ? [...chosen, other.trim()] : chosen;
      }
      case 'number':
        return number.trim() === '' ? null : Number(number);
      default:
        return text;
    }
  }, [spec.kind, choice, picked, other, number, text]);

  const problem = answerProblem(spec, answer);
  const hasInput = answer !== null && answer !== '' && !(Array.isArray(answer) && answer.length === 0);
  const rows = [...spec.options, ...(spec.allow_other ? [OTHER] : [])];
  const isOn = (value: string) => (multi ? picked.includes(value) : choice === value);
  const otherOn = isOn(OTHER);

  const toggle = (value: string) => {
    if (multi) {
      setPicked((prev) => (prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]));
    } else {
      setChoice(value);
    }
  };

  const submit = () => {
    if (!problem && answer !== null && !busy) onSubmit(answer);
  };

  const inputStyle = {
    color: colors.text,
    backgroundColor: colors.inputBackground,
    borderColor: colors.border,
    borderRadius: radius.md,
    fontSize: fontSize.md,
    fontFamily: fontFamily.regular,
  };

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={{ color: colors.text, fontSize: fontSize.lg, fontWeight: '600' }}>{spec.question}</Text>
      {multi ? <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>Pick all that apply.</Text> : null}

      {(spec.kind === 'choice' || multi) &&
        rows.map((value) => {
          const on = isOn(value);
          const label = value === OTHER ? 'Other...' : value;
          return (
            <Pressable
              key={value}
              accessibilityRole={multi ? 'checkbox' : 'radio'}
              accessibilityLabel={label}
              accessibilityState={{ checked: on, disabled: busy }}
              disabled={busy}
              onPress={() => toggle(value)}
              style={({ pressed }) => [
                styles.option,
                {
                  borderRadius: radius.md,
                  borderColor: on ? colors.primary : colors.border,
                  backgroundColor: on ? colors.surface : colors.inputBackground,
                  padding: spacing.md,
                  opacity: busy ? 0.5 : pressed ? 0.8 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.mark,
                  {
                    borderRadius: multi ? 4 : 10,
                    borderColor: on ? colors.primary : colors.mutedText,
                    backgroundColor: on ? colors.primary : 'transparent',
                  },
                ]}
              />
              <Text style={{ color: colors.text, fontSize: fontSize.md, flex: 1 }}>{label}</Text>
            </Pressable>
          );
        })}

      {(spec.kind === 'choice' || multi) && otherOn ? (
        <TextInput
          value={other}
          editable={!busy}
          onChangeText={setOther}
          onSubmitEditing={submit}
          placeholder="Your answer"
          placeholderTextColor={colors.mutedText}
          accessibilityLabel="Other answer"
          style={[styles.input, inputStyle, { paddingHorizontal: spacing.md, paddingVertical: spacing.md }]}
        />
      ) : null}

      {spec.kind === 'number' ? (
        <View style={{ gap: spacing.xs }}>
          <View style={styles.numberRow}>
            <TextInput
              value={number}
              editable={!busy}
              onChangeText={setNumber}
              onSubmitEditing={submit}
              keyboardType="numbers-and-punctuation"
              accessibilityLabel={spec.question}
              placeholder="0"
              placeholderTextColor={colors.mutedText}
              style={[styles.input, inputStyle, styles.numberInput, { paddingHorizontal: spacing.md, paddingVertical: spacing.md }]}
            />
            {spec.unit ? <Text style={{ color: colors.mutedText, fontSize: fontSize.md }}>{spec.unit}</Text> : null}
          </View>
          {spec.min != null || spec.max != null ? (
            <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>
              {spec.min != null && spec.max != null
                ? `Between ${spec.min} and ${spec.max}.`
                : spec.min != null
                  ? `At least ${spec.min}.`
                  : `At most ${spec.max}.`}
            </Text>
          ) : null}
        </View>
      ) : null}

      {spec.kind === 'text' ? (
        <TextInput
          value={text}
          editable={!busy}
          onChangeText={setText}
          multiline
          textAlignVertical="top"
          placeholder="Your answer"
          placeholderTextColor={colors.mutedText}
          accessibilityLabel={spec.question}
          style={[styles.input, inputStyle, styles.multiline, { paddingHorizontal: spacing.md, paddingVertical: spacing.md }]}
        />
      ) : null}

      {hasInput && problem ? <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>{problem}</Text> : null}

      <Button title="Send answer" onPress={submit} disabled={Boolean(problem) || busy} loading={busy} />
      <Button title="Skip" variant="secondary" onPress={onSkip} disabled={busy} />

      {spec.assumption ? (
        <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>
          If you skip, it will go ahead assuming: <Text style={{ color: colors.text }}>{spec.assumption}</Text>
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: StyleSheet.hairlineWidth, minHeight: 48 },
  mark: { width: 18, height: 18, borderWidth: 2 },
  input: { borderWidth: StyleSheet.hairlineWidth, minHeight: 48 },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  numberInput: { width: 160 },
  multiline: { minHeight: 96 },
});
