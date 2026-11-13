import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '../../components/Button';
import { confirm } from '../../components/confirm';
import { ErrorState } from '../../components/ErrorState';
import { Icon } from '../../components/Icon';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { useRefresh } from '../../hooks/useRefresh';
import { success, warning } from '../../lib/haptics';
import { spacing, typography, useTheme } from '../../theme';
import { errorMessage } from '../settings/errors';
import { Notice } from '../settings/Notice';
import { CATEGORY_BLURBS, CATEGORY_LABELS, CATEGORY_ORDER } from './icons';
import { ChannelCard } from './ChannelCard';
import { ConnectionRow } from './ConnectionRow';
import { HeldToolsSection } from './HeldToolsSection';
import {
  useApiConnections,
  useDataConnections,
  useDeleteApiConnection,
  useDeleteDataConnection,
  useHeldTools,
  useInstallSharedTool,
  useMcpServers,
  useMcpValidation,
  useMessagingChannels,
  useSetMcpServerEnabled,
  useSharedTools,
} from './queries';
import { useCredentialIndex } from './useCredentialIndex';
import { statusOf } from './status';
import type { ApiConnection, CustomToolKind, DataConnection, MCPServer, SharedTool } from './types';

type OwnedTool = { kind: CustomToolKind; id: number; name: string; subtitle: string; authed: boolean };

/**
 * The Connections page: what the assistant can reach on the user's behalf.
 * Same sections, wording and order as the web page (pages/Connections.tsx).
 */
