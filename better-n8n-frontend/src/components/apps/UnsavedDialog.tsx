/**
 * "Save / Don't save / Cancel" — the in-app replacement for the browser's
 * `window.confirm` when leaving a file with unsaved changes.
 *
 * The dialog saves through the registered `save()` (see `SaveContext`), so it
 * works whichever editor is mounted. A save that fails (or a 412) leaves the
 * dialog open with the error rather than discarding the work.
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useSave } from './useSave';

export default function UnsavedDialog({
  filename,
  onDontSave,
  onCancel,
  onSaved,
}: {
  filename: string;
  onDontSave: () => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { save } = useSave();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const ok = await save();
      if (ok) onSaved();
      else setError('Could not save — your changes are still here.');
    } catch {
      setError('Could not save — your changes are still here.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay z-50 flex items-center justify-center p-4" role="dialog" aria-label="Unsaved changes">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-lg">
        <h2 className="text-[15px] font-semibold">Save changes to {filename}?</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Your changes will be lost if you don't save them.
        </p>
        {error && <p className="mt-2 text-[13px] text-destructive">{error}</p>}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md px-3 py-2 text-[13px] text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDontSave}
            disabled={saving}
            className="rounded-md border border-border/60 px-3 py-2 text-[13px] hover:bg-muted disabled:opacity-50"
          >
            Don't save
          </button>
          <button
            type="button"
            onClick={() => void doSave()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

