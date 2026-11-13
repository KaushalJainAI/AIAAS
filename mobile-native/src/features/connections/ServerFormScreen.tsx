import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Switch } from '../../components/Switch';
import { router, Stack } from 'expo-router';

import { Button } from '../../components/Button';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { ListRow } from '../../components/ListRow';
import { success } from '../../lib/haptics';
import { radius, fontFamily, fontSize, pressedOpacity, spacing, typography, useTheme } from '../../theme';
import { errorMessage } from '../settings/errors';
import { PickerSheet, type PickerOption } from '../settings/Picker';
import { PickerRow } from '../settings/PickerRow';
import { createMcpServer, updateMcpServer } from './api';
import { useCredentialIndex } from './useCredentialIndex';
import { connectionKeys, useMcpServers } from './queries';
import { useQueryClient } from '@tanstack/react-query';
import type { CreateMCPServerData, MCPServer, MCPServerType } from './types';

/** Model-provider credentials are the platform's own; they never belong to an MCP server. */
const LLM_PROVIDER_SLUGS = new Set([
  'openrouter', 'nvidia', 'openai', 'opencode', 'chatgpt',
  'anthropic', 'cohere', 'deepseek', 'gemini-api', 'groq',
  'huggingface', 'mistral', 'perplexity-api', 'xai',
]);

/** Token fields the injector reads even when a schema does not list them. */
const TOKEN_FIELDS = ['access_token', 'refresh_token'];

type EnvRow = { key: string; value: string };
type CredRow = { envVar: string; slug: string; field: string };
type HeaderRow = { header: string; template: string };

interface PickerState {
  title: string;
  options: PickerOption<string>[];
  searchable?: boolean;
  onPick: (value: string) => void;
}

