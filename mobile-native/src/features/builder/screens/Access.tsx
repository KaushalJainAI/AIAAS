/**
 * What the agent may reach: connections (with a mode per connection), knowledge
 * bases and skills, the agents it may hand work to, and which of your files it
 * can see. Each list is read from the screen that owns it, read-only here.
 */
import { useState } from 'react';

import { useMcpServerTools, useMcpServers } from '../../connections/queries';
import { useKnowledgeBases } from '../../knowledge/queries';
import { useSkills } from '../../skills/queries';
import { useOrgs } from '../../account/queries';
import { messageOf } from '../../agents/format';
import { Text } from '../../../components/Text';
import { typography, useTheme } from '../../../theme';
import { CONNECTOR_MODE_COPY, FILE_ACCESS_COPY, FILE_ACCESS_LEVELS } from '../config';
import { connectorId, connectorMode, delegationBlocker, reconcileConnectors, setConnectorMode, setConnectorTools } from '../edits';
import { useAgentList } from '../queries';
import type { AgentConfig, ConnectorMode, FileAccess } from '../types';
import { BuilderScreen, type Builder } from './BuilderScreen';
import { ChoiceList, Chips, Field, MultiPickerSheet, Note, Notice, Panel, PickerRow, PickerSheet } from '../ui';

/* ---------- connections ---------- */

export function ConnectionsScreen({ id }: { id: string }) {
  return <BuilderScreen id={id} title="Connections" render={(b, cfg) => <ConnectionsForm b={b} cfg={cfg} />} />;
}

