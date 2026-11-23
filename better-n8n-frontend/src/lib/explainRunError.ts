/**
 * What a failed or cancelled run's error means, in plain words.
 *
 * The backend stores whatever text ended the run (`ExecutionLog.error_message`).
 * This turns the messages a person can act on into a headline and one link.
 * Anything else keeps the generic headline, and the raw text stays one tap
 * away under "Details" (the caller shows it).
 *
 * Each rule matches a fragment of a real backend sentence. Where the sentence
 * comes from is noted on the rule. The tests pin one real sentence per rule,
 * so a reworded backend message shows up as a failing test, not as a quiet
 * fall-back to the generic headline.
 */

export interface RunErrorAction {
  label: string;
  to: string;
}

export interface RunErrorExplanation {
  headline: string;
  action?: RunErrorAction;
}

export interface RunErrorContext {
  /** The agent the run belonged to. Agent-scoped actions need it. */
  agentId?: number | string | null;
}

const GENERIC_HEADLINE = 'The run stopped with an error.';

type ActionFor = (agentId: string | null) => RunErrorAction | undefined;

interface Rule {
  /** Lower-case fragments, tested against the lower-cased message. */
  test: RegExp;
  headline: string;
  action?: ActionFor;
}

/** A link into the agent's own settings. Dropped when the agent is unknown. */
const onAgent = (label: string): ActionFor => (agentId) =>
  agentId ? { label, to: `/agents/${encodeURIComponent(agentId)}` } : undefined;

const fixed = (label: string, to: string): ActionFor => () => ({ label, to });

/**
 * Order matters: the first rule that matches wins. The credits rule sits above
 * the key rule because the out-of-credit sentence also says "Credentials".
 */
const RULES: Rule[] = [
  {
    // runtime.py `_finalise_cancelled` ("Run cancelled.") and the approval
    // wait ("Run cancelled while waiting for approval.").
    test: /\brun cancelled\b/,
    headline: 'You stopped this run.',
  },
  {
    // runtime.py ~1589: the account-wide pause, which says where to resume.
    test: /paused for this account/,
    headline: 'All runs are paused on this account.',
    action: fixed('Open settings', '/settings'),
  },
  {
    // runtime.py ~1023: a trigger or another agent ran an agent that was not
    // cleared for unattended runs.
    test: /not enabled for unattended runs/,
    headline: 'This agent is not allowed to run without you.',
    action: onAgent("Open the agent's settings"),
  },
  {
    // runtime.py ~1603, `check_guardrails`.
    test: /spend cap/,
    headline: 'It hit its monthly spend cap.',
    action: onAgent('Change the cap'),
  },
  {
    // budget.py `describe`: "...reached its 5 minute time limit...".
    // Before the provider timeout rule, which must not claim this one.
    test: /time limit|timed out|out of time/,
    headline: 'It ran out of time.',
    action: onAgent('Raise the time limit'),
  },
  {
    // LangGraph's GraphRecursionError: "Recursion limit of N reached without
    // hitting a stop condition." Also `logs/failures.py`'s step_budget words.
    test: /recursion|step budget|used all its steps/,
    headline: 'It used all its steps.',
    action: onAgent('Raise the step limit'),
  },
  {
    // llm/access.py ~410 ("out of credit") and ~730 ("used all your credits").
    // Above the key rule: "Credentials" contains "credential".
    test: /credit|insufficient|quota|\b402\b/,
    headline: 'The account ran out of credits.',
    action: fixed('See usage', '/settings?tab=billing'),
  },
  {
    // llm/access.py ~738 and ~644: no verified key for this provider.
    test: /no verified .*credential/,
    headline: 'No verified key is set up for this provider.',
    action: fixed('Check your keys', '/credentials'),
  },
  {
    // llm/access.py ~417 ("rejected the API key"), plus the raw provider
    // words it classifies on (`_AUTH_PHRASES`) when a message passes through.
    test: /api key|unauthori[sz]ed|invalid_api_key|authentication|\b40[13]\b/,
    headline: 'The AI provider refused the key.',
    action: fixed('Check your keys', '/credentials'),
  },
  {
    // llm/access.py ~430 ("is no longer available on"), ~344 ("not being
    // served"). Retired or renamed models; the fix is another model.
    test: /no longer available|not being served|model not found|not a valid model|does not exist|end of life/,
    headline: 'The AI model is no longer available.',
    action: onAgent('Pick another model'),
  },
  {
    // llm/access.py ~330 ("(rate limited)"); a provider's own 429 words.
    test: /rate.?limit|too many requests|\b429\b|getting more requests/,
    headline: 'The provider was busy. Trying again later usually works.',
  },
  {
    // chat/turn/agent.py ~852 ("took too long to respond") and access.py ~359
    // ("did not reply in time at its provider (HTTP 504)").
    test: /took too long|did not reply in time|\bhttp 50[48]\b|\b524\b/,
    headline: 'The AI provider did not reply in time.',
  },
  {
    // access.py ~353 ("is overloaded at its provider"), ~364 ("could not
    // reach"), ~368 ("had a problem on its side").
    test: /overloaded|had a problem on its side|could not reach/,
    headline: 'The AI provider is having trouble right now.',
  },
  {
    // agents/admission.py ~99: the run never started, so nothing was charged.
    test: /at capacity/,
    headline: 'The system is busy right now. Nothing was charged.',
  },
  {
    // agents/contracts.py ~329 and ~346: the answer was not the shape the
    // agent was set up to produce.
    test: /\bcontract\b|expected a json object/,
    headline: 'The answer was not in the shape this agent is set up to give.',
  },
];

/**
 * Plain words for a run's error. Pure: no React, no network.
 *
 * `null` and empty text get the generic headline, so a caller can pass
 * `error_message` straight through.
 */
export function explainRunError(
  message: string | null | undefined,
  ctx: RunErrorContext = {},
): RunErrorExplanation {
  const text = (message ?? '').trim();
  if (!text) return { headline: GENERIC_HEADLINE };

  const lower = text.toLowerCase();
  const agentId = ctx.agentId != null && ctx.agentId !== '' ? String(ctx.agentId) : null;
  for (const rule of RULES) {
    if (!rule.test.test(lower)) continue;
    const action = rule.action?.(agentId);
    return action ? { headline: rule.headline, action } : { headline: rule.headline };
  }
  return { headline: GENERIC_HEADLINE };
}
