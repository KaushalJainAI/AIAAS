/**
 * The form for writing a solution by hand. It is the same form for a new
 * solution (POST), an edit (PATCH), and reviewing a draft before it is shared.
 *
 * It only collects and checks. The parent makes the request and shows the
 * outcome; server refusals arrive as `serverError` and are shown here, since
 * they are written for people.
 */
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';

import type { DraftFields } from '../../api/solutions';
import {
  LIMITS,
  SAVED_CLAIM_KINDS,
  claimKindInfo,
  hasErrors,
  toDraft,
  validate,
  type ClaimRow,
  type EnvRow,
  type FormErrors,
  type FormField,
  type FormValues,
} from '../../lib/solutionForm';
import { cn } from '../../lib/utils';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';

export interface SolutionFormProps {
  initial: FormValues;
  /** Only the new form offers "Share with <org>"; the others edit what exists. */
  mode: 'new' | 'edit';
  /** The organisation the share checkbox names, when one is selected. */
  orgName?: string | null;
  /** Offer "Share with <org>" (new solutions in an organisation). */
  shareOption?: boolean;
  /** Offer "I checked this is still true" (edits of a saved solution). */
  verifiable?: boolean;
  submitLabel: string;
  busy?: boolean;
  /** A refusal from the server, shown under the form. */
  serverError?: string | null;
  onSubmit: (draft: DraftFields, options: { share: boolean; verified: boolean }) => void;
  onCancel?: () => void;
}

const FIELD =
  'w-full min-w-0 rounded border border-border bg-background px-2.5 py-1.5 text-sm disabled:opacity-60';

