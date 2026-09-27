/**
 * The shape a webhook trigger is edited in.
 *
 * A separate draft from `ScheduleDraft` rather than a superset with unused
 * fields, because the difference *is* the design: a webhook has no cron, no
 * timezone, no live window and no overlap policy. `webhook_receive` calls
 * `start_agent_run` directly and never consults the sweep, so every one of
 * those controls would be a switch that moves nothing — the failure mode
 * `allowUnattended`, `connectors` and `notifyOnHitl` each shipped as before
 * they were wired.
 *
 * Kept out of the component file for the same reason `scheduleDraft.ts` is:
 * exporting a function beside a component defeats fast refresh, and losing an
 * in-progress draft on every keystroke-triggered reload is not a fair trade.
 */

export interface WebhookDraft {
  /** What the user calls this hook. An agent may have several. */
  name: string;
  /**
   * What the agent is asked to do when a request arrives. The inbound body is
   * appended as context; it can never be the instruction, which is why this
   * field has to carry one.
   */
  goal: string;
}

export function emptyWebhookDraft(): WebhookDraft {
  return { name: '', goal: '' };
}
