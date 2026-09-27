/**
 * Says so when a list is showing less than there is.
 *
 * The server pages these collections. Rendering the first page with no mention
 * of the rest produces a list that looks complete and is not — the failure mode
 * where you conclude something was deleted because you cannot see it.
 */
import { Info } from 'lucide-react';

export default function TruncationNotice({ shown, total }: { shown: number; total: number }) {
  if (shown >= total) return null;
  return (
    <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground mt-4">
      <Info className="w-3.5 h-3.5 shrink-0" />
      Showing {shown} of {total}. Use search or filters to narrow this down.
    </p>
  );
}