export default function SolutionForm({
  initial,
  mode,
  orgName,
  shareOption = false,
  verifiable = false,
  submitLabel,
  busy = false,
  serverError,
  onSubmit,
  onCancel,
}: SolutionFormProps) {
  const id = useId();
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [share, setShare] = useState(false);
  const [verified, setVerified] = useState(false);
  const [showClaims, setShowClaims] = useState(initial.claims.length > 0);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validate(values);
    setErrors(found);
    if (hasErrors(found) || busy) return;
    onSubmit(toDraft(values), { share: shareOption && share, verified: verifiable && verified });
  };

  const fieldId = (name: string) => `${id}-${name}`;
  const errorId = (name: FormField) => `${id}-${name}-error`;
  const describe = (name: FormField) => (errors[name] ? errorId(name) : undefined);

  const updateEnv = (index: number, patch: Partial<EnvRow>) =>
    set('environment', values.environment.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const updateClaim = (index: number, patch: Partial<ClaimRow>) =>
    set('claims', values.claims.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <form onSubmit={submit} noValidate className="space-y-4 text-sm" aria-label={mode === 'new' ? 'New solution' : 'Edit solution'}>
      <Field label="The problem" htmlFor={fieldId('problem')} required error={errors.problem} errorId={errorId('problem')} hint="One sentence. What does someone see when it goes wrong?">
        <input
          id={fieldId('problem')}
          value={values.problem}
          maxLength={LIMITS.problem}
          onChange={(e) => set('problem', e.target.value)}
          aria-invalid={!!errors.problem}
          aria-describedby={describe('problem')}
          className={FIELD}
        />
      </Field>

      <Field label="Symptoms" htmlFor={fieldId('symptoms')} error={errors.symptoms} errorId={errorId('symptoms')} hint="The error text or what you saw. Paste it as it is.">
        <textarea
          id={fieldId('symptoms')}
          value={values.symptoms}
          onChange={(e) => set('symptoms', e.target.value)}
          rows={3}
          aria-invalid={!!errors.symptoms}
          aria-describedby={describe('symptoms')}
          className={cn(FIELD, 'font-mono text-[12px]')}
        />
      </Field>

      <Field label="What caused it" htmlFor={fieldId('root_cause')} error={errors.root_cause} errorId={errorId('root_cause')}>
        <textarea
          id={fieldId('root_cause')}
          value={values.root_cause}
          onChange={(e) => set('root_cause', e.target.value)}
          rows={2}
          aria-invalid={!!errors.root_cause}
          aria-describedby={describe('root_cause')}
          className={FIELD}
        />
      </Field>

      <Field label="What fixed it" htmlFor={fieldId('resolution')} required error={errors.resolution} errorId={errorId('resolution')} hint="The steps or change that made it work.">
        <textarea
          id={fieldId('resolution')}
          value={values.resolution}
          onChange={(e) => set('resolution', e.target.value)}
          rows={4}
          aria-invalid={!!errors.resolution}
          aria-describedby={describe('resolution')}
          className={FIELD}
        />
      </Field>

      <Field label="Tags" htmlFor={fieldId('tags')} error={errors.tags} errorId={errorId('tags')} hint="Comma separated, for example: ci, windows, cache.">
        <input
          id={fieldId('tags')}
          value={values.tags}
          onChange={(e) => set('tags', e.target.value)}
          aria-invalid={!!errors.tags}
          aria-describedby={describe('tags')}
          className={FIELD}
        />
      </Field>

      {/* Environment: name and value pairs, e.g. os → Windows 11. */}
      <fieldset className="space-y-2" aria-describedby={describe('environment')}>
        <legend className="text-[13px] font-medium">Where it applies</legend>
        <p className="text-[12px] text-muted-foreground">
          Versions and settings this fix depends on. A later answer for a different setup is marked to check.
        </p>
        {values.environment.map((row, index) => (
          <div key={index} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              aria-label={`Environment name ${index + 1}`}
              placeholder="Name, e.g. os"
              value={row.key}
              maxLength={LIMITS.envKey}
              onChange={(e) => updateEnv(index, { key: e.target.value })}
              className={cn(FIELD, 'sm:w-40')}
            />
            <input
              aria-label={`Environment value ${index + 1}`}
              placeholder="Value, e.g. Windows 11"
              value={row.value}
              maxLength={LIMITS.envValue}
              onChange={(e) => updateEnv(index, { value: e.target.value })}
              className={FIELD}
            />
            <button
              type="button"
              onClick={() => set('environment', values.environment.filter((_, i) => i !== index))}
              aria-label={`Remove environment row ${index + 1}`}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center self-end rounded text-muted-foreground hover:bg-secondary hover:text-foreground sm:self-auto"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        {errors.environment && (
          <p id={errorId('environment')} className="text-[12px] text-destructive">{errors.environment}</p>
        )}
        {values.environment.length < LIMITS.envRows && (
          <Button type="button" variant="secondary" size="sm" onClick={() => set('environment', [...values.environment, { key: '', value: '' }])}>
            <Plus className="h-3.5 w-3.5" /> Add a setting
          </Button>
        )}
      </fieldset>

      {/* Claims: optional. Each says how fast the statement goes stale. */}
      <div className="rounded-lg border border-border/60">
        <button
          type="button"
          aria-expanded={showClaims}
          aria-controls={fieldId('claims')}
          onClick={() => setShowClaims((v) => !v)}
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] font-medium"
        >
          Advanced: how fast each part goes out of date
          <ChevronDown className={cn('h-4 w-4 transition-transform', showClaims && 'rotate-180')} />
        </button>
        {showClaims && (
          <div id={fieldId('claims')} className="space-y-3 border-t border-border/60 p-3">
            <p className="text-[12px] text-muted-foreground">
              Write each statement the fix relies on and pick how quickly it changes. A statement past its window is
              marked "check" for everyone who reads it. Leave this empty and the fix is kept as one claim.
            </p>
            {values.claims.map((row, index) => {
              const info = claimKindInfo(row.kind);
              return (
                <div key={index} className="space-y-1.5 rounded-md bg-secondary/40 p-2">
                  <div className="flex items-start gap-2">
                    <input
                      aria-label={`Claim ${index + 1}`}
                      placeholder="A statement the fix relies on"
                      value={row.text}
                      maxLength={LIMITS.claimText}
                      onChange={(e) => updateClaim(index, { text: e.target.value })}
                      className={cn(FIELD, 'flex-1')}
                    />
                    <button
                      type="button"
                      onClick={() => set('claims', values.claims.filter((_, i) => i !== index))}
                      aria-label={`Remove claim ${index + 1}`}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <select
                    aria-label={`How fast claim ${index + 1} changes`}
                    value={row.kind}
                    onChange={(e) => updateClaim(index, { kind: e.target.value as ClaimRow['kind'] })}
                    className={FIELD}
                  >
                    {SAVED_CLAIM_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                  <p className="text-[12px] text-muted-foreground">{info.help}</p>
                </div>
              );
            })}
            {errors.claims && <p id={errorId('claims')} className="text-[12px] text-destructive">{errors.claims}</p>}
            {values.claims.length < LIMITS.claims && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => set('claims', [...values.claims, { text: '', kind: 'procedure' }])}
              >
                <Plus className="h-3.5 w-3.5" /> Add a claim
              </Button>
            )}
          </div>
        )}
      </div>

      {shareOption && (
        <label className="flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={share}
            onChange={(e) => setShare(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Share with {orgName ? <strong>{orgName}</strong> : 'my organisation'}
            <span className="block text-[12px] text-muted-foreground">
              Leave it off to keep it to yourself. You can share it later from the page.
            </span>
          </span>
        </label>
      )}

      {verifiable && (
        <label className="flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I checked this is still true
            <span className="block text-[12px] text-muted-foreground">
              Tick it only after you have confirmed the fix works today. Leave it off for a typo or wording change.
            </span>
          </span>
        </label>
      )}

      {serverError && <Alert tone="error">{serverError}</Alert>}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="submit" loading={busy}>{submitLabel}</Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  errorId,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  error?: string;
  errorId: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium">
        {label}
        {required && <span className="text-destructive" aria-hidden="true"> *</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children}
      {error
        ? <p id={errorId} className="text-[12px] text-destructive">{error}</p>
        : hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
