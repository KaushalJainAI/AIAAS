/**
 * The non-secret fields an API card asks for (a subdomain, a region).
 *
 * Props only: it holds the typed values and nothing else. The caller decides
 * what submitting means (`cardConnect`) and shows the result. Secrets never
 * reach this form; they are collected by the credential form on the same modal.
 */
import { useId, useState, type FormEvent } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { CardField } from '@/api/mcp';

export interface CardFieldsFormProps {
  fields: readonly CardField[];
  /** Shown on the submit button. */
  submitLabel?: string;
  busy?: boolean;
  /** The backend's own words for a failed connect, when there are any. */
  error?: string | null;
  /** Receives the trimmed values, keyed by field name. */
  onSubmit: (values: Record<string, string>) => void;
  onCancel?: () => void;
}

const INPUT =
  'w-full px-4 py-2.5 bg-background border border-border/60 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm';

/**
 * Whether a value matches a field's `pattern`, the way an HTML `pattern` does:
 * the whole value must match. The browser checks it too, but not every
 * environment does, so the submit path checks it again. A pattern that is not a
 * valid regular expression checks nothing here (the backend still validates).
 */
function matchesPattern(pattern: string, value: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`).test(value);
  } catch {
    return true;
  }
}

function FieldInput({
  field,
  id,
  helpId,
  value,
  onChange,
}: {
  field: CardField;
  id: string;
  helpId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const described = field.help ? { 'aria-describedby': helpId } : {};

  if (field.options && field.options.length > 0) {
    return (
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className={INPUT}
        {...described}
      >
        <option value="">Choose…</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      id={id}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      pattern={field.pattern || undefined}
      required
      autoComplete="off"
      spellCheck={false}
      className={`${INPUT} font-mono`}
      {...described}
    />
  );
}

export default function CardFieldsForm({
  fields,
  submitLabel = 'Connect',
  busy = false,
  error = null,
  onSubmit,
  onCancel,
}: CardFieldsFormProps) {
  const baseId = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Native validation first: `required` and `pattern` are checked by the
    // browser, which focuses the failing field.
    if (!e.currentTarget.reportValidity()) return;
    const trimmed: Record<string, string> = {};
    for (const field of fields) {
      const value = (values[field.name] ?? '').trim();
      if (field.pattern && !matchesPattern(field.pattern, value)) {
        setProblem(`${field.label} is not in the expected format.`);
        return;
      }
      trimmed[field.name] = value;
    }
    setProblem(null);
    onSubmit(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label="Connection details">
      {fields.map((field) => {
        const id = `${baseId}-${field.name}`;
        const helpId = `${id}-help`;
        return (
          <div key={field.name}>
            <label htmlFor={id} className="block text-sm font-semibold text-foreground mb-1.5">
              {field.label}
              <span className="text-destructive ml-1" aria-hidden="true">*</span>
            </label>
            <FieldInput
              field={field}
              id={id}
              helpId={helpId}
              value={values[field.name] ?? ''}
              onChange={(value) => {
                setProblem(null);
                setValues((prev) => ({ ...prev, [field.name]: value }));
              }}
            />
            {field.help && (
              <p id={helpId} className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                {field.help}
              </p>
            )}
          </div>
        );
      })}

      {(error ?? problem) && (
        <div
          role="alert"
          className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-sm text-destructive"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>{error ?? problem}</span>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-md border border-border/60 text-sm font-semibold hover:bg-muted/50 transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={busy}
          className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-md bg-foreground text-background text-sm font-semibold hover:bg-foreground/90 transition-colors disabled:opacity-50"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {busy ? 'Connecting…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
