import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Icon } from '../../components/Icon';
import { ListRow } from '../../components/ListRow';
import { SearchBar } from '../../components/SearchBar';
import { Sheet } from '../../components/Sheet';
import { Section } from '../../components/Section';
import { spacing, useTheme } from '../../theme';

export interface PickerOption<T extends string> {
  value: T;
  label: string;
  /** A second line under the label: what the choice means. */
  detail?: string;
}

interface Props<T extends string> {
  visible: boolean;
  title: string;
  options: PickerOption<T>[];
  /** The current choice, marked with a tick. Null marks nothing. */
  value: T | null;
  onPick: (value: T) => void;
  onClose: () => void;
  /** Long lists (models, credential fields) filter as the user types. */
  searchable?: boolean;
}

/**
 * A single choice in a bottom sheet. Picking a row answers and closes the
 * sheet. Used everywhere the web uses a dropdown, so every picker behaves alike.
 */
export function PickerSheet<T extends string>({ visible, title, options, value, onPick, onClose, searchable = false }: Props<T>) {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const shown = useMemo(
    () => (needle ? options.filter((o) => `${o.label} ${o.detail ?? ''}`.toLowerCase().includes(needle)) : options),
    [options, needle],
  );

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
        {searchable ? <SearchBar value={search} onChangeText={setSearch} placeholder="Search" /> : null}
        <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
          <Section>
            {shown.map((option) => {
              const selected = option.value === value;
              return (
                <ListRow
                  key={option.value}
                  title={option.label}
                  subtitle={option.detail}
                  chevron={false}
                  detail={selected ? <Icon name="checkmark" size={20} color={colors.primary} /> : undefined}
                  onPress={() => {
                    // Close first, then answer: an answer may open the next sheet in a chain.
                    onClose();
                    onPick(option.value);
                  }}
                />
              );
            })}
          </Section>
        </ScrollView>
      </View>
    </Sheet>
  );
}
