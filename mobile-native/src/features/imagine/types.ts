/**
 * Imagine (media generation): the wire shapes for the generation form, the model
 * catalogue, the jobs, and the conversational agent.
 *
 * Copied from better-n8n-frontend/src/api/imagine.ts (the form surface and the
 * catalogue) and src/api/imagineAgent.ts (the conversation), with the same names.
 * Every catalogue field is per model, and an empty one means "this model does
 * not take that dial", so no control is rendered for it.
 */

export type MediaKind = 'image' | 'video' | 'audio';
export type GenerationStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** An inclusive numeric window a model advertises for one dial. */
export interface Range {
  min: number;
  max: number;
}

/** One model as served by `GET /imagine/capabilities/`. */
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
  /** Video only: the exact clip lengths this model accepts, in seconds. */
  durations?: number[];
  /** Image only, and only where the model exposes a quality switch. */
  qualities?: string[];
  /** Image only: `png`/`jpeg`/`webp`/`svg`, where advertised. */
  output_formats?: string[];
  /** Image only: `auto`/`transparent`/`opaque`. */
  backgrounds?: string[];
  /** Image only: the 0-100 window for jpeg/webp compression, if offered. */
  output_compression?: Range | null;
  /** Image only: how many images one request may return. Absent means exactly one. */
  batch?: Range | null;
  max_batch?: number;
  /** How many reference images this model accepts. 0 means none. */
  max_references?: number;
  supports_seed?: boolean;
  supports_references?: boolean;
  /** Video only: which ends of the clip may be pinned to an image. */
  frame_slots?: string[];
  /** Video only: whether the model can score the clip with audio. */
  supports_audio?: boolean;
  /** Audio only. Empty means the model takes a free-form voice id. */
  voices?: string[];
  supports_speed?: boolean;
  /** Audio only: the endpoint's documented 0.5-2.0. */
  speed_range?: Range | null;
  /** Audio only: `mp3` plays on a phone, `pcm` is raw samples. */
  response_formats?: string[];
  /** Audio only: free-text tone direction. */
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
 * Only the fields a client may set. `metadata` and every output field are
 * server-owned. Which of these may be sent for a given call is decided by the
 * selected model's `ModelCapability`, and the server refuses the rest.
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

/* ---------- conversational agent (`/imagine/agent/`, `/imagine/conversations/`) ---------- */

export interface ImagineIntent {
  type: 'image' | 'video' | 'audio';
  model: string | null;
  prompt: string;
  params: Record<string, unknown>;
  confidence: number;
  missing_required: string[];
  clarifying_question: string | null;
  estimated_cost_usd: number;
  reasoning?: string;
}

export interface ImagineGeneration {
  id: number;
  type: 'image' | 'video' | 'audio';
  prompt: string;
  model: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  output_url: string | null;
  error_message: string | null;
}

export interface ImagineChatResponse {
  conversation_id: number;
  message_id: number;
  assistant_message: string;
  intent_preview?: ImagineIntent;
  requires_hitl: boolean;
  generation: ImagineGeneration | null;
  error?: string;
}

export interface ImagineMessage {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  intent: ImagineIntent | null;
  generation: ImagineGeneration | null;
  requires_hitl: boolean;
  created_at: string;
}

export interface ImagineConversation {
  id: number;
  title: string;
  status: 'idle' | 'awaiting_hitl' | 'generating';
  pending_intent: ImagineIntent | null;
  created_at: string;
  updated_at: string;
  messages?: ImagineMessage[];
  last_message?: { role: string; content: string } | null;
}

/** What a paused conversation can be told: approve the intent, edit it, or drop it. */
export type ImagineResumeDecision = 'approve' | 'edit' | 'cancel';
