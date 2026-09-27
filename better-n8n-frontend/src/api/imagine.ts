/**
 * Typed client for the Imagine form/REST surface.
 *
 * The page previously called `apiClient` inline and typed the capability
 * response as `any`, which is how a backend that returned three empty arrays
 * went unnoticed: `capabilities[mode]` was `undefined`, `.map` was never
 * reached, and the model picker rendered nothing without a single error.
 * `ModelCapability` is now the contract, and `hasModels` is the explicit check
 * a caller makes before assuming the catalog arrived.
 */
import apiClient from './client';

export type MediaKind = 'image' | 'video' | 'audio';
export type GenerationStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** An inclusive numeric window a model advertises for one dial. */
export interface Range {
  min: number;
  max: number;
}

/**
 * One model as served by `GET /imagine/capabilities/`.
 *
 * Every field is *per model*, and an empty one means the same thing throughout:
 * this model does not take that dial, so no control is rendered for it. The
 * backend used to substitute defaults where a model advertised none, which
 * produced two different wrongs — a value outside a model's enum is a hard 400
 * from OpenRouter, and a dial it never advertised is accepted and silently
 * ignored. The one exception is `voices`: empty there means the model takes a
 * free-form provider voice id, which is why that control becomes a text field.
 */
export interface ModelCapability {
  id: string;
  name: string;
  provider: string;
  description: string;
  /** Image: `512`/`1K`/`2K`/`4K`. Video: `480p`/`720p`/`1080p`/`4K`. */
  resolutions?: string[];
  aspect_ratios?: string[];
  /** Explicit `WIDTHxHEIGHT` alternatives to a resolution tier. Video. */
  sizes?: string[];
  /** Video only — the exact clip lengths this model accepts, in seconds. */
  durations?: number[];
  /** Image only, and only where the model exposes a quality switch. */
  qualities?: string[];
  /** Image only — `png`/`jpeg`/`webp`/`svg`, where advertised. */
  output_formats?: string[];
  /** Image only — `auto`/`transparent`/`opaque`. OpenAI + Riverflow families. */
  backgrounds?: string[];
  /** Image only — the 0-100 window for jpeg/webp compression, if offered. */
  output_compression?: Range | null;
  /** Image only — how many images one request may return. Absent: exactly one. */
  batch?: Range | null;
  max_batch?: number;
  /** How many reference images this model accepts. 0 means none. */
  max_references?: number;
  supports_seed?: boolean;
  supports_references?: boolean;
  /** Video only — which ends of the clip may be pinned to an image. */
  frame_slots?: string[];
  /** Video only — whether the model can score the clip with audio. */
  supports_audio?: boolean;
  /** Audio only. Empty means the model takes a free-form voice id. */
  voices?: string[];
  supports_speed?: boolean;
  /** Audio only — the endpoint's documented 0.5-2.0, not the UI's old guess. */
  speed_range?: Range | null;
  /** Audio only — `mp3` plays in the browser, `pcm` is raw samples. */
  response_formats?: string[];
  /** Audio only — free-text tone direction (the OpenAI speech family). */
  supports_instructions?: boolean;
}

export interface Capabilities {
  image: ModelCapability[];
  video: ModelCapability[];
  audio: ModelCapability[];
  /** Backend's preferred starting model per modality. */
  defaults: Partial<Record<MediaKind, string | null>>;
  /** Ids to surface above the fold in the picker. */
  recommended: Partial<Record<MediaKind, string[]>>;
}

export interface Generation {
  id: number;
  type: MediaKind;
  prompt: string;
  negative_prompt: string | null;
  model: string;
  resolution: string | null;
  aspect_ratio: string | null;
  duration: string | null;
  seed: number | null;
  quality: string | null;
  output_format: string | null;
  generate_audio: boolean | null;
  voice: string | null;
  speed: number | null;
  instructions: string | null;
  response_format: string | null;
  size: string | null;
  background: string | null;
  output_compression: number | null;
  batch_size: number | null;
  reference_urls: string[];
  frame_images: { url: string; frame_type: string }[];
  output_url: string | null;
  /** Every output of the request. `output_url` is the first of these. */
  output_urls: string[];
  status: GenerationStatus;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Only the fields a client is allowed to set — `metadata` and every output
 * field are server-owned.
 *
 * This is the complete dial set the OpenRouter endpoints accept. Which of them
 * may be sent for a given call is decided by the selected model's
 * `ModelCapability`, and the backend refuses the rest rather than forwarding a
 * setting that would be ignored.
 */
export interface GenerationRequest {
  type: MediaKind;
  prompt: string;
  model: string;
  negative_prompt?: string;
  resolution?: string;
  aspect_ratio?: string;
  size?: string;
  duration?: string;
  seed?: number;
  quality?: string;
  output_format?: string;
  background?: string;
  output_compression?: number;
  batch_size?: number;
  reference_urls?: string[];
  frame_images?: { url: string; frame_type: string }[];
  generate_audio?: boolean;
  voice?: string;
  speed?: number;
  instructions?: string;
  response_format?: string;
}

export const EMPTY_CAPABILITIES: Capabilities = {
  image: [],
  video: [],
  audio: [],
  defaults: {},
  recommended: {},
};

/** True when at least one modality has models — i.e. the catalog really loaded. */
export function hasModels(caps: Capabilities | null): boolean {
  if (!caps) return false;
  return caps.image.length > 0 || caps.video.length > 0 || caps.audio.length > 0;
}

export function findModel(
  caps: Capabilities | null,
  kind: MediaKind,
  id: string | null,
): ModelCapability | null {
  if (!caps || !id) return null;
  return caps[kind].find(m => m.id === id) ?? null;
}

/**
 * Strips keys the user left blank.
 *
 * The backend drops nulls too, but sending them at all defeats a model's own
 * defaults — and models disagree about which resolutions and ratios they take,
 * so "unset" has to survive the whole way down rather than being filled in
 * with a guess at any layer.
 */
export function pruneRequest(req: GenerationRequest): GenerationRequest {
  const out = { ...req };
  (Object.keys(out) as Array<keyof GenerationRequest>).forEach(key => {
    const value = out[key];
    const empty =
      value === undefined || value === null || value === '' ||
      // An empty array is "no references", which is what sending nothing
      // already says — and `input_references: []` is a key some providers read
      // as an image-to-image request with no image.
      (Array.isArray(value) && value.length === 0);
    if (empty) delete out[key];
  });
  return out;
}

export const imagineApi = {
  capabilities: (opts?: { refresh?: boolean }) =>
    apiClient
      .get<Capabilities>('/imagine/capabilities/', {
        params: opts?.refresh ? { refresh: 1 } : undefined,
      })
      .then(r => ({ ...EMPTY_CAPABILITIES, ...r.data })),

  list: () =>
    apiClient
      .get<{ results?: Generation[] } | Generation[]>('/imagine/')
      .then(r => (Array.isArray(r.data) ? r.data : r.data.results ?? [])),

  get: (id: number) => apiClient.get<Generation>(`/imagine/${id}/`).then(r => r.data),

  create: (req: GenerationRequest) =>
    apiClient.post<Generation>('/imagine/', pruneRequest(req)).then(r => r.data),

  remove: (id: number) => apiClient.delete(`/imagine/${id}/`).then(() => undefined),
};
