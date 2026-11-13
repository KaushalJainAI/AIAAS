import { Pressable, StyleSheet } from 'react-native';

import { Icon } from '../../components/Icon';
import { ListRow } from '../../components/ListRow';
import { spacing, useTheme } from '../../theme';
import { formatDate, formatSize } from './display';
import { FOLDER_ICON, fileIcon } from './icons';
import { plural } from './helpers';
import { entryName, type Entry } from './sort';

/** The line under a name, when the row has no better one. */
export function defaultSubtitle(entry: Entry): string {
  if (entry.kind === 'folder') {
    return `${plural(entry.folder.document_count, 'file')} · ${plural(entry.folder.child_count, 'folder')}`;
  }
  const doc = entry.doc;
  const processing = doc.status === 'pending' || doc.status === 'processing' ? 'Processing' : '';
  return [processing, formatSize(doc.file_size), formatDate(doc.updated_at)].filter(Boolean).join(' · ');
}

interface Props {
  entry: Entry;
  /** Replaces the default line, e.g. a search snippet or a location. */
  subtitle?: string;
  onOpen: () => void;
  onMore: () => void;
}

/** One file or folder in a list. Tapping opens it; the dots (or a long press) open its actions. */
export function EntryRow({ entry, subtitle, onOpen, onMore }: Props) {
  const { colors } = useTheme();
  const title = entryName(entry);
  const icon = entry.kind === 'folder' ? FOLDER_ICON : fileIcon(entry.doc);
  return (
    <ListRow
      title={title}
      subtitle={subtitle ?? defaultSubtitle(entry)}
      icon={icon}
      chevron={false}
      onPress={onOpen}
      onLongPress={onMore}
      detail={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`More actions for ${title}`}
          onPress={onMore}
          hitSlop={6}
          style={styles.more}
        >
          <Icon name="ellipsis-horizontal" size={20} color={colors.mutedText} />
        </Pressable>
      }
    />
  );
}

const styles = StyleSheet.create({
  more: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -spacing.sm },
});
