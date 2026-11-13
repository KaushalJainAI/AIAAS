import { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '../../components/Button';
import { confirm } from '../../components/confirm';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { success, warning } from '../../lib/haptics';
import { spacing, typography, useTheme } from '../../theme';
import { deleteCredential, listCredentials } from '../credentials/api';
import { credentialKeys } from '../credentials/queries';
import { errorMessage, sentenceOf } from '../settings/errors';
import { Notice, type NoticeTone } from '../settings/Notice';
import { ThemedSwitch } from '../settings/ThemedSwitch';
import { deleteMcpServer, mcpOAuthDisconnect } from './api';
import { ConnectorTile } from './ConnectorTile';
import { connectOAuth, connectGoogleAccount } from './oauthConnect';
import { connectionKeys, useMcpServers, useMcpServerTools, useMcpValidation, useSetMcpServerEnabled } from './queries';
import { ConnectionToolsError } from './errors';
import { isPlatformOff, statusIsWorking, statusOf, STATUS_LABEL } from './status';
import { useCredentialIndex } from './useCredentialIndex';
import type { MCPServer, MCPTool } from './types';

/** The web's humanizeToolName: `search_files` -> `Search files`. */
function humanizeToolName(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** Command line for a local server, or the URL for a remote one. */
export function connectionAddress(server: MCPServer): string {
  return server.type === 'stdio'
    ? [server.command, ...(server.args ?? [])].filter(Boolean).join(' ')
    : (server.url ?? '');
}

/**
 * One connection: its status, its switch, what it needs to sign in, a live
 * check of its credentials, and the tools it can offer. Custom servers can
 * also be edited and removed here.
 */
export function ConnectionDetailScreen({ id }: { id: number }) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const servers = useMcpServers();
  const server = (servers.data ?? []).find((s) => s.id === id);
  const creds = useCredentialIndex();
  const validation = useMcpValidation([id]);
  const setEnabled = useSetMcpServerEnabled();

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: NoticeTone } | null>(null);

  const status = server
    ? statusOf(server, { validation: validation.data?.[id], missingRequired: creds.missingTypes(server).length > 0 })
    : null;
  const isOn = server?.effective_enabled ?? false;
  const showTools = server !== undefined && isOn && status !== null && (status === 'always' || status === 'connected');
  const tools = useMcpServerTools(id, showTools);

  if (servers.isPending || creds.isPending) return <LoadingState text="Loading connection" />;
  if (servers.isError) {
    return <ErrorState message="Could not load this connection. Check your connection and try again." onRetry={() => void servers.refetch()} />;
  }
  if (!server || status === null) {
    return <EmptyState title="Not available" message="This connection is no longer in your list." />;
  }
  // Narrowed once, so the handlers below (function declarations) see a defined server.
  const srv: MCPServer = server;

  const platformOff = isPlatformOff(status);
  const required = creds.requiredTypes(server);

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: connectionKeys.servers });
    void queryClient.invalidateQueries({ queryKey: connectionKeys.validation([id]) });
    void queryClient.invalidateQueries({ queryKey: connectionKeys.tools(id) });
    void queryClient.invalidateQueries({ queryKey: credentialKeys.all });
  };

  function toggle(enabled: boolean) {
    setBusy(true);
    setEnabled.mutate(
      { id, enabled },
      {
        onSuccess: (updated) => {
          success();
          setNotice({ text: `${updated.label} turned ${updated.effective_enabled ? 'on' : 'off'}`, tone: 'success' });
        },
        onError: (err) => setNotice({ text: errorMessage(err, 'Could not change that. Please try again.'), tone: 'danger' }),
        onSettled: () => setBusy(false),
      },
    );
  }

  /** Browser sign-in, then the live check: "still not connected" is said plainly. */
  async function signIn() {
    setNotice(null);
    setBusy(true);
    try {
      const outcome = await connectOAuth(id);
      refreshAll();
      if (outcome.browser === 'cancelled') return;
      if (outcome.connected) {
        success();
        setNotice({ text: `${srv.label} connected`, tone: 'success' });
      } else {
        setNotice({
          text: `${srv.label} is still not connected. Finish signing in, then come back here and check again.`,
          tone: 'warning',
        });
      }
    } catch (err) {
      setNotice({ text: sentenceOf(err, 'Could not start sign-in. Please try again.'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  /**
   * A Google-backed account: the browser returns to the website, so the
   * credentials are read again and the answer is whether the type is now held.
   */
  async function signInAccount(typeId: number, label: string) {
    setNotice(null);
    setBusy(true);
    try {
      await connectGoogleAccount();
      const fresh = await queryClient.fetchQuery({ queryKey: credentialKeys.list, queryFn: listCredentials });
      refreshAll();
      if (fresh.some((c) => c.credential_type === typeId)) {
        success();
        setNotice({ text: `${label} connected`, tone: 'success' });
      } else {
        setNotice({ text: `${label} is still not connected. Finish signing in, then come back here and check again.`, tone: 'warning' });
      }
    } catch (err) {
      setNotice({ text: sentenceOf(err, 'Could not start sign-in. Please try again.'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    const ok = await confirm({
      title: `Disconnect ${srv.label}?`,
      message: 'The assistant will lose access until you sign in again.',
      destructiveLabel: 'Disconnect',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await mcpOAuthDisconnect(id);
      warning();
      refreshAll();
      setNotice({ text: `${srv.label} disconnected`, tone: 'success' });
    } catch (err) {
      setNotice({ text: errorMessage(err, 'Could not disconnect.'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  /** Remove the stored credentials a connection needs. Confirmed first, as on the web. */
  async function disconnectCredentials() {
    const held = required
      .map((t) => creds.credByTypeId.get(t.id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);
    if (held.length === 0) return;
    const ok = await confirm({
      title: `Disconnect ${srv.label}?`,
      message: 'The assistant will lose access to this connection until you add the account again.',
      destructiveLabel: 'Disconnect',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await Promise.all(held.map((c) => deleteCredential(c.id)));
      warning();
      refreshAll();
      setNotice({ text: 'Disconnected', tone: 'success' });
    } catch (err) {
      setNotice({ text: errorMessage(err, 'Could not disconnect. The credential may be in use by an agent.'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function removeServer() {
    const ok = await confirm({
      title: `Remove ${srv.label}?`,
      message: 'Your agents will immediately lose the tools this connection provides.',
      destructiveLabel: 'Remove',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteMcpServer(id);
      warning();
      void queryClient.invalidateQueries({ queryKey: connectionKeys.servers });
      void queryClient.invalidateQueries({ queryKey: ['connections', 'validation'] });
      router.back();
    } catch (err) {
      setNotice({ text: errorMessage(err, 'Could not remove that connection.'), tone: 'danger' });
      setBusy(false);
    }
  }

  async function checkNow() {
    setNotice(null);
    const result = await validation.refetch();
    const check = result.data?.[id];
    if (!check) return;
    setNotice(
      check.ok
        ? { text: 'Credentials check out. The assistant can use this connection.', tone: 'success' }
        : { text: check.errors.join(' ') || 'Credentials are missing or invalid.', tone: 'danger' },
    );
  }

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.xxl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <ConnectorTile iconSlug={srv.icon_slug} isSystem={srv.is_system} size={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={typography.heading} accessibilityRole="header">{srv.label}</Text>
            {srv.tagline ? <Text style={[typography.caption, { color: colors.mutedText }]}>{srv.tagline}</Text> : null}
            <Text style={[typography.caption, { color: statusIsWorking(status) ? colors.success : colors.mutedText }]}>
              {STATUS_LABEL[status]}
            </Text>
          </View>
        </View>

        {platformOff && srv.setup_notes ? (
          <Text style={[typography.body, { color: colors.mutedText }]}>{srv.setup_notes}</Text>
        ) : null}

        <Notice message={notice?.text} tone={notice?.tone} />

        <Section>
          <ListRow
            title={srv.effective_enabled ? 'On for you' : 'Off for you'}
            subtitle={platformOff ? 'Turned off for everyone by the platform' : 'Off hides its tools from your agents'}
            chevron={false}
            detail={
              <ThemedSwitch
                label={`${isOn ? 'Turn off' : 'Turn on'} ${srv.label}`}
                value={isOn}
                disabled={busy || platformOff}
                onChange={toggle}
              />
            }
          />
        </Section>

        {srv.supports_oauth ? (
          <Section title="Sign in">
            <ListRow
              title={srv.oauth_connected ? 'Signed in' : 'Not signed in'}
              subtitle={`Sign in to ${srv.label} in your browser`}
              chevron={false}
              detail={
                srv.oauth_connected ? (
                  <Button title="Disconnect" variant="secondary" disabled={busy} onPress={() => void signOut()} />
                ) : (
                  <Button title="Sign in" disabled={busy} loading={busy} onPress={() => void signIn()} />
                )}
            />
          </Section>
        ) : null}

        {required.length > 0 ? (
          <Section title="Accounts" footer="The assistant can only use this connection once every account below is added and works.">
            {required.map((type) => {
              const held = creds.credByTypeId.get(type.id);
              const oauth = type.auth_method === 'oauth2';
              return (
                <ListRow
                  key={type.id}
                  title={type.name}
                  subtitle={held ? `Added as “${held.name}”` : 'Not connected'}
                  chevron={false}
                  detail={
                    held ? (
                      <Button title="Disconnect" variant="secondary" disabled={busy} onPress={() => void disconnectCredentials()} />
                    ) : (
                      <Button
                        title="Connect"
                        disabled={busy}
                        loading={busy && oauth}
                        onPress={() => {
                          if (oauth) {
                            void signInAccount(type.id, srv.label);
                          } else {
                            router.push({ pathname: '/more/credentials/form', params: { type: type.slug } });
                          }
                        }}
                      />
                    )
                  }
                />
              );
            })}
          </Section>
        ) : null}

        <Section title="Check" footer="Confirms the saved details still work. A saved account can expire or be revoked.">
          <ListRow
            title="Check credentials"
            subtitle={validation.isFetching ? 'Checking…' : undefined}
            chevron={false}
            onPress={() => void checkNow()}
          />
        </Section>

        {showTools ? (
          <Section title="What it can do">
            <ToolsList tools={tools.data?.tools} loading={tools.isPending} error={tools.error} />
          </Section>
        ) : null}

        {srv.help_url ? (
          <Section>
            <ListRow
              title="Where do I find this?"
              chevron
              onPress={() => {
                void Linking.openURL(srv.help_url!).catch(() => undefined);
              }}
            />
          </Section>
        ) : null}

        {!srv.is_system ? (
          <Section title="Manage" footer={connectionAddress(server) || undefined}>
            <ListRow
              icon="create-outline"
              title="Edit"
              chevron
              onPress={() => router.push({ pathname: '/more/connections/server-form', params: { id: String(id) } })}
            />
            <ListRow icon="trash-outline" title="Remove" destructive chevron={false} onPress={() => void removeServer()} />
          </Section>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function ToolsList({ tools, loading, error }: { tools: MCPTool[] | undefined; loading: boolean; error: unknown }) {
  const { colors } = useTheme();
  if (loading) {
    return <ListRow title="Checking what this can do…" chevron={false} />;
  }
  if (error) {
    const reason = error instanceof ConnectionToolsError ? error : null;
    return (
      <View style={{ padding: spacing.lg, gap: spacing.xs }}>
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          {reason?.isCredentialProblem ? 'Connect an account to see what this can do.' : "Couldn't load what this connection can do."}
        </Text>
        {reason ? <Text style={[typography.caption, { color: colors.mutedText }]} selectable>{reason.message}</Text> : null}
      </View>
    );
  }
  if (!tools || tools.length === 0) {
    return <ListRow title="This connection didn't report any tools." chevron={false} />;
  }
  return (
    <>
      {tools.map((tool) => (
        <ListRow
          key={tool.name}
          title={humanizeToolName(tool.name)}
          subtitle={tool.description}
          chevron={false}
          icon="checkmark-circle-outline"
        />
      ))}
    </>
  );
}
