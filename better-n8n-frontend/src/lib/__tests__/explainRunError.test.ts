import { describe, expect, it } from 'vitest';

import { explainRunError } from '../explainRunError';

const GENERIC = 'The run stopped with an error.';
const ctx = { agentId: 7 };

describe('explainRunError: the backend sentences', () => {
  it.each([
    ['cancelled', 'Run cancelled.', 'You stopped this run.', undefined],
    [
      'cancelled while waiting for approval',
      'Run cancelled while waiting for approval.',
      'You stopped this run.',
      undefined,
    ],
    [
      'account paused',
      'All runs are paused for this account until 09:30 IST. Resume them from Settings to run anything.',
      'All runs are paused on this account.',
      { label: 'Open settings', to: '/settings' },
    ],
    [
      'not cleared for unattended runs',
      '"Support bot" is not enabled for unattended runs. Turn on "allow unattended" in its settings if you want a trigger or another agent to be able to run it.',
      'This agent is not allowed to run without you.',
      { label: "Open the agent's settings", to: '/agents/7' },
    ],
    [
      'monthly spend cap',
      'This agent has reached its monthly spend cap (4200/4000). Raise the cap in its settings to keep running it.',
      'It hit its monthly spend cap.',
      { label: 'Change the cap', to: '/agents/7' },
    ],
    [
      'time limit',
      'The run reached its 5 minutes time limit and was stopped. Raise "Time limit" in the agent\'s settings if it needs longer.',
      'It ran out of time.',
      { label: 'Raise the time limit', to: '/agents/7' },
    ],
    [
      'LangGraph recursion limit',
      'Recursion limit of 25 reached without hitting a stop condition. You can increase the limit by setting the `recursion_limit` config key.',
      'It used all its steps.',
      { label: 'Raise the step limit', to: '/agents/7' },
    ],
    [
      'out of credit (provider refused)',
      'OpenRouter refused the request — out of credit. Add or top up a OpenRouter key in Credentials, or pick a model from another provider, then send the message again.',
      'The account ran out of credits.',
      { label: 'See usage', to: '/settings?tab=billing' },
    ],
    [
      'used all credits (platform key)',
      'You have used all your credits. Pick a free model, or add your own OpenRouter key in Credentials to keep going.',
      'The account ran out of credits.',
      { label: 'See usage', to: '/settings?tab=billing' },
    ],
    [
      'no verified credential, with the exception prefix',
      'LLMNoCredential: No verified OpenRouter credential. Add one in Credentials, then Verify it — an unverified key is not used — or pick a model from a provider you have set up.',
      'No verified key is set up for this provider.',
      { label: 'Check your keys', to: '/credentials' },
    ],
    [
      'key rejected by the provider',
      'OpenRouter rejected the API key. Check the credential in Credentials — it may have been revoked, may not cover this model, or may need to be Verified again.',
      'The AI provider refused the key.',
      { label: 'Check your keys', to: '/credentials' },
    ],
    [
      'raw 401 from a provider',
      'Error code: 401 - Incorrect API key provided.',
      'The AI provider refused the key.',
      { label: 'Check your keys', to: '/credentials' },
    ],
    [
      'retired model',
      '“openai/gpt-4.1” is no longer available on OpenAI. Pick a different model and send your message again.',
      'The AI model is no longer available.',
      { label: 'Pick another model', to: '/agents/7' },
    ],
    [
      'model not served',
      'The model x is not being served by OpenRouter right now. Pick a different model and send your message again.',
      'The AI model is no longer available.',
      { label: 'Pick another model', to: '/agents/7' },
    ],
    [
      'rate limited',
      'The model x is getting more requests than OpenRouter allows right now (rate limited). Wait about 20 seconds and send your message again, or pick a different model.',
      'The provider was busy. Trying again later usually works.',
      undefined,
    ],
    [
      'platform took too long',
      'The model took too long to respond.',
      'The AI provider did not reply in time.',
      undefined,
    ],
    [
      'provider 504',
      'The model x did not reply in time at its provider (HTTP 504), so this turn stopped before an answer.',
      'The AI provider did not reply in time.',
      undefined,
    ],
    [
      'provider overloaded',
      'The model x is overloaded at its provider right now, so this turn stopped before an answer.',
      'The AI provider is having trouble right now.',
      undefined,
    ],
    [
      'at capacity, never started',
      'The system is at capacity and this run could not be started within 120s. It has not been charged for; try again shortly, or stagger the schedules that fire together.',
      'The system is busy right now. Nothing was charged.',
      undefined,
    ],
    [
      'output contract broken',
      'Expected a JSON object matching the "research" contract, got prose.',
      'The answer was not in the shape this agent is set up to give.',
      undefined,
    ],
  ])('%s', (_name, message, headline, action) => {
    const got = explainRunError(message, ctx);
    expect(got.headline).toBe(headline);
    expect(got.action).toEqual(action);
  });
});

describe('explainRunError: edges', () => {
  it('gives the generic headline for null', () => {
    expect(explainRunError(null)).toEqual({ headline: GENERIC });
  });

  it('gives the generic headline for undefined, empty and blank text', () => {
    expect(explainRunError(undefined)).toEqual({ headline: GENERIC });
    expect(explainRunError('')).toEqual({ headline: GENERIC });
    expect(explainRunError('   ')).toEqual({ headline: GENERIC });
  });

  it('gives the generic headline, with no action, for text no rule knows', () => {
    expect(explainRunError('Something unexpected happened in the sandbox.', ctx))
      .toEqual({ headline: GENERIC });
  });

  it('drops agent-scoped actions when the agent is not known', () => {
    const spend = 'This agent has reached its monthly spend cap (4200/4000). Raise the cap in its settings to keep running it.';
    expect(explainRunError(spend)).toEqual({ headline: 'It hit its monthly spend cap.' });
    expect(explainRunError(spend, { agentId: null })).toEqual({ headline: 'It hit its monthly spend cap.' });
    expect(explainRunError(spend, { agentId: '' })).toEqual({ headline: 'It hit its monthly spend cap.' });
  });

  it('keeps global actions when the agent is not known', () => {
    const credits = 'You have used all your credits. Pick a free model, or add your own OpenRouter key in Credentials to keep going.';
    expect(explainRunError(credits)).toEqual({
      headline: 'The account ran out of credits.',
      action: { label: 'See usage', to: '/settings?tab=billing' },
    });
  });

  it('accepts a string agent id', () => {
    const steps = 'Recursion limit of 25 reached without hitting a stop condition.';
    expect(explainRunError(steps, { agentId: 'abc' }).action).toEqual({
      label: 'Raise the step limit',
      to: '/agents/abc',
    });
  });

  it('reads a credit sentence as credits, not as a missing key, though it names Credentials', () => {
    const sentence = 'OpenRouter refused the request — out of credit. Add or top up a OpenRouter key in Credentials.';
    expect(explainRunError(sentence).headline).toBe('The account ran out of credits.');
  });

  it('reads a time-limit sentence as time, not as a provider timeout', () => {
    const sentence = 'The run reached its 2 minutes time limit and was stopped.';
    expect(explainRunError(sentence).headline).toBe('It ran out of time.');
  });
});
