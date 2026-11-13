import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { TextField } from '../../components/TextField';
import { spacing } from '../../theme';

/** Why a name cannot be used, or null when it can. */
export function nameProblem(name: string): string | null {
  if (name.length > 255) return 'Keep the name under 255 characters.';
  if (/[\\/]/.test(name)) return 'A name cannot contain / or \\.';
  return null;
}

interface Props {
  title: string;
  initial: string;
  submitLabel: string;
  busy?: boolean;
  /** A reason the server refused the name. */
  error?: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

/** A sheet that asks for one name: a new folder, a new file, a rename. Mount it only while open. */
export function NameSheet({ title, initial, submitLabel, busy = false, error, onSubmit, onClose }: Props) {
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();
  const problem = trimmed ? nameProblem(trimmed) : null;
  const canSubmit = trimmed.length > 0 && !problem && !busy;

  const submit = () => {
    if (canSubmit) onSubmit(trimmed);
  };

  return (
    <Sheet visible onClose={onClose} title={title}>
      <TextField
        label="Name"
        value={value}
        onChangeText={setValue}
        autoFocus
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={submit}
        error={problem ?? error ?? null}
      />
      <View style={{ marginTop: spacing.lg }}>
        <Button title={submitLabel} onPress={submit} disabled={!canSubmit} loading={busy} />
      </View>
    </Sheet>
  );
}
