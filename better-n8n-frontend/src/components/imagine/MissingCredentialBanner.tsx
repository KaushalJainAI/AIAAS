import { KeyRound, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Shown when /imagine/capabilities/ returns 400 because the user has no
 * active OpenRouter credential. Surfaces the backend's `detail` string and
 * deep-links into the Credentials page so the user can add one.
 */
export function MissingCredentialBanner({ detail }: { detail?: string }) {
  return (
    <div className="mx-6 mt-4 rounded-lg border border-border bg-warning-subtle p-4 flex items-start gap-3">
      <div className="shrink-0 mt-0.5 h-9 w-9 rounded-lg bg-warning-subtle border border-border flex items-center justify-center">
        <KeyRound size={16} className="text-amber-600 dark:text-amber-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Connect OpenRouter to start generating
        </p>
        <p className="text-xs mt-1 text-amber-800/80 dark:text-amber-200/70 leading-relaxed">
          {detail ||
            'Imagine routes every image, video, and audio request through your own OpenRouter key. ' +
              'Add an "OpenRouter API" credential and your generations will work immediately — no restart needed.'}
        </p>
        <Link
          to="/credentials"
          className="inline-flex items-center gap-1.5 mt-3 text-xs font-bold text-amber-700 dark:text-amber-300 hover:underline"
        >
          Add OpenRouter credential
          <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}