export function ConnectionsScreen() {
  const { colors, spacing: sp } = useTheme();
  const servers = useMcpServers();
  const list = useMemo(() => servers.data ?? [], [servers.data]);
  const validation = useMcpValidation(list.map((s) => s.id));
  const creds = useCredentialIndex();
  const held = useHeldTools();
  const apis = useApiConnections();
  const datas = useDataConnections();
  const shared = useSharedTools();
  const channels = useMessagingChannels();
  const setEnabled = useSetMcpServerEnabled();
  const install = useInstallSharedTool();
  const deleteApi = useDeleteApiConnection();
  const deleteData = useDeleteDataConnection();

  const [busyId, setBusyId] = useState<number | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [toolSheet, setToolSheet] = useState<OwnedTool | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null);

  const refetchAll = () =>
    Promise.all([
      servers.refetch(),
      validation.refetch(),
      creds.refetch(),
      held.refetch(),
      apis.refetch(),
      datas.refetch(),
      shared.refetch(),
      channels.refetch(),
    ]);
  const { refreshing, onRefresh } = useRefresh(refetchAll);

  const statusFor = (server: MCPServer) =>
    statusOf(server, {
      validation: validation.data?.[server.id],
      missingRequired: creds.missingTypes(server).length > 0,
    });

  const curated = list.filter((s) => s.is_system && s.category !== 'utilities');
  const custom = list.filter((s) => !s.is_system);

  const owned: OwnedTool[] = [
    ...(apis.data ?? []).map((row: ApiConnection) => ({
      kind: 'api' as const,
      id: row.id,
      name: row.name,
      subtitle: `${row.base_url} · ${row.auth.type === 'none' || !row.auth.secret_ref ? 'No auth' : 'Credential linked'}`,
      authed: row.auth.type !== 'none' && Boolean(row.auth.secret_ref),
    })),
    ...(datas.data ?? []).map((row: DataConnection) => ({
      kind: 'data' as const,
      id: row.id,
      name: row.name,
      subtitle: `${row.kind === 'sqlite' ? row.vfs_path : `${row.kind} · ${row.host || 'no host'}`} · ${row.secret_ref ? 'Credential linked' : 'No auth'}`,
      authed: Boolean(row.secret_ref),
    })),
  ];

  const setSwitch = (server: MCPServer, enabled: boolean) => {
    setBusyId(server.id);
    setEnabled.mutate(
      { id: server.id, enabled },
      {
        onSuccess: (updated) => setNotice({ text: `${updated.label} turned ${updated.effective_enabled ? 'on' : 'off'}`, tone: 'success' }),
        onError: (err) => setNotice({ text: errorMessage(err, 'Could not change that. Please try again.'), tone: 'danger' }),
        onSettled: () => setBusyId(null),
      },
    );
  };

  async function removeTool(tool: OwnedTool) {
    setToolSheet(null);
    const ok = await confirm({
      title: `Delete "${tool.name}"?`,
      message: 'Agents using this tool lose access to it.',
      destructiveLabel: 'Delete',
    });
    if (!ok) return;
    const mutation = tool.kind === 'api' ? deleteApi : deleteData;
    mutation.mutate(tool.id, {
      onSuccess: () => {
        warning();
        setNotice({ text: `"${tool.name}" deleted.`, tone: 'success' });
      },
      onError: (err) => setNotice({ text: errorMessage(err, 'Could not delete this tool.'), tone: 'danger' }),
    });
  }

  function installShared(tool: SharedTool) {
    install.mutate(tool.slug, {
      onSuccess: (res) => {
        success();
        const needs = res.credentials_needed.map((n) => `${n.slug}.${n.field}`).join(', ');
        setNotice({
          text: needs
            ? `Installed "${res.tool.name}". Link a credential to use it: ${needs} (Credentials page).`
            : `Installed "${res.tool.name}".`,
          tone: 'success',
        });
      },
      onError: (err) => setNotice({ text: errorMessage(err, 'Could not install this tool.'), tone: 'danger' }),
    });
  }

  if (servers.isPending) return <LoadingState text="Loading connections" />;
  if (servers.isError) {
    return (
      <ErrorState
        message="Could not load your connections. Check your connection and try again."
        onRetry={() => void servers.refetch()}
      />
    );
  }

  const connectedCount = curated.filter((s) => statusFor(s) === 'connected').length;

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={{ gap: sp.xl, paddingBottom: sp.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={{ gap: sp.xs }}>
          <Text style={typography.heading} accessibilityRole="header">Connections</Text>
          <Text style={[typography.body, { color: colors.mutedText }]}>
            What your assistant can reach on your behalf
            {connectedCount > 0 ? ` · ${connectedCount} connected` : ''}
          </Text>
        </View>

        <Notice message={notice?.text} tone={notice?.tone} />

        <HeldToolsSection groups={held.data ?? []} />

        {CATEGORY_ORDER.map((category) => {
          const rows = curated.filter((s) => s.category === category);
          if (rows.length === 0) return null;
          return (
            <Section key={category} title={CATEGORY_LABELS[category]} footer={CATEGORY_BLURBS[category]}>
              {rows.map((server) => (
                <ConnectionRow
                  key={server.id}
                  server={server}
                  status={statusFor(server)}
                  busy={busyId === server.id}
                  onPress={() => router.push(`/more/connections/${server.id}`)}
                  onToggle={(enabled) => setSwitch(server, enabled)}
                />
              ))}
            </Section>
          );
        })}

        {curated.length === 0 ? (
          <Section>
            <ListRow title="No connections available" subtitle="Ask an administrator to set up connections, or add your own below." chevron={false} />
          </Section>
        ) : null}

        <Section title="Messaging" footer="What your assistant can message on your behalf: draft, send, search and read, on every channel below.">
          {channels.isPending ? <ListRow title="Loading channels…" chevron={false} /> : null}
          {(channels.data ?? []).map((channel) => {
            const credType = creds.typeBySlug.get(channel.credential.slug) ?? null;
            return (
              <View key={channel.id} style={{ padding: spacing.md }}>
                <ChannelCard
                  channel={channel}
                  onAddKey={
                    credType
                      ? () => router.push({ pathname: '/more/credentials/form', params: { type: credType.slug } })
                      : null
                  }
                />
              </View>
            );
          })}
        </Section>

        <Section title="My tools" footer="Connections you created. Private to you.">
          {owned.map((tool) => (
            <Pressable
              key={`${tool.kind}-${tool.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${tool.name}, ${tool.subtitle}`}
              onPress={() => setToolSheet(tool)}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, opacity: pressed ? 0.7 : 1 })}
            >
              <Icon name={tool.kind === 'api' ? 'globe-outline' : 'server-outline'} size={20} color={colors.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={typography.bodyStrong} numberOfLines={1}>{tool.name}</Text>
                <Text style={[typography.caption, { color: colors.mutedText }]} numberOfLines={1}>{tool.subtitle}</Text>
              </View>
              <Icon name="ellipsis-horizontal" size={20} color={colors.mutedText} />
            </Pressable>
          ))}
          <ListRow
            icon="add-circle-outline"
            title="New tool"
            subtitle="Connect your API or database once. Your chats and agents call it from then on."
            onPress={() => router.push({ pathname: '/more/connections/tool-form', params: {} })}
          />
        </Section>

        <Section title="Shared by others" footer="Installing makes your own private copy. Credentials never come with it.">
          {(shared.data?.results ?? []).length === 0 ? (
            <ListRow title="Nothing shared yet" subtitle="Share one of your own tools above to be the first." chevron={false} />
          ) : null}
          {(shared.data?.results ?? []).map((tool) => (
            <ListRow
              key={tool.slug}
              icon={tool.tool_kind === 'api' ? 'globe-outline' : 'server-outline'}
              title={tool.name}
              subtitle={`${tool.tagline} · by ${tool.author} · ${tool.install_count} install${tool.install_count === 1 ? '' : 's'}`}
              chevron={false}
              detail={<Button title={install.isPending && install.variables === tool.slug ? 'Installing…' : 'Install'} variant="secondary" loading={install.isPending && install.variables === tool.slug} disabled={install.isPending} onPress={() => installShared(tool)} />}
            />
          ))}
        </Section>

        <Section>
          <ListRow
            icon="build-outline"
            title="Advanced"
            subtitle={`Add a custom server${custom.length > 0 ? ` · ${custom.length} added` : ''}`}
            chevron={false}
            detail={<Icon name={advancedOpen ? 'chevron-down' : 'chevron-forward'} size={18} color={colors.mutedText} />}
            onPress={() => setAdvancedOpen((open) => !open)}
          />
        </Section>

        {advancedOpen ? (
          <Section footer="Connect any compatible server to add its tools to your agents. Your keys are stored securely and used only when needed.">
            {custom.map((server) => (
              <ConnectionRow
                key={server.id}
                server={server}
                status={statusFor(server)}
                busy={busyId === server.id}
                onPress={() => router.push(`/more/connections/${server.id}`)}
                onToggle={(enabled) => setSwitch(server, enabled)}
              />
            ))}
            <ListRow
              icon="add-circle-outline"
              title="Add custom server"
              chevron
              onPress={() => router.push({ pathname: '/more/connections/server-form', params: {} })}
            />
          </Section>
        ) : null}

        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Manage saved accounts"
          onPress={() => router.push('/more/credentials')}
          style={{ paddingHorizontal: sp.xs }}
        >
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            Looking for a key? <Text style={{ color: colors.primary }}>Manage saved accounts</Text>.
          </Text>
        </Pressable>
      </ScrollView>

      <Sheet visible={toolSheet !== null} title={toolSheet?.name} onClose={() => setToolSheet(null)}>
        {toolSheet ? (
          <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
            <Section>
              <ListRow
                icon="create-outline"
                title="Edit"
                chevron={false}
                onPress={() => {
                  const tool = toolSheet;
                  setToolSheet(null);
                  router.push({ pathname: '/more/connections/tool-form', params: { kind: tool.kind, id: String(tool.id) } });
                }}
              />
              <ListRow
                icon="share-social-outline"
                title="Share"
                chevron={false}
                onPress={() => {
                  const tool = toolSheet;
                  setToolSheet(null);
                  router.push({ pathname: '/more/connections/share', params: { kind: tool.kind, id: String(tool.id), name: tool.name } });
                }}
              />
              <ListRow icon="trash-outline" title="Delete" destructive chevron={false} onPress={() => void removeTool(toolSheet)} />
            </Section>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
