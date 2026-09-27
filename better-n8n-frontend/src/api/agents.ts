/**
 * Agents API.
 *
 * The wire shape *is* `AgentConfig` — the backend speaks the same camelCase the
 * knob board does, so there is no mapping layer here to drift out of sync. The
 * only additions are the read-only fields the server computes: the id and the
 * observed run statistics.
 */
import apiClient from './client';
import { asArray } from './unwrap';
import type { AgentConfig } from '../types/agentConfig';

/** An agent as the server returns it: the config, plus what actually happened. */
export interface Agent extends AgentConfig {
  id: number;
  /** Counted from the execution log, not stored — see orchestrator/agents.py. */
  runs: number;
  /** Runs that raised no approval request, i.e. nobody had to be involved. */
  unattended: number;
  /** Credits spent across those runs. */
  spend: number;
  /**
   * Which catalogue entry this was installed from, if any — `null` for an
   * agent built by hand. Read-only and observed, never configured: installing
   * writes it and nothing edits it afterwards. What the Explore page joins on
   * to show "installed" and to offer uninstall.
   */
  template_slug?: string | null;
  /** `retired` when the configured model's catalogue row is inactive. */
  model_status?: 'ok' | 'retired';
  created_at: string;
  updated_at: string;
}

/** What starting a run returns now: an id to watch, not an answer. */
export interface AgentRunStarted {
  execution_id: string;
  status: string;
  unserved_grants: string[];
}

/** One knob the configuring model wants moved, in the board's own shape. */
export interface AgentProposalChange {
  /** Dotted path into AgentConfig, e.g. "tools.codeExecution". */
  path: string;
  label: string;
  value: unknown;
  why: string;
}

export interface AgentProposal {
  reply: string;
  changes: AgentProposalChange[];
  /** 'model' from the server; the client sets 'rules' on its local fallback. */
  source?: string;
}

/** What the server accepts. Everything read-only is stripped by the caller. */
export type AgentInput = Partial<AgentConfig> & Pick<AgentConfig, 'name'>;

