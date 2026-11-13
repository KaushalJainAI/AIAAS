import { useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';

import { Button } from '../../components/Button';
import { confirm } from '../../components/confirm';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { spacing, useTheme } from '../../theme';
import { useRefresh } from '../../hooks/useRefresh';
import { getApp } from '../apps/catalogue';
import { formatDate, locationOf } from './display';
import { fileIcon } from './icons';
import { FileActions, type FileTarget } from './FileActions';
import { errorMessage } from './helpers';
import { NoticeBar, useNotice } from './notice';
import { useOpenFile } from './open';
import { useClearRecents, useRecentFiles } from './queries';

/** Recently opened files, newest first. Mirrors the web's Recent location. */
export function RecentScreen() {
  const { colors } = useTheme();
  const recent = useRecentFiles({ limit: 100 });
  const clear = useClearRecents();
  const openFile = useOpenFile();
  const { notice, show, dismiss } = useNotice();
  const [target, setTarget] = useState<FileTarget | null>(null);
  const { refreshing, onRefresh } = useRefresh(recent.refetch);
  const rows = recent.data ?? [];

  const askClear = async () => {
    const ok = await confirm({
      title: 'Clear recent?',
      message: 'The list of recently opened files is cleared. Your files are not touched.',
      destructiveLabel: 'Clear',
    });
    if (!ok) return;
    try {
      await clear.mutateAsync();
      show('Recent list cleared');
    } catch (err) {
      show(errorMessage(err, 'Could not clear the list. Please try again.'), 'danger');
    }
  };

  let body: ReactNode;
  if (recent.isPending) body = <LoadingState text="Loading…" />;
  else if (recent.isError) body = <ErrorState message={errorMessage(recent.error, 'Could not load recent files.')} onRetry={() => void recent.refetch()} />;
  else if (rows.length === 0)
    body = (
      <EmptyState
        title="No files yet"
        message="Anything you upload, create, or ask an agent to make shows up here."
      />
    );
  else
    body = (
      <>
        <Section>
          {rows.map((row) => {
            const doc = row.document;
            const appTitle = row.app === 'preview' ? 'Preview' : (getApp(row.app)?.title ?? row.app);
            return (
              <ListRow
                key={doc.id}
                title={doc.filename}
                subtitle={`${appTitle} · ${locationOf(doc)} · ${formatDate(row.opened_at)}`}
                icon={fileIcon(doc)}
                chevron={false}
                onPress={() => {
                  if (openFile(doc) === 'none') setTarget({ kind: 'file', doc });
                }}
                onLongPress={() => setTarget({ kind: 'file', doc })}
              />
            );
          })}
        </Section>
        <View style={{ marginTop: spacing.lg }}>
          <Button title="Clear" variant="secondary" onPress={() => void askClear()} loading={clear.isPending} />
        </View>
      </>
    );

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'Recent' }} />
      <NoticeBar notice={notice} onDismiss={dismiss} />
      <ScrollView
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxl, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {body}
      </ScrollView>
      {target ? <FileActions target={target} onClose={() => setTarget(null)} notify={show} /> : null}
    </Screen>
  );
}
