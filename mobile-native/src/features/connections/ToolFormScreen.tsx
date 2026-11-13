import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { ErrorText } from '../../components/ErrorText';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { success } from '../../lib/haptics';
import { radius, fontFamily, fontSize, pressedOpacity, spacing, typography, useTheme } from '../../theme';
import { useCredentialIndex } from './useCredentialIndex';
import { errorMessage } from '../settings/errors';
import { Chips } from '../settings/Chips';
import { PickerSheet, type PickerOption } from '../settings/Picker';
import { PickerRow } from '../settings/PickerRow';
import { ThemedSwitch } from '../settings/ThemedSwitch';
import {
  createApiConnection,
  createDataConnection,
  updateApiConnection,
  updateDataConnection,
} from './api';
import { connectionKeys, useApiConnections, useDataConnections } from './queries';
import type { ApiConnection, CustomToolKind, DataConnection } from './types';

const API_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
const AUTH_TYPES = [
  { value: 'none', label: 'None — public API' },
  { value: 'bearer', label: 'Bearer token' },
  { value: 'basic', label: 'Basic auth' },
  { value: 'header', label: 'API key in header' },
  { value: 'query', label: 'API key in query' },
] as const;
const DB_KINDS = [
  { value: 'postgres', label: 'postgres' },
  { value: 'mysql', label: 'mysql' },
  { value: 'bigquery', label: 'bigquery' },
  { value: 'sqlite', label: 'SQLite file in your workspace' },
] as const;

type AuthType = (typeof AUTH_TYPES)[number]['value'];
type DbKind = (typeof DB_KINDS)[number]['value'];

/**
 * Add or edit one of the user's own API or database connections. The same
 * fields, defaults and checks as the web's CustomTools dialog. A credential is
 * picked by reference: the value never travels.
 */
