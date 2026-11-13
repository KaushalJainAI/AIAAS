import { ScrollView } from 'react-native';

import type { IconName } from '../../components/Icon';
import { ListRow } from '../../components/ListRow';
import { Section } from '../../components/Section';
import { Sheet } from '../../components/Sheet';
import { tap } from '../../lib/haptics';
import { spacing } from '../../theme';

export interface SheetAction {
  key: string;
  label: string;
  icon: IconName;
  destructive?: boolean;
  /** Text at the right of the row, e.g. the sort that is in use. */
  detail?: string;
  /** Called after a light tap. The caller closes the sheet if it needs to. */
  onPress: () => void;
}

interface Props {
  title?: string;
  actions: SheetAction[];
  onClose: () => void;
}

/** A bottom sheet of choices, as one grouped list. Mount it only while it should be open. */
export function ActionSheet({ title, actions, onClose }: Props) {
  return (
    <Sheet visible onClose={onClose} title={title}>
      <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: spacing.sm }}>
        <Section>
          {actions.map((action) => (
            <ListRow
              key={action.key}
              title={action.label}
              icon={action.icon}
              detail={action.detail}
              destructive={action.destructive}
              chevron={false}
              onPress={() => {
                tap();
                action.onPress();
              }}
            />
          ))}
        </Section>
      </ScrollView>
    </Sheet>
  );
}
