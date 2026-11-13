/**
 * Pure helpers for shaping Imagine requests and reading the model catalogue.
 * Mirrors the helpers in better-n8n-frontend/src/api/imagine.ts.
 */
import type { Capabilities, GenerationRequest, MediaKind, ModelCapability } from './types';

/** The catalogue before it loads. Every modality is an empty list, never undefined. */
export const EMPTY_CAPABILITIES: Capabilities = {
  image: [],
  video: [],
  audio: [],
  defaults: {},
  recommended: {},
};

/** True when at least one modality has models, i.e. the catalogue really loaded. */
export function hasModels(caps: Capabilities | null | undefined): boolean {
  if (!caps) return false;
  return caps.image.length > 0 || caps.video.length > 0 || caps.audio.length > 0;
}

export function findModel(
  caps: Capabilities | null | undefined,
  kind: MediaKind,
  id: string | null,
): ModelCapability | null {
  if (!caps || !id) return null;
  return caps[kind].find((m) => m.id === id) ?? null;
}

/** A job still moving on the server. These are the ones a screen keeps re-reading. */
export function isLiveGeneration(status: string | null | undefined): boolean {
  return status === 'pending' || status === 'processing';
}

/**
 * Strips the keys the user left blank. An empty array counts as blank: it means
 * "no references", and some providers read `input_references: []` as an
 * image-to-image request with no image. Unset has to survive all the way down,
 * because models disagree about which resolutions and ratios they take.
 */
export function pruneRequest(req: GenerationRequest): GenerationRequest {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(req)) {
    const empty =
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0);
    if (!empty) out[key] = value;
  }
  return out as unknown as GenerationRequest;
}
