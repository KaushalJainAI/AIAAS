import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { ActionSheet, type SheetAction } from '../files/ActionSheet';
import { Icon } from '../../components/Icon';
import { ListRow } from '../../components/ListRow';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { SearchBar } from '../../components/SearchBar';
import { Text } from '../../components/Text';
import { NameSheet } from '../files/NameSheet';
import { useOpenFile } from '../files/open';
import { errorMessage, handoff } from '../files/helpers';
import { fileIcon, ionIconFor } from '../files/icons';
import { newFileName } from '../files/newFiles';
import { webHref } from '../files/web';
import { flattenDocuments, useCreateDocument, useDocumentList, useRecentFiles } from '../files/queries';
import { formatDate } from '../files/display';
import { success } from '../../lib/haptics';
import { fontSize, pressedOpacity, radius, spacing, useTheme } from '../../theme';
import { acceptsDoc, defaultAppFor, getApp, searchApps, type AppMeta, type NewFileOption } from './catalogue';

/** Where the route apps open in this app (the web's routes map onto these). */
const ROUTE_SCREENS: Record<string, string> = {
  files: '/files',
  dashboards: '/more/dashboards',
  pages: '/more/pages',
  imagine: '/more/imagine',
};

type Creating = { app: AppMeta; opt: NewFileOption };

/** The productivity apps and the rest of the launcher. Mirrors `pages/Apps.tsx`. */
export function AppsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const openFile = useOpenFile();
  const create = useCreateDocument(null);
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState<AppMeta | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const apps = useMemo(() => searchApps(query), [query]);
  const workspace = apps.filter((a) => a.kind === 'workspace');
  const more = apps.filter((a) => a.kind === 'route');

  const files = useDocumentList({ scope: 'personal', limit: 100 });
  const docs = flattenDocuments(files.data?.pages);
  const capped = files.hasNextPage;
  const recents = useRecentFiles({ limit: 8 });
  const openedRows = (recents.data ?? []).filter((r) => defaultAppFor(r.document));

  const countFor = (app: AppMeta) => docs.filter((d) => acceptsDoc(app, d)).length;

  const launch = (app: AppMeta) => {
    if (app.kind === 'route') {
      const screen = ROUTE_SCREENS[app.id];
      if (screen) router.navigate(screen);
      return;
    }
    router.push(webHref(app.path, app.title));
  };

  const chooseKind = (app: AppMeta, opt: NewFileOption) => {
    setPicking(null);
    handoff(() => setCreating({ app, opt }));
  };

  const submitCreate = async (name: string) => {
    if (!creating) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const doc = await create.mutateAsync({
        name: newFileName(name, creating.opt.ext),
        content: creating.opt.content,
      });
      success();
      const app = creating.app;
      setCreating(null);
      openFile(doc, app);
    } catch (err) {
      setCreateError(errorMessage(err, 'Could not create the file. Please try again.'));
    } finally {
      setCreateBusy(false);
    }
  };

  const pickActions = (app: AppMeta): SheetAction[] =>
    (app.newFiles ?? []).map((opt) => ({
      key: opt.ext,
      label: opt.label,
      icon: fileIcon({ filename: `x.${opt.ext}`, file_type: opt.ext }),
      onPress: () => chooseKind(app, opt),
    }));

  const tile = (app: AppMeta) => {
    const n = countFor(app);
    const meta =
      app.kind === 'workspace'
        ? n
          ? `${n}${capped ? '+' : ''} ${n === 1 ? 'file' : 'files'}`
          : 'No files yet'
        : app.description;
    return (
      <View key={app.id} style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${app.title}`}
          onPress={() => launch(app)}
          style={({ pressed }) => [styles.tileMain, { opacity: pressed ? pressedOpacity : 1 }]}
        >
          <View style={[styles.iconWrap, { backgroundColor: colors.primaryBg }]}>
            <Icon name={ionIconFor(app.icon)} size={20} color={colors.primary} />
          </View>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: fontSize.md, fontWeight: '600' }}>
            {app.title}
          </Text>
          <Text numberOfLines={2} style={{ color: colors.mutedText, fontSize: fontSize.sm }}>
            {app.kind === 'workspace' ? app.description : meta}
          </Text>
          {app.kind === 'workspace' ? (
            <Text style={{ color: colors.mutedText, fontSize: fontSize.sm, marginTop: 'auto' }}>{meta}</Text>
          ) : null}
        </Pressable>
        {app.kind === 'workspace' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`New ${app.title} file`}
            hitSlop={6}
            onPress={() => setPicking(app)}
            style={styles.plus}
          >
            <Icon name="add" size={20} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
    );
  };

  let launcher: ReactNode;
  if (apps.length === 0) {
    launcher = <Text style={{ color: colors.mutedText, fontSize: fontSize.md, textAlign: 'center', marginTop: spacing.xl }}>No apps match that search.</Text>;
  } else {
    launcher = (
      <>
        {workspace.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <Text accessibilityRole="header" style={{ color: colors.text, fontSize: fontSize.md, fontWeight: '600' }}>Productivity</Text>
            <View style={styles.grid}>{workspace.map(tile)}</View>
          </View>
        ) : null}
        {more.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <Text accessibilityRole="header" style={{ color: colors.text, fontSize: fontSize.md, fontWeight: '600' }}>More</Text>
            <View style={styles.grid}>{more.map(tile)}</View>
          </View>
        ) : null}
      </>
    );
  }

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'Apps' }} />
      <Text style={{ color: colors.mutedText, fontSize: fontSize.md, marginBottom: spacing.md }}>
        Productivity apps that open your files — everything runs in your browser
      </Text>
      <SearchBar value={query} onChangeText={setQuery} placeholder="Search apps…" />
      <ScrollView
        style={{ marginTop: spacing.md }}
        contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={files.isRefetching || recents.isRefetching}
            onRefresh={() => {
              void files.refetch();
              void recents.refetch();
            }}
            tintColor={colors.primary}
          />
        }
      >
        {!query && openedRows.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <Text accessibilityRole="header" style={{ color: colors.text, fontSize: fontSize.md, fontWeight: '600' }}>Jump back in</Text>
            <Section>
              {openedRows.map((row) => {
                const app = getApp(row.app) ?? defaultAppFor(row.document);
                return (
                  <ListRow
                    key={row.document.id}
                    title={row.document.filename}
                    subtitle={`${app?.title ?? 'App'} · opened ${formatDate(row.opened_at)}`}
                    icon={fileIcon(row.document)}
                    chevron={false}
                    onPress={() => {
                      if (app) openFile(row.document, app);
                    }}
                  />
                );
              })}
            </Section>
          </View>
        ) : null}

        {launcher}
      </ScrollView>

      {picking ? (
        <ActionSheet title={`New ${picking.title} file`} actions={pickActions(picking)} onClose={() => setPicking(null)} />
      ) : null}

      {creating ? (
        <NameSheet
          title={`New ${creating.opt.label.toLowerCase()}`}
          initial={`Untitled.${creating.opt.ext}`}
          submitLabel="Create"
          busy={createBusy}
          error={createError}
          onSubmit={(name) => void submitCreate(name)}
          onClose={() => {
            setCreating(null);
            setCreateError(null);
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { width: '48%', borderWidth: StyleSheet.hairlineWidth, minHeight: 124 },
  tileMain: { flex: 1, padding: spacing.md, gap: spacing.xs },
  iconWrap: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  plus: { position: 'absolute', top: 4, right: 4, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