export function ConnectionsForm({ b, cfg }: { b: Builder; cfg: AgentConfig }) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  const servers = useMcpServers();
  const usable = (servers.data ?? [])
    .filter((s) => s.effective_enabled && s.category !== 'utilities')
    .map((s) => ({ id: s.id, label: s.label }))
    .sort((x, y) => x.label.localeCompare(y.label));
  const labelFor = (id: number) => usable.find((u) => u.id === id)?.label ?? `Connection ${id}`;

  return (
    <>
      <Panel>
        <PickerRow
          label="Connections"
          value={cfg.connectors.length ? `${cfg.connectors.length} selected` : 'Every connection'}
          error={b.errors.connectors}
          onPress={() => setOpen(true)}
        />
        <Note>Every connection, narrowed to what this agent needs. Add one on the Connections page first.</Note>
        {servers.isError ? <Notice text={messageOf(servers.error, 'Could not load your connections.')} /> : null}
      </Panel>

      {cfg.connectors.map((choice) => {
        const id = connectorId(choice);
        return (
          <Panel key={id}>
            <Text style={[typography.label, { color: colors.text }]}>{labelFor(id)}</Text>
            <Field label="What it may use">
              <Chips<ConnectorMode>
                options={(['all', 'read', 'selected'] as ConnectorMode[]).map((m) => ({
                  value: m,
                  label: CONNECTOR_MODE_COPY[m].label,
                  hint: CONNECTOR_MODE_COPY[m].hint,
                }))}
                value={connectorMode(choice)}
                onChange={(m) => {
                  if (m) b.set('connectors', setConnectorMode(cfg.connectors, id, m));
                }}
              />
            </Field>
            {connectorMode(choice) === 'selected' ? (
              <ConnectionToolsPicker
                serverId={id}
                value={typeof choice === 'number' ? [] : choice.tools}
                onChange={(tools) => b.set('connectors', setConnectorTools(cfg.connectors, id, tools))}
              />
            ) : null}
          </Panel>
        );
      })}
      {cfg.connectors.length > 0 ? (
        <Note>
          {CONNECTOR_MODE_COPY.read.hint} {CONNECTOR_MODE_COPY.selected.hint}
        </Note>
      ) : null}

      <MultiPickerSheet
        visible={open}
        title="Connections"
        searchable={usable.length > 8}
        emptyText="None yet. Add one on the Connections page first."
        options={usable.map((u) => ({ value: String(u.id), label: u.label }))}
        value={cfg.connectors.map((c) => String(connectorId(c)))}
        onChange={(ids) => b.set('connectors', reconcileConnectors(cfg.connectors, ids))}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/** The named tools of one connection, for a `selected` mode. */
function ConnectionToolsPicker({ serverId, value, onChange }: {
  serverId: number;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const tools = useMcpServerTools(serverId, true);
  const options = (tools.data?.tools ?? []).map((t) => ({ value: t.name, label: t.name, hint: t.description }));
  return (
    <>
      <PickerRow
        label="Tools"
        value={value.length ? `${value.length} chosen` : 'None chosen'}
        onPress={() => setOpen(true)}
        hint={tools.isError ? 'could not read' : undefined}
      />
      {tools.isError ? (
        <Note tone="danger">{messageOf(tools.error, 'Could not read the tools this connection offers.')}</Note>
      ) : null}
      <MultiPickerSheet
        visible={open}
        title="Tools"
        searchable={options.length > 8}
        emptyText={tools.isPending ? 'Reading the tools…' : 'This connection offers no tools right now.'}
        options={options}
        value={value}
        onChange={onChange}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/* ---------- knowledge and skills ---------- */

export function KnowledgeScreen({ id }: { id: string }) {
  return <BuilderScreen id={id} title="Knowledge and skills" render={(b, cfg) => <KnowledgeForm b={b} cfg={cfg} />} />;
}

export function KnowledgeForm({ b, cfg }: { b: Builder; cfg: AgentConfig }) {
  const [open, setOpen] = useState<'kb' | 'skills' | 'org' | null>(null);
  const bases = useKnowledgeBases().data?.knowledge_bases ?? [];
  const skills = useSkills().data ?? [];
  const orgs = useOrgs().data?.orgs ?? [];
  const orgName = cfg.orgId == null ? 'Personal (no team)' : orgs.find((o) => o.id === cfg.orgId)?.name ?? `Organisation ${cfg.orgId}`;

  return (
    <>
      <Panel>
        <PickerRow
          label="Knowledge bases"
          value={cfg.knowledgeBases.length ? `${cfg.knowledgeBases.length} selected` : 'None'}
          error={b.errors.knowledgeBases}
          onPress={() => setOpen('kb')}
        />
        <PickerRow
          label="Skills"
          value={cfg.skills.length ? `${cfg.skills.length} selected` : 'No skills'}
          error={b.errors.skills}
          onPress={() => setOpen('skills')}
        />
      </Panel>
      <Panel>
        <PickerRow
          label="Team knowledge from"
          value={orgName}
          error={b.errors.orgId}
          onPress={() => setOpen('org')}
        />
        <Note>
          Lets scheduled runs find your team’s solutions. It does not open team knowledge bases to them.
          {orgs.length === 0 ? ' You are not in an organisation yet. Join one in Settings first.' : ''}
        </Note>
      </Panel>

      <MultiPickerSheet
        visible={open === 'kb'}
        title="Knowledge bases"
        searchable={bases.length > 8}
        emptyText="No knowledge bases yet. Make one on the Knowledge page."
        options={bases.map((kb) => ({
          value: String(kb.id),
          label: kb.name,
          hint: kb.is_mine ? `${kb.backend} · ${kb.doc_count} documents` : `Shared by ${kb.owner_name}`,
        }))}
        value={cfg.knowledgeBases.map(String)}
        onChange={(ids) => b.set('knowledgeBases', ids.map(Number))}
        onClose={() => setOpen(null)}
      />
      <MultiPickerSheet
        visible={open === 'skills'}
        title="Skills"
        searchable={skills.length > 8}
        emptyText="None yet. Write one on the Skills page first."
        options={skills.map((s) => ({ value: String(s.id), label: s.title, hint: s.description || s.category }))}
        value={cfg.skills.map(String)}
        onChange={(ids) => b.set('skills', ids.map(Number))}
        onClose={() => setOpen(null)}
      />
      <PickerSheet
        visible={open === 'org'}
        title="Team knowledge from"
        value={cfg.orgId == null ? '' : String(cfg.orgId)}
        options={[
          { value: '', label: 'Personal (no team)' },
          ...orgs.map((o) => ({ value: String(o.id), label: o.name })),
        ]}
        onClose={() => setOpen(null)}
        onSelect={(v) => b.set('orgId', v === '' ? null : Number(v))}
      />
    </>
  );
}

/* ---------- delegation ---------- */

export function DelegationScreen({ id }: { id: string }) {
  return <BuilderScreen id={id} title="Delegation" render={(b, cfg) => <DelegationForm b={b} cfg={cfg} />} />;
}

export function DelegationForm({ b, cfg }: { b: Builder; cfg: AgentConfig }) {
  const [open, setOpen] = useState(false);
  const agents = useAgentList();
  const others = (agents.data ?? []).filter((a) => a.id !== b.agentId);
  return (
    <>
      {!cfg.tools.subAgents ? (
        <Notice text="Delegate to other agents is switched off under Tools, so this list is not used yet." tone="warning" />
      ) : null}
      <Panel>
        <PickerRow
          label="Delegates to"
          value={cfg.delegatesTo.length ? `${cfg.delegatesTo.length} selected` : 'Any of your agents'}
          error={b.errors.delegatesTo}
          onPress={() => setOpen(true)}
        />
        <Note>
          An agent that can delegate to an agent with wider tools has those tools by proxy. Naming a few is the
          narrower statement.
        </Note>
      </Panel>
      <MultiPickerSheet
        visible={open}
        title="Delegates to"
        searchable={others.length > 8}
        emptyText="No other agents yet."
        options={others.map((a) => ({
          value: String(a.id),
          label: a.name,
          // A delegated run is unattended, so a paused agent or one not cleared to run alone is refused.
          hint: delegationBlocker(a) ?? a.description,
        }))}
        value={cfg.delegatesTo.map(String)}
        onChange={(ids) => b.set('delegatesTo', ids.map(Number))}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/* ---------- file access ---------- */

export function FilesScreen({ id }: { id: string }) {
  return <BuilderScreen id={id} title="File access" render={(b, cfg) => <FilesForm b={b} cfg={cfg} />} />;
}

export function FilesForm({ b, cfg }: { b: Builder; cfg: AgentConfig }) {
  return (
    <Panel>
      <Field label="Which of your files it can reach" error={b.errors.fileAccess}>
        <ChoiceList<FileAccess>
          value={cfg.fileAccess}
          onChange={(v) => b.set('fileAccess', v)}
          options={FILE_ACCESS_LEVELS.map((v) => ({ value: v, label: FILE_ACCESS_COPY[v].label, hint: FILE_ACCESS_COPY[v].hint }))}
        />
      </Field>
      <Note>
        Needs the Read and write files switch under Tools. Anything it writes appears in your own files, and anything
        it deletes goes to your recycle bin.
      </Note>
    </Panel>
  );
}
