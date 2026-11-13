/** Tools: the grant switches, then which of their tools may be used and how each one asks. */
import { useState } from 'react';
import { Pressable, View } from 'react-native';


import { Text } from '../../../components/Text';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../../theme';
import { GRANT_ITEMS, TOOL_PERMISSION_COPY } from '../config';
import { parseDomainList, toggleToolPermission } from '../edits';
import type { AgentConfig, ToolPermissionMode } from '../types';
import { BuilderScreen, type Builder } from './BuilderScreen';
import { Field, MultiPickerSheet, Note, Panel, PickerRow, SwitchRow, TextBox } from '../ui';

export function GrantsScreen({ id }: { id: string }) {
  return <BuilderScreen id={id} title="Tools" render={(b, cfg) => <GrantsForm b={b} cfg={cfg} />} />;
}

export function GrantsForm({ b, cfg }: { b: Builder; cfg: AgentConfig }) {
  return (
    <>
      <Note>
        Built-in tools come with your workspace. Connections you add on the Connections screen show up under the
        Connections switch.
      </Note>
      <Panel>
        {GRANT_ITEMS.map((item) => (
          <SwitchRow
            key={item.key}
            label={item.label}
            hint={item.hint}
            value={cfg.tools[item.key]}
            onChange={(v) => b.set('tools', { ...cfg.tools, [item.key]: v })}
          />
        ))}
      </Panel>
      {cfg.tools.browser ? (
        <Panel>
          <Field
            label="Sites it may act on"
            hint={cfg.browserDomains.length ? `${cfg.browserDomains.length} site${cfg.browserDomains.length === 1 ? '' : 's'}` : 'read only'}
            error={b.errors.browserDomains}
          >
            <TextBox
              accessibilityLabel="Sites it may act on"
              value={cfg.browserDomains.join(', ')}
              onChangeText={(v) => b.set('browserDomains', parseDomainList(v))}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="e.g. portal.supplier.com, forms.example.org"
            />
          </Field>
          <Note>Empty means it can read any page but never click or type. Subdomains are included.</Note>
        </Panel>
      ) : null}
    </>
  );
}

export function ToolRulesScreen({ id }: { id: string }) {
  return (
    <BuilderScreen id={id} title="Tool rules" render={(b, cfg) => <ToolRulesForm b={b} cfg={cfg} />} />
  );
}

export function ToolRulesForm({ b, cfg }: { b: Builder; cfg: AgentConfig }) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  const granted = b.grantedTools;
  const rules = cfg.toolPermissions ?? {};

  if (granted.length === 0) {
    return <Note>Turn a tool group on under Tools first. Its tools are listed here.</Note>;
  }

  const setRule = (tool: string, mode: ToolPermissionMode) =>
    b.set('toolPermissions', toggleToolPermission(cfg.toolPermissions, tool, mode));

  return (
    <>
      <Panel>
        <PickerRow
          label="Which tools"
          value={cfg.toolScope.length ? `${cfg.toolScope.length} of ${granted.length}` : 'All of them'}
          error={b.errors.toolScope}
          onPress={() => setOpen(true)}
        />
        <Note>
          Leave it empty for everything the switches unlock. Naming a few keeps the agent’s toolbox small, which keeps
          it on task.
        </Note>
      </Panel>

      <Panel>
        <Text style={[typography.label, { color: colors.text }]}>Per-tool rules</Text>
        <Note>
          Untouched tools follow the switches and the Autonomy setting. Allow skips asking, Ask pauses even where it
          would not, Deny removes the tool. Tap the active rule again to clear it.
        </Note>
        {granted.map((tool) => {
          const mode = rules[tool.id];
          return (
            <View key={tool.id} style={{ gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
              <View>
                <Text style={[typography.label, { color: colors.text }]}>{tool.label}</Text>
                <Text numberOfLines={2} style={[typography.caption, { color: colors.mutedText }]}>{tool.hint}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {(['allow', 'ask', 'deny'] as ToolPermissionMode[]).map((m) => {
                  const on = mode === m;
                  return (
                    <Pressable
                      key={m}
                      accessibilityRole="button"
                      accessibilityLabel={`${TOOL_PERMISSION_COPY[m].label} ${tool.label}`}
                      accessibilityHint={TOOL_PERMISSION_COPY[m].hint}
                      accessibilityState={{ selected: on }}
                      onPress={() => setRule(tool.id, m)}
                      style={({ pressed }) => ({
                        minHeight: 44,
                        minWidth: 64,
                        paddingHorizontal: spacing.md,
                        justifyContent: 'center',
                        alignItems: 'center',
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor: on ? colors.primary : colors.border,
                        backgroundColor: on ? colors.primary : colors.surface,
                        opacity: pressed ? pressedOpacity : 1,
                      })}
                    >
                      <Text style={[typography.caption, { color: on ? colors.primaryText : colors.text }]}>
                        {TOOL_PERMISSION_COPY[m].label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </Panel>

      <MultiPickerSheet
        visible={open}
        title="Which tools"
        searchable={granted.length > 8}
        emptyText="Turn a tool group on first."
        options={granted.map((t) => ({ value: t.id, label: t.label, hint: t.hint }))}
        value={cfg.toolScope}
        onChange={(next) => b.set('toolScope', next)}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
