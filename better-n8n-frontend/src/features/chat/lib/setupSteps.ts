/**
 * The three first-run steps on the empty chat ("Get set up"), as pure data.
 *
 * The facts come from the same queries the Connections and Agents pages use;
 * this file only decides what they mean. Nothing here fetches or stores.
 */
import type { Credential, CredentialType } from '@/api/credentials';
import type { MCPServer } from '@/api/mcp';
import { anyConnected } from '@/lib/connectionStatus';

export interface SetupFacts {
  /** At least one chat conversation exists. */
  hasConversation: boolean;
  /** At least one connection is live and its credentials resolve. */
  hasConnection: boolean;
  /** At least one agent that is not archived. */
  hasAgent: boolean;
}

export interface SetupStep {
  id: 'ask' | 'connect' | 'agent';
  title: string;
  detail: string;
  /** Where the row goes. Absent when the row needs no page of its own. */
  to?: string;
  done: boolean;
}

export function setupSteps(facts: SetupFacts): SetupStep[] {
  return [
    {
      id: 'ask',
      title: 'Ask something',
      detail: 'Type below. The assistant answers, plans and hands off work.',
      done: facts.hasConversation,
    },
    {
      id: 'connect',
      title: 'Connect an account',
      detail: 'Link Gmail, Drive or another service the assistant can use for you.',
      to: '/connections',
      done: facts.hasConnection,
    },
    {
      id: 'agent',
      title: 'Make or install an agent',
      detail: 'An agent does a job for you, on a schedule or when you ask.',
      to: '/templates',
      done: facts.hasAgent,
    },
  ];
}

/** True once every step is done, which is when the card has nothing left to say. */
export function setupFinished(steps: readonly SetupStep[]): boolean {
  return steps.every((step) => step.done);
}

/** Archived agents are filed away, not set up, so they do not count. */
export function hasLiveAgent(agents: readonly { status: string }[]): boolean {
  return agents.some((agent) => agent.status !== 'archived');
}

export interface ConnectionFacts {
  servers: readonly MCPServer[];
  credentials: readonly Credential[];
  types: readonly CredentialType[];
  /**
   * The Connections page's credential check, read from the cache when that
   * page has run this session. Absent means "not checked yet", and the rule
   * falls back to whether the credential rows exist.
   */
  validation?: ReadonlyMap<number, { ok: boolean }>;
}

/**
 * Whether any connection counts as connected. It is the Connections page's own
 * rule (`lib/connectionStatus.ts`), so the card and the page cannot disagree.
 * A connector that needs no account at all is not a connection the user made,
 * so it does not count.
 */
export function hasConnectedAccount({ servers, ...ctx }: ConnectionFacts): boolean {
  return anyConnected(servers, ctx);
}