export function ToolFormScreen({ kind: initialKind, id }: { kind: CustomToolKind | null; id: number | null }) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const apis = useApiConnections();
  const datas = useDataConnections();
  const creds = useCredentialIndex();
  const editing = id !== null && initialKind !== null;

  const apiRow: ApiConnection | undefined = editing && initialKind === 'api' ? (apis.data ?? []).find((r) => r.id === id) : undefined;
  const dataRow: DataConnection | undefined = editing && initialKind === 'data' ? (datas.data ?? []).find((r) => r.id === id) : undefined;

  const [kind, setKind] = useState<CustomToolKind>(initialKind ?? 'api');
  // Credential references: "credential · field", stored as `slug.field`.
  const secretOptions: PickerOption<string>[] = useMemo(() => {
    const slugById = new Map(creds.types.map((t) => [t.id, t.slug] as const));
    const out: PickerOption<string>[] = [];
    for (const cred of creds.credentials) {
      const slug = slugById.get(cred.credential_type);
      if (!slug) continue;
      for (const field of cred.fields ?? []) {
        out.push({ value: `${slug}.${field.key}`, label: `${cred.name} · ${field.label}` });
      }
    }
    return out;
  }, [creds.types, creds.credentials]);

  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [authType, setAuthType] = useState<AuthType>('none');
  const [secretRef, setSecretRef] = useState('');
  const [headerName, setHeaderName] = useState('X-API-Key');
  const [paramName, setParamName] = useState('api_key');
  const [methods, setMethods] = useState<string[]>([]);
  const [specText, setSpecText] = useState('');
  const [dbKind, setDbKind] = useState<DbKind>('postgres');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [database, setDatabase] = useState('');
  const [username, setUsername] = useState('');
  const [dbSecretRef, setDbSecretRef] = useState('');
  const [vfsPath, setVfsPath] = useState('');
  const [allowWrite, setAllowWrite] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [picker, setPicker] = useState<{ title: string; options: PickerOption<string>[]; onPick: (v: string) => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Seed once the row is known; during render so the blank defaults never paint.
  if (editing && !loaded && (apiRow || dataRow)) {
    setLoaded(true);
    if (apiRow) {
      setName(apiRow.name);
      setBaseUrl(apiRow.base_url);
      setAuthType(apiRow.auth.type);
      setSecretRef(apiRow.auth.secret_ref ?? '');
      setHeaderName(apiRow.auth.header ?? 'X-API-Key');
      setParamName(apiRow.auth.param ?? 'api_key');
      setMethods(apiRow.allowed_methods ?? []);
      setSpecText(Object.keys(apiRow.openapi_spec ?? {}).length > 0 ? JSON.stringify(apiRow.openapi_spec, null, 2) : '');
      setAdvanced(
        (apiRow.allowed_methods ?? []).length > 0 ||
          Object.keys(apiRow.openapi_spec ?? {}).length > 0 ||
          apiRow.auth.type === 'header' ||
          apiRow.auth.type === 'query',
      );
    }
    if (dataRow) {
      setName(dataRow.name);
      setDbKind(dataRow.kind);
      setHost(dataRow.host);
      setPort(dataRow.port ? String(dataRow.port) : '');
      setDatabase(dataRow.database);
      setUsername(dataRow.username);
      setDbSecretRef(dataRow.secret_ref);
      setVfsPath(dataRow.vfs_path);
      setAllowWrite(dataRow.allow_write);
      setAdvanced(Boolean(dataRow.port));
    }
  }
  if (!editing && !loaded) setLoaded(true);

  if (editing && (apis.isPending || datas.isPending)) return <LoadingState text="Loading tool" />;
  if (editing && !apiRow && !dataRow) {
    return <ErrorState title="Not available" message="This tool is no longer in your list." />;
  }

  const secretLabel = (ref: string) => secretOptions.find((o) => o.value === ref)?.label ?? '';

  async function save() {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) return setError('Give the tool a name.');

    let body: Record<string, unknown>;
    if (kind === 'api') {
      const url = baseUrl.trim();
      if (!/^https?:\/\/.+/i.test(url)) return setError('Base URL must start with http(s)://.');
      let spec: Record<string, unknown> = {};
      if (specText.trim()) {
        try {
          spec = JSON.parse(specText) as Record<string, unknown>;
        } catch {
          return setError('OpenAPI spec is not valid JSON.');
        }
        if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
          return setError('OpenAPI spec must be a JSON object.');
        }
      }
      const auth: Record<string, unknown> = { type: authType };
      if (authType !== 'none') {
        if (!secretRef) return setError('Pick the credential this API uses.');
        auth.secret_ref = secretRef;
        if (authType === 'header') auth.header = headerName.trim() || 'X-API-Key';
        if (authType === 'query') auth.param = paramName.trim() || 'api_key';
      }
      body = { name: trimmedName, base_url: url, openapi_spec: spec, auth, allowed_methods: methods };
    } else {
      body = { name: trimmedName, kind: dbKind, allow_write: allowWrite };
      if (dbKind === 'sqlite') {
        if (!vfsPath.trim().startsWith('/')) return setError('SQLite needs a workspace path like /Chat/sales.db.');
        body.vfs_path = vfsPath.trim();
      } else {
        if (!host.trim()) return setError('A hostname is required.');
        body.host = host.trim();
        if (port.trim()) {
          const n = Number(port);
          if (!Number.isInteger(n) || n < 1 || n > 65535) return setError('Port must be between 1 and 65535.');
          body.port = n;
        }
        if (database.trim()) body.database = database.trim();
        if (username.trim()) body.username = username.trim();
        if (dbSecretRef) body.secret_ref = dbSecretRef;
      }
    }

    setSaving(true);
    try {
      if (kind === 'api') {
        if (apiRow) await updateApiConnection(apiRow.id, body);
        else await createApiConnection(body);
      } else if (dataRow) {
        await updateDataConnection(dataRow.id, body);
      } else {
        await createDataConnection(body);
      }
      success();
      void queryClient.invalidateQueries({ queryKey: connectionKeys.apiTools });
      void queryClient.invalidateQueries({ queryKey: connectionKeys.dataTools });
      router.back();
    } catch (err) {
      setError(errorMessage(err, 'Could not save this tool.'));
    } finally {
      setSaving(false);
    }
  }

  const label = (text: string) => (
    <Text style={{ color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.medium }}>{text}</Text>
  );

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: editing ? 'Edit tool' : 'New tool' }} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.xxl }}>
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          {editing ? 'Yours alone. Editing never affects anyone else.' : 'Yours alone. Credentials stay in your vault.'}
        </Text>

        {!editing ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {(['api', 'data'] as const).map((k) => {
              const on = kind === k;
              return (
                <Pressable
                  key={k}
                  accessibilityRole="radio"
                  accessibilityLabel={k === 'api' ? 'API' : 'Database'}
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    setKind(k);
                    setError(null);
                  }}
                  style={({ pressed }) => ({
                    flex: 1,
                    minHeight: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? colors.primary : colors.surface,
                    opacity: pressed ? pressedOpacity : 1,
                  })}
                >
                  <Text style={{ color: on ? colors.primaryText : colors.text, fontSize: fontSize.md, fontFamily: fontFamily.medium }}>
                    {k === 'api' ? 'API' : 'Database'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <Section>
          <View style={{ padding: spacing.lg, gap: spacing.lg }}>
            <TextField
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder={kind === 'api' ? 'Acme orders API' : 'Warehouse'}
            />

            {kind === 'api' ? (
              <>
                <TextField
                  label="Base URL"
                  value={baseUrl}
                  onChangeText={setBaseUrl}
                  placeholder="https://api.example.com"
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={[typography.caption, { color: colors.mutedText, marginTop: -spacing.sm }]}>
                  Internal hosts are refused. A tool can only reach the public internet your runs allow.
                </Text>
                <PickerRow
                  label="Authentication"
                  value={AUTH_TYPES.find((a) => a.value === authType)?.label ?? ''}
                  placeholder="None — public API"
                  onPress={() =>
                    setPicker({
                      title: 'Authentication',
                      options: AUTH_TYPES.map((a) => ({ value: a.value, label: a.label })),
                      onPick: (v) => setAuthType(v as AuthType),
                    })
                  }
                />
                {authType !== 'none' ? (
                  <>
                    <PickerRow
                      label="Credential"
                      value={secretLabel(secretRef)}
                      placeholder={secretOptions.length ? 'Choose…' : 'No credentials yet'}
                      onPress={() => setPicker({ title: 'Credential', options: secretOptions, onPick: setSecretRef })}
                    />
                    <Text style={[typography.caption, { color: colors.mutedText, marginTop: -spacing.sm }]}>
                      A reference travels, never the value. The model never sees it either.
                    </Text>
                  </>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Advanced"
                  accessibilityState={{ expanded: advanced }}
                  onPress={() => setAdvanced((v) => !v)}
                  style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}
                >
                  <Text style={{ color: colors.mutedText, fontSize: fontSize.md, fontFamily: fontFamily.medium }}>
                    {advanced ? '▾' : '▸'} Advanced (methods, header names, OpenAPI)
                  </Text>
                </Pressable>
                {advanced ? (
                  <View style={{ gap: spacing.lg }}>
                    {authType === 'header' ? (
                      <TextField label="Header name" value={headerName} onChangeText={setHeaderName} autoCapitalize="none" autoCorrect={false} />
                    ) : null}
                    {authType === 'query' ? (
                      <TextField label="Query parameter" value={paramName} onChangeText={setParamName} autoCapitalize="none" autoCorrect={false} />
                    ) : null}
                    <View style={{ gap: spacing.xs }}>
                      {label('Allowed methods')}
                      <Text style={[typography.caption, { color: colors.mutedText }]}>
                        Empty means read-only (GET, HEAD). Anything else pauses for a human.
                      </Text>
                      <Chips
                        label="Allowed methods"
                        options={API_METHODS.map((m) => ({ value: m as string, label: m }))}
                        selected={methods}
                        onToggle={(m) => setMethods((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))}
                      />
                    </View>
                    <TextField
                      label="OpenAPI spec (optional)"
                      value={specText}
                      onChangeText={setSpecText}
                      placeholder='{"paths": {"/orders": {"get": {"summary": "List orders"}}}}'
                      multiline
                      numberOfLines={3}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={{ minHeight: 72, textAlignVertical: 'top', fontFamily: fontFamily.mono }}
                    />
                    <Text style={[typography.caption, { color: colors.mutedText, marginTop: -spacing.sm }]}>
                      Paste the JSON. Only the operation index is read.
                    </Text>
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <PickerRow
                  label="Kind"
                  value={DB_KINDS.find((k) => k.value === dbKind)?.label ?? ''}
                  placeholder="postgres"
                  disabled={editing}
                  onPress={() =>
                    setPicker({
                      title: 'Kind',
                      options: DB_KINDS.map((k) => ({ value: k.value, label: k.label })),
                      onPick: (v) => setDbKind(v as DbKind),
                    })
                  }
                />
                {dbKind === 'sqlite' ? (
                  <TextField
                    label="Workspace path"
                    value={vfsPath}
                    onChangeText={setVfsPath}
                    placeholder="/Chat/sales.db"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                ) : (
                  <>
                    <TextField label="Host" value={host} onChangeText={setHost} placeholder="db.example.com" autoCapitalize="none" autoCorrect={false} />
                    <TextField label="Database (optional)" value={database} onChangeText={setDatabase} autoCapitalize="none" autoCorrect={false} />
                    <TextField label="Username (optional)" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} />
                    <PickerRow
                      label="Password (optional)"
                      value={secretLabel(dbSecretRef)}
                      placeholder="None"
                      onPress={() =>
                        setPicker({
                          title: 'Password',
                          options: [{ value: '', label: 'None' }, ...secretOptions],
                          onPick: setDbSecretRef,
                        })
                      }
                    />
                    <Text style={[typography.caption, { color: colors.mutedText, marginTop: -spacing.sm }]}>Stored as a vault reference.</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.medium }}>Allow writes</Text>
                        <Text style={[typography.caption, { color: colors.mutedText }]}>Offers execute_sql for this connection. Reads never need it.</Text>
                      </View>
                      <ThemedSwitch label="Allow writes" value={allowWrite} onChange={setAllowWrite} />
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Advanced"
                      accessibilityState={{ expanded: advanced }}
                      onPress={() => setAdvanced((v) => !v)}
                      style={{ minHeight: 44, justifyContent: 'center' }}
                    >
                      <Text style={{ color: colors.mutedText, fontSize: fontSize.md, fontFamily: fontFamily.medium }}>
                        {advanced ? '▾' : '▸'} Advanced (port)
                      </Text>
                    </Pressable>
                    {advanced ? (
                      <TextField label="Port (optional)" value={port} onChangeText={setPort} placeholder="5432" keyboardType="number-pad" />
                    ) : null}
                  </>
                )}
              </>
            )}
          </View>
        </Section>

        <ErrorText message={error} />

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button title="Cancel" variant="secondary" disabled={saving} onPress={() => router.back()} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title={editing ? 'Save' : 'Create tool'} loading={saving} onPress={() => void save()} />
          </View>
        </View>
      </ScrollView>

      <PickerSheet
        visible={picker !== null}
        title={picker?.title ?? ''}
        options={picker?.options ?? []}
        value={null}
        searchable={(picker?.options.length ?? 0) > 8}
        onPick={(value) => picker?.onPick(value)}
        onClose={() => setPicker(null)}
      />
    </Screen>
  );
}
