/**
 * The builder's unsaved board, held in memory per agent so every builder screen
 * (the section list and each section) reads and edits the same copy.
 *
 * An entry lives while at least one builder screen is mounted for its agent, and
 * is dropped when the last one unmounts. That is what makes "leaving discards" a
 * decision the screens make (with a confirm), not something the store does quietly.
 */
import { useEffect, useSyncExternalStore } from 'react';

import type { AgentConfig } from './types';

export interface DraftEntry {
  /** What the board shows and what a save sends. */
  cfg: AgentConfig;
  /** What is saved on the server. The board is dirty when `cfg` differs from it. */
  base: AgentConfig;
  /** Refused fields from the last save, keyed by config field name. */
  errors: Record<string, string>;
  /** One sentence from the last refusal, for the top of the screen. */
  summary: string | null;
}

const entries = new Map<string, DraftEntry>();
const holders = new Map<string, number>();
const listeners = new Set<() => void>();

function publish(key: string, entry: DraftEntry | undefined): void {
  if (entry) entries.set(key, entry);
  else entries.delete(key);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The draft for `key`, created from `seed` the first time it is wanted. Returns
 * null while there is no seed yet (the agent is still loading).
 */
export function useDraftEntry(key: string, seed: AgentConfig | null): DraftEntry | null {
  // Created during render so the first paint already has the board. Idempotent,
  // so a second render or a strict-mode double render changes nothing.
  if (seed && !entries.has(key)) {
    entries.set(key, { cfg: seed, base: seed, errors: {}, summary: null });
  }

  useEffect(() => {
    holders.set(key, (holders.get(key) ?? 0) + 1);
    return () => {
      const left = (holders.get(key) ?? 1) - 1;
      if (left <= 0) {
        holders.delete(key);
        publish(key, undefined);
      } else {
        holders.set(key, left);
      }
    };
  }, [key]);

  return useSyncExternalStore(
    subscribe,
    () => entries.get(key) ?? null,
    () => null,
  );
}

function update(key: string, change: (entry: DraftEntry) => DraftEntry): void {
  const entry = entries.get(key);
  if (!entry) return;
  publish(key, change(entry));
}

/** Edit the board. The updater gets the current config and returns the next one. */
export function patchDraft(key: string, next: (cfg: AgentConfig) => AgentConfig): void {
  update(key, (entry) => ({ ...entry, cfg: next(entry.cfg) }));
}

/** A save went through: the server's copy is the new baseline and the board. */
export function adoptSaved(key: string, saved: AgentConfig): void {
  update(key, () => ({ cfg: saved, base: saved, errors: {}, summary: null }));
}

/** Put the board back to the saved copy. */
export function discardDraft(key: string): void {
  update(key, (entry) => ({ ...entry, cfg: entry.base, errors: {}, summary: null }));
}

/** A save was refused (or checked locally): show the fields that need attention. */
export function setDraftErrors(key: string, errors: Record<string, string>, summary: string | null): void {
  update(key, (entry) => ({ ...entry, errors, summary }));
}
