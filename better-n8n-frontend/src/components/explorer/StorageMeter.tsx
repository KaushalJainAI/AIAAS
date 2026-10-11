/**
 * How much of the account's storage is used, at the foot of the file
 * browser's navigation pane.
 *
 * The backend refuses an upload that does not fit (`inference/quota.py`), so
 * this is where a person sees that coming. Trash counts until it is emptied,
 * which is why the bar offers the Trash when it is the reason the bar is full.
 *
 * Draws nothing while loading, on an error, or when the deployment sets no
 * quota — a meter with no limit has nothing to say.
 */
import { useQuery } from '@tanstack/react-query';

import { foldersService } from '../../api/documents';
import { formatSize } from '../../lib/fileDisplay';
import { cn } from '../../lib/utils';

/** Where the bar turns amber, then red. */
const WARN_AT = 80;
const FULL_AT = 95;

export default function StorageMeter({ onOpenTrash }: { onOpenTrash: () => void }) {
  const { data } = useQuery({
    queryKey: ['storage'],
    queryFn: () => foldersService.storage(),
    staleTime: 30_000,
  });

  if (!data || !data.limit_bytes) return null;

  const percent = Math.min(100, data.percent ?? 0);
  const tone = percent >= FULL_AT ? 'full' : percent >= WARN_AT ? 'warn' : 'ok';
  const trash = data.breakdown.trash;

  return (
    <div className="border-t border-border/60 p-3 text-[11.5px] text-muted-foreground">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="font-medium text-foreground">Storage</span>
        <span>
          {formatSize(data.used_bytes)} of {formatSize(data.limit_bytes)}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            tone === 'full' ? 'bg-destructive' : tone === 'warn' ? 'bg-amber-500' : 'bg-primary',
          )}
          style={{ width: `${Math.max(percent, 1)}%` }}
        />
      </div>
      {tone !== 'ok' && (
        <p className={cn('mt-1.5', tone === 'full' && 'text-destructive')}>
          {tone === 'full' ? 'Almost full. New files may be refused.' : 'Getting full.'}
          {trash > 0 && (
            <>
              {' '}
              <button type="button" onClick={onOpenTrash} className="underline hover:text-foreground">
                Trash holds {formatSize(trash)}
              </button>
              .
            </>
          )}
        </p>
      )}
    </div>
  );
}