const agentsService = {
  list: async (): Promise<Agent[]> => {
    const { data } = await apiClient.get<Agent[]>('/orchestrator/agents/');
    return asArray<Agent>(data);
  },

  get: async (id: number | string): Promise<Agent> => {
    const { data } = await apiClient.get<Agent>(`/orchestrator/agents/${id}/`);
    return data;
  },

  create: async (config: AgentInput): Promise<Agent> => {
    const { data } = await apiClient.post<Agent>('/orchestrator/agents/', config);
    return data;
  },

  /**
   * PATCH, so a knob the caller did not send keeps its current value. Sending
   * a partial config with PUT would reset unmentioned grants to their defaults,
   * which for a permission is the difference between narrowing and widening.
   */
  update: async (id: number | string, config: Partial<AgentConfig>): Promise<Agent> => {
    const { data } = await apiClient.patch<Agent>(`/orchestrator/agents/${id}/`, config);
    return data;
  },

  /**
   * Start a run. Resolves as soon as the backend has an execution id — the run
   * itself streams to `ws/execution/{execution_id}/`, which is what lets the
   * canvas draw it. Waiting for the answer here would defeat that.
   */
  execute: async (id: number | string, goal: string, threadId?: string): Promise<AgentRunStarted> => {
    const { data } = await apiClient.post<AgentRunStarted>(
      `/orchestrator/agents/${id}/execute/`,
      { goal, ...(threadId ? { thread_id: threadId } : {}) },
    );
    return data;
  },

  /** Put the configuration back to revision `number`, recorded as a new revision. */
  restoreRevision: async (id: number | string, number: number): Promise<Agent> => {
    const { data } = await apiClient.post<Agent>(
      `/orchestrator/agents/${id}/revisions/${number}/restore/`,
    );
    return data;
  },

  /** Stop one run. 409 carries why it cannot be stopped from here. */
  cancelRun: async (executionId: string): Promise<{ execution_id: string; status: string }> => {
    const { data } = await apiClient.post(`/orchestrator/runs/${executionId}/cancel/`);
    return data;
  },

  /** Queue an instruction for the agent's running run, read at its next step. */
  steer: async (id: number | string, message: string): Promise<{
    steered: boolean; execution_id: string; queued: number; dropped: number;
  }> => {
    const { data } = await apiClient.post(`/orchestrator/agents/${id}/steer/`, { message });
    return data;
  },

  /** Steer one coding-task worker, by execution — the lane's own run, not the
   *  agent's latest, which is the wrong worker when one implementer has two. */
  steerRun: async (executionId: string, message: string): Promise<{
    steered: boolean; execution_id: string; queued: number; dropped: number;
  }> => {
    const { data } = await apiClient.post(`/orchestrator/runs/${executionId}/steer/`, { message });
    return data;
  },

  /** Loosen or tighten approvals for the rest of the running run. */
  setRunAutonomy: async (id: number | string, level: 'review' | 'ask' | 'auto' | 'full'):
    Promise<{ autonomy: string; execution_id: string }> => {
    const { data } = await apiClient.post(`/orchestrator/agents/${id}/autonomy/`, { level });
    return data;
  },

  /** Loosen or tighten one coding-task worker, by execution. */
  setWorkerAutonomy: async (executionId: string, level: 'review' | 'ask' | 'auto' | 'full'):
    Promise<{ autonomy: string; execution_id: string }> => {
    const { data } = await apiClient.post(`/orchestrator/runs/${executionId}/autonomy/`, { level });
    return data;
  },

  /**
   * The builder's chat: a description in, knob changes out.
   *
   * Nothing is saved — the server proposes against the board we send it, and
   * the user still presses Save. It answers 503 when no model could be
   * reached, which is why the caller keeps its local rule-based `propose()`:
   * a builder that cannot reach a model should degrade, not stop.
   */
  configure: async (
    message: string,
    config: Partial<AgentConfig>,
    history: { role: string; text: string }[] = [],
    /** A saved agent's id, so the server keeps the exchange for next time. */
    agentId: number | null = null,
  ): Promise<AgentProposal> => {
    const { data } = await apiClient.post<AgentProposal>(
      '/orchestrator/agents/configure/',
      { message, config, history, ...(agentId != null ? { agent_id: agentId } : {}) },
    );
    return data;
  },

  /** The builder conversation kept for a saved agent, oldest first. */
  builderChat: async (id: number | string): Promise<{
    messages: { role: 'user' | 'agent'; text: string; changes: AgentProposalChange[] }[];
  }> => {
    const { data } = await apiClient.get(`/orchestrator/agents/${id}/builder-chat/`);
    return data;
  },

  /**
   * Orchestrator-driven creation wizard (replaces the builder's chat pane).
   * Both endpoints are read-only: questions proposes what to ask, propose
   * returns the config to approve. Creation itself goes through `create()`.
   */
  wizardQuestions: async (description: string): Promise<{
    questions: { id: string; text: string; why: string; multi: boolean; options?: string[] }[];
    memory_hints: string[];
  }> => {
    const { data } = await apiClient.post('/orchestrator/agents/wizard/questions/', { description });
    return { questions: data?.questions ?? [], memory_hints: data?.memory_hints ?? [] };
  },

  wizardPropose: async (description: string, answers: Record<string, unknown>): Promise<{
    config: Partial<AgentConfig>;
    explanations: string[];
    warnings: string[];
    eval_suggestion: { message: string };
  }> => {
    const { data } = await apiClient.post('/orchestrator/agents/wizard/propose/', { description, answers });
    return data;
  },

  remove: async (id: number | string): Promise<void> => {
    await apiClient.delete(`/orchestrator/agents/${id}/`);
  },
};

export default agentsService;
