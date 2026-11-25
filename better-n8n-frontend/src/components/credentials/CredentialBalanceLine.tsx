import { useState, type MouseEvent } from 'react';

import { getCredentialBalance } from '../../api/credentials';
import { formatBalanceLine } from '../../lib/credentialBalance';

interface Props {
  credentialId: number;
}

/**
 * The balance of one OpenRouter key, shown on demand. Nothing is fetched until
 * the person asks, and a checked answer stays on the card until they ask again,
 * so a card never costs a request just by being on screen.
 */
export default function CredentialBalanceLine({ credentialId }: Props) {
  const [line, setLine] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const check = async (event: MouseEvent<HTMLButtonElement>) => {
    // The card opens the credential when it is clicked; this button must not.
    event.stopPropagation();
    setLoading(true);
    try {
      setLine(formatBalanceLine(await getCredentialBalance(credentialId)));
    } catch {
      setLine('Could not check the balance.');
    } finally {
      setLoading(false);
    }
  };

  if (line === null) {
    return (
      <button
        type="button"
        onClick={check}
        disabled={loading}
        className="text-xs font-medium text-primary hover:underline disabled:opacity-60"
      >
        {loading ? 'Checking balance…' : 'Check balance'}
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="truncate text-muted-foreground" data-testid="credential-balance">
        {line}
      </span>
      <button
        type="button"
        onClick={check}
        disabled={loading}
        className="shrink-0 font-medium text-primary hover:underline disabled:opacity-60"
      >
        {loading ? 'Checking…' : 'Refresh'}
      </button>
    </div>
  );
}