/** Add or edit a custom MCP server. The same fields and validation as the web's MCPServerModal. */
export function ServerFormScreen({ id }: { id: number | null }) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const servers = useMcpServers();
  const existing: MCPServer | undefined = id ? (servers.data ?? []).find((s) => s.id === id) : undefined;
  const creds = useCredentialIndex();
  const isEdit = id !== null;

  const credTypes = useMemo(
    () => creds.types.filter((t) => !LLM_PROVIDER_SLUGS.has(t.slug)),
    [creds.types],
  );

  const fieldsFor = (slug: string): string[] => {
    const names = (creds.types.find((t) => t.slug === slug)?.fields_schema ?? []).map((f) => f.name);
    for (const token of TOKEN_FIELDS) if (!names.includes(token)) names.push(token);
    return names;
  };

  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<MCPServerType>('http');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [args, setArgs] = useState<string[]>(['']);
  const [env, setEnv] = useState<EnvRow[]>([{ key: '', value: '' }]);
  const [envDirty, setEnvDirty] = useState(false);
  const [credMap, setCredMap] = useState<CredRow[]>([{ envVar: '', slug: '', field: '' }]);
  const [headers, setHeaders] = useState<HeaderRow[]>([{ header: '', template: '' }]);
  const [required, setRequired] = useState<string[]>([]);
  const [setupNotes, setSetupNotes] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Seed the form once the record is known. Adjusted during render (not an
  // effect) so the form never paints the blank defaults first.
  if (isEdit && existing && !loaded) {
    setLoaded(true);
    setName(existing.name);
    setType(existing.type);
    setCommand(existing.command ?? '');
    setUrl(existing.url ?? '');
    setArgs(existing.args && existing.args.length > 0 ? [...existing.args] : ['']);
    setEnv([{ key: '', value: '' }]);
    setEnvDirty(false);
    setCredMap(
      Object.entries(existing.credential_env_map ?? {}).map(([envVar, mapping]) => {
        const at = String(mapping).indexOf(':');
        return at > 0
          ? { envVar, slug: String(mapping).slice(0, at), field: String(mapping).slice(at + 1) }
          : { envVar, slug: '', field: '' };
      }),
    );
    setHeaders(Object.entries(existing.credential_header_map ?? {}).map(([header, template]) => ({ header, template })));
    setRequired(existing.required_credential_types ?? []);
    setSetupNotes(existing.setup_notes ?? '');
    setEnabled(existing.enabled);
  }
  if (!isEdit && !loaded) setLoaded(true);

  if (isEdit && servers.isPending) return <LoadingState text="Loading connection" />;
  if (isEdit && !existing && !servers.isPending) {
    return <ErrorState title="Not available" message="This connection is no longer in your list." />;
  }

  const isRemote = type === 'http' || type === 'sse';

  /** Build the request body, or the first sentence that says what is missing. */
  function build(): { data?: CreateMCPServerData; error?: string } {
    if (!name.trim()) return { error: 'Name is required' };
    if (type === 'stdio' && !command.trim()) return { error: 'Command is required for stdio servers' };
    if (isRemote && !url.trim()) return { error: 'Endpoint URL is required for a remote server' };

    const argv = args.map((a) => a.trim()).filter(Boolean);
    const envMap: Record<string, string> = {};
    for (const row of env) {
      if (!row.key.trim()) {
        if (row.value.trim()) return { error: 'An environment variable is missing its name' };
        continue;
      }
      if (!row.value.trim()) return { error: `Environment variable "${row.key}" is missing its value` };
      envMap[row.key.trim()] = row.value.trim();
    }

    const credEnv: Record<string, string> = {};
    for (const row of credMap) {
      if (!row.envVar.trim() && !row.slug && !row.field) continue;
      if (!row.envVar.trim()) return { error: 'A credential link is missing its environment variable name' };
      if (!row.slug) return { error: `Credential link "${row.envVar}" is missing its credential` };
      if (!row.field) return { error: `Credential link "${row.envVar}" is missing its field` };
      credEnv[row.envVar.trim()] = `${row.slug}:${row.field}`;
    }

    const headerMap: Record<string, string> = {};
    for (const row of headers) {
      if (!row.header.trim() && !row.template.trim()) continue;
      if (!row.header.trim()) return { error: 'An auth header is missing its name' };
      if (!row.template.trim()) return { error: `Auth header "${row.header}" is missing its value` };
      headerMap[row.header.trim()] = row.template.trim();
    }

    return {
      data: {
        name: name.trim(),
        type,
        command: type === 'stdio' ? command.trim() : undefined,
        args: type === 'stdio' ? argv : undefined,
        url: isRemote ? url.trim() : undefined,
        // Saved env values are never returned, so an edit sends env only when the user changed it.
        ...(isEdit && !envDirty ? {} : { env: envMap }),
        required_credential_types: required,
        credential_env_map: type === 'stdio' ? credEnv : undefined,
        credential_header_map: isRemote ? headerMap : undefined,
        setup_notes: setupNotes.trim() || undefined,
        enabled,
      },
    };
  }

  async function save() {
    setError(null);
    const built = build();
    if (built.error || !built.data) {
      setError(built.error ?? 'Please check the form.');
      return;
    }
    setSaving(true);
    try {
      if (existing) await updateMcpServer(existing.id, built.data);
      else await createMcpServer(built.data);
      success();
      void queryClient.invalidateQueries({ queryKey: connectionKeys.servers });
      void queryClient.invalidateQueries({ queryKey: ['connections', 'validation'] });
      router.back();
    } catch (err) {
      setError(errorMessage(err, 'Failed to save MCP server'));
    } finally {
      setSaving(false);
    }
  }

  const credOptions: PickerOption<string>[] = credTypes.map((t) => ({ value: t.slug, label: t.name }));

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: isEdit ? 'Edit MCP Server' : 'Register MCP Server' }} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.xxl }}>
        <Text style={[typography.caption, { color: colors.mutedText }]}>Add a tool server your agents can call</Text>

        <Section>
          <View style={{ padding: spacing.lg, gap: spacing.lg }}>
            <TextField label="Server name" value={name} onChangeText={setName} placeholder="e.g. GitHub MCP" />

            <View style={{ gap: spacing.xs }}>
              <Text style={{ color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.medium }}>Connection type</Text>
              <Text style={[typography.caption, { color: colors.mutedText }]}>
                Run locally starts a program on the server (npx, python…). Remote endpoint talks to a hosted MCP server over HTTP.
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {(
                  [
                    { key: 'stdio', label: 'Run locally', icon: 'terminal-outline' },
                    { key: 'http', label: 'Remote endpoint', icon: 'globe-outline' },
                  ] as const
                ).map((choice) => {
                  const on = choice.key === 'stdio' ? type === 'stdio' : isRemote;
                  return (
                    <Pressable
                      key={choice.key}
                      accessibilityRole="radio"
                      accessibilityLabel={choice.label}
                      accessibilityState={{ selected: on }}
                      onPress={() => setType(choice.key === 'stdio' ? 'stdio' : isRemote ? type : 'http')}
                      style={({ pressed }) => ({
                        flex: 1,
                        minHeight: 44,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: spacing.sm,
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor: on ? colors.primary : colors.border,
                        backgroundColor: on ? colors.primaryBg : colors.surface,
                        opacity: pressed ? pressedOpacity : 1,
                      })}
                    >
                      <Icon name={choice.icon} size={16} color={on ? colors.primary : colors.mutedText} />
                      <Text style={{ color: on ? colors.primary : colors.text, fontSize: fontSize.md, fontFamily: fontFamily.medium }}>
                        {choice.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {type === 'stdio' ? (
              <>
                <TextField label="Command" value={command} onChangeText={setCommand} placeholder="e.g. npx" autoCapitalize="none" autoCorrect={false} />
                <View style={{ gap: spacing.sm }}>
                  <Text style={{ color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.medium }}>Arguments</Text>
                  {args.map((arg, i) => (
                    <RowRemove key={i} onRemove={() => setArgs((prev) => prev.filter((_, j) => j !== i))} disabled={args.length === 1} label="Remove argument">
                      <TextField
                        label={`Argument ${i + 1}`}
                        value={arg}
                        onChangeText={(text) => setArgs((prev) => prev.map((a, j) => (j === i ? text : a)))}
                        placeholder={i === 0 ? '-y' : '@modelcontextprotocol/server-filesystem'}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </RowRemove>
                  ))}
                  <TextLink title="+ Add argument" onPress={() => setArgs((prev) => [...prev, ''])} />
                </View>
              </>
            ) : (
              <TextField
                label="Endpoint URL"
                value={url}
                onChangeText={setUrl}
                placeholder="https://mcp.notion.com/mcp"
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}

            <View style={{ gap: spacing.sm }}>
              <Text style={{ color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.medium }}>Extra environment variables</Text>
              <Text style={[typography.caption, { color: colors.mutedText }]}>
                Plain key/value pairs passed to the program. Secrets should come from credentials below, not here.
              </Text>
              {env.map((row, i) => (
                <RowRemove
                  key={i}
                  label="Remove row"
                  onRemove={() => {
                    setEnv((prev) => prev.filter((_, j) => j !== i));
                    setEnvDirty(true);
                  }}
                >
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <TextField
                        label="Name"
                        value={row.key}
                        onChangeText={(text) => {
                          setEnv((prev) => prev.map((r, j) => (j === i ? { ...r, key: text } : r)));
                          setEnvDirty(true);
                        }}
                        placeholder="NAME"
                        autoCapitalize="characters"
                        autoCorrect={false}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <TextField
                        label="Value"
                        value={row.value}
                        onChangeText={(text) => {
                          setEnv((prev) => prev.map((r, j) => (j === i ? { ...r, value: text } : r)));
                          setEnvDirty(true);
                        }}
                        placeholder="value"
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>
                  </View>
                </RowRemove>
              ))}
              <TextLink title="+ Add variable" onPress={() => { setEnv((prev) => [...prev, { key: '', value: '' }]); setEnvDirty(true); }} />
              {isEdit && !envDirty ? (
                <Text style={[typography.caption, { color: colors.mutedText }]}>Saved values are hidden for security. Leave blank to keep them.</Text>
              ) : null}
            </View>
          </View>
        </Section>

        <Section title="Required credentials" footer="Credential types the assistant needs before this server's tools can be used. Pick one here, or add a credential link below and it is added for you.">
          {credTypes.length === 0 ? (
            <ListRow title="No credential types defined yet." chevron={false} />
          ) : (
            credTypes.map((t) => {
              const on = required.includes(t.slug);
              return (
                <ListRow
                  key={t.slug}
                  title={t.name}
                  subtitle={t.description || undefined}
                  chevron={false}
                  detail={<Icon name={on ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={on ? colors.primary : colors.mutedText} />}
                  onPress={() => setRequired((prev) => (prev.includes(t.slug) ? prev.filter((s) => s !== t.slug) : [...prev, t.slug]))}
                />
              );
            })
          )}
        </Section>

        {type === 'stdio' ? (
          <Section title="Link credentials to the program" footer="Each row hands one credential value to the program as an environment variable. Example: TOKEN → GitHub token → api_key.">
            <View style={{ padding: spacing.lg, gap: spacing.lg }}>
              {credMap.map((row, i) => (
                <RowRemove key={i} label="Remove row" onRemove={() => setCredMap((prev) => prev.filter((_, j) => j !== i))}>
                  <TextField
                    label="Environment variable"
                    value={row.envVar}
                    onChangeText={(text) => setCredMap((prev) => prev.map((r, j) => (j === i ? { ...r, envVar: text } : r)))}
                    placeholder="TOKEN"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <PickerRow
                    label="Credential"
                    value={credTypes.find((t) => t.slug === row.slug)?.name ?? ''}
                    placeholder="Credential…"
                    onPress={() =>
                      setPicker({
                        title: 'Credential',
                        options: credOptions,
                        onPick: (slug) => {
                          setCredMap((prev) => prev.map((r, j) => (j === i ? { ...r, slug, field: '' } : r)));
                          if (slug && !required.includes(slug)) setRequired((prev) => [...prev, slug]);
                        },
                      })
                    }
                  />
                  <PickerRow
                    label="Field"
                    value={row.field}
                    placeholder={row.slug ? 'Field…' : 'Choose a credential first'}
                    disabled={!row.slug}
                    onPress={() =>
                      setPicker({
                        title: 'Field',
                        options: fieldsFor(row.slug).map((f) => ({ value: f, label: f })),
                        onPick: (field) => setCredMap((prev) => prev.map((r, j) => (j === i ? { ...r, field } : r))),
                      })
                    }
                  />
                </RowRemove>
              ))}
              <TextLink title="+ Add credential link" onPress={() => setCredMap((prev) => [...prev, { envVar: '', slug: '', field: '' }])} />
            </View>
          </Section>
        ) : (
          <Section title="Auth headers" footer="HTTP headers sent with every request. Insert a credential token and it arrives as a {credential:field} placeholder, filled in at call time.">
            <View style={{ padding: spacing.lg, gap: spacing.lg }}>
              {headers.map((row, i) => (
                <RowRemove key={i} label="Remove header" onRemove={() => setHeaders((prev) => prev.filter((_, j) => j !== i))}>
                  <TextField
                    label="Header"
                    value={row.header}
                    onChangeText={(text) => setHeaders((prev) => prev.map((r, j) => (j === i ? { ...r, header: text } : r)))}
                    placeholder="Authorization"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TextField
                    label="Value"
                    value={row.template}
                    onChangeText={(text) => setHeaders((prev) => prev.map((r, j) => (j === i ? { ...r, template: text } : r)))}
                    placeholder="Bearer {github_token:api_key}"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TextLink
                    title="Insert a credential token"
                    onPress={() =>
                      setPicker({
                        title: 'Credential',
                        options: credOptions,
                        onPick: (slug) =>
                          setPicker({
                            title: 'Field',
                            options: fieldsFor(slug).map((f) => ({ value: f, label: f })),
                            onPick: (field) =>
                              setHeaders((prev) => prev.map((r, j) => (j === i ? { ...r, template: `${r.template}{${slug}:${field}}` } : r))),
                          }),
                      })
                    }
                  />
                </RowRemove>
              ))}
              <TextLink title="+ Add header" onPress={() => setHeaders((prev) => [...prev, { header: '', template: '' }])} />
            </View>
          </Section>
        )}

        <Section footer="Off hides its tools from your agents.">
          <ListRow
            title="Active for this user"
            chevron={false}
            detail={
              <Switch
                accessibilityLabel="Active for this user"
                accessibilityRole="switch"
                value={enabled}
                onValueChange={setEnabled}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.primaryText}
              />
            }
          />
        </Section>

        <Section title="Setup notes" footer="Shown on the Connections page about how this server is configured.">
          <View style={{ padding: spacing.lg }}>
            <TextField
              label="Notes"
              value={setupNotes}
              onChangeText={setSetupNotes}
              multiline
              numberOfLines={2}
              placeholder="How this server is set up"
              style={{ minHeight: 56, textAlignVertical: 'top' }}
            />
          </View>
        </Section>

        <ErrorText message={error} />

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button title="Cancel" variant="secondary" disabled={saving} onPress={() => router.back()} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title={isEdit ? 'Update Server' : 'Register Server'} loading={saving} onPress={() => void save()} />
          </View>
        </View>
      </ScrollView>

      <PickerSheet
        visible={picker !== null}
        title={picker?.title ?? ''}
        options={picker?.options ?? []}
        value={null}
        searchable={picker?.searchable}
        onPick={(value) => picker?.onPick(value)}
        onClose={() => setPicker(null)}
      />
    </Screen>
  );
}

/** A form row with a remove button beside its fields. */
function RowRemove({
  children,
  onRemove,
  disabled = false,
  label,
}: {
  children: React.ReactNode;
  onRemove: () => void;
  disabled?: boolean;
  label: string;
}) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
      <View style={{ flex: 1, gap: spacing.sm }}>{children}</View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onRemove}
        style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : pressed ? pressedOpacity : 1 })}
      >
        <Icon name="trash-outline" size={18} color={colors.mutedText} />
      </Pressable>
    </View>
  );
}

function TextLink({ title, onPress }: { title: string; onPress: () => void }) {
  const { colors, spacing } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingVertical: spacing.xs, opacity: pressed ? pressedOpacity : 1 })}
    >
      <Text style={{ color: colors.primary, fontSize: fontSize.md, fontFamily: fontFamily.medium }}>{title}</Text>
    </Pressable>
  );
}
