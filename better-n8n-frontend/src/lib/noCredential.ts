/**
 * Detects "no usable API key" failures so the UI can offer the fix
 * (add + verify a credential) instead of just toasting the sentence.
 *
 * Matches the backend's `LLMNoCredential` / `CredentialUnavailable` wording
 * (`llm/access.py`, `credentials/resolution.py`): "No verified X credential.
 * Add one in Credentials, then Verify it …". Kept substring-based because the
 * turn surfaces it as a plain `error`/`message` string with no code.
 */
export function isNoCredentialError(message: unknown): boolean {
  if (typeof message !== 'string' || !message.trim()) return false;
  const m = message.toLowerCase();
  return (
    (m.includes('no verified') && m.includes('credential')) ||
    (m.includes('no usable') && m.includes('credential'))
  );
}

/** Provider label inside the message ("No verified OpenRouter credential …"), if any. */
export function credentialProviderFromError(message: unknown): string {
  if (typeof message !== 'string') return '';
  const m = message.match(/no (?:verified|usable) (.+?) credential/i);
  return m?.[1]?.trim() ?? '';
}
