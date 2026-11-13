/**
 * The studio form's state rules, as pure functions. Mirrors
 * better-n8n-frontend/src/hooks/useImagineStudio.ts: every dial follows the
 * selected model's own advertised values, and a dial the model does not take is
 * never sent (the server refuses those, or bills and ignores them).
 */
import { applyStyle, type StylePreset } from './styles';
import type { Capabilities, GenerationRequest, MediaKind, ModelCapability } from './types';

export interface StudioParams {
  resolution?: string;
  aspectRatio?: string;
  size?: string;
  duration?: number;
  quality?: string;
  outputFormat?: string;
  background?: string;
  outputCompression?: number;
  batchSize?: number;
  referenceUrls: string[];
  frameImages: { url: string; frame_type: string }[];
  voice?: string;
  speed: number;
  instructions: string;
  responseFormat?: string;
  seed: string;
  negativePrompt: string;
  generateAudio: boolean;
}

export const INITIAL_PARAMS: StudioParams = {
  speed: 1,
  seed: '',
  negativePrompt: '',
  generateAudio: true,
  referenceUrls: [],
  frameImages: [],
  instructions: '',
};

/** Keeps a chosen value only when the model still offers it; the first offer otherwise. */
export function snap<T>(current: T | undefined, allowed: T[] | undefined): T | undefined {
  if (!allowed || allowed.length === 0) return undefined;
  return current !== undefined && allowed.includes(current) ? current : allowed[0];
}

function clamp(value: number, window: { min: number; max: number }): number {
  return Math.min(Math.max(value, window.min), window.max);
}

/** Re-snaps every parameter to what the chosen model accepts. */
export function snapParams(prev: StudioParams, model: ModelCapability, kind: MediaKind): StudioParams {
  return {
    ...prev,
    resolution: snap(prev.resolution, model.resolutions),
    aspectRatio: snap(prev.aspectRatio, model.aspect_ratios),
    size: kind === 'video' ? snap(prev.size, model.sizes) : undefined,
    duration: kind === 'video' ? snap(prev.duration, model.durations) : undefined,
    quality: kind === 'image' ? snap(prev.quality, model.qualities) : undefined,
    outputFormat: kind === 'image' ? snap(prev.outputFormat, model.output_formats) : undefined,
    background: kind === 'image' ? snap(prev.background, model.backgrounds) : undefined,
    outputCompression:
      kind === 'image' && model.output_compression
        ? clamp(prev.outputCompression ?? 80, model.output_compression)
        : undefined,
    batchSize:
      kind === 'image' && model.batch ? clamp(prev.batchSize ?? model.batch.min, model.batch) : undefined,
    referenceUrls:
      (model.max_references ?? 0) > 0 ? prev.referenceUrls.slice(0, model.max_references) : [],
    frameImages: prev.frameImages.filter((f) => (model.frame_slots ?? []).includes(f.frame_type)),
    voice: kind === 'audio' ? snap(prev.voice, model.voices) : undefined,
    responseFormat: kind === 'audio' ? snap(prev.responseFormat, model.response_formats) : undefined,
    speed: model.speed_range ? clamp(prev.speed, model.speed_range) : prev.speed,
    instructions: model.supports_instructions ? prev.instructions : '',
  };
}

/** The catalogue's starting model for a kind: the backend's default, else the first. */
export function defaultModelFor(caps: Capabilities, kind: MediaKind): string {
  const pool = caps[kind];
  return caps.defaults[kind] ?? pool[0]?.id ?? '';
}

/**
 * The request a generate sends. Each dial goes only where the model advertises it,
 * and a blank dial is left out so the model's own default applies.
 */
export function buildRequest(args: {
  kind: MediaKind;
  prompt: string;
  model: ModelCapability;
  params: StudioParams;
  style: StylePreset | null;
}): GenerationRequest {
  const { kind, model, params } = args;
  const seed = params.seed.trim() === '' ? undefined : Number(params.seed);
  const trimmed = args.prompt.trim();
  const prompt = kind === 'audio' ? trimmed : applyStyle(trimmed, args.style);
  const request: GenerationRequest = {
    type: kind,
    prompt,
    model: model.id,
    resolution: params.resolution,
    aspect_ratio: kind === 'audio' ? undefined : params.aspectRatio,
    size: kind === 'video' ? params.size : undefined,
    negative_prompt: kind === 'audio' ? undefined : params.negativePrompt.trim() || undefined,
    seed: seed !== undefined && Number.isFinite(seed) && model.supports_seed ? seed : undefined,
    quality: kind === 'image' ? params.quality : undefined,
    output_format: kind === 'image' ? params.outputFormat : undefined,
    background: kind === 'image' ? params.background : undefined,
    output_compression: kind === 'image' ? params.outputCompression : undefined,
    batch_size: kind === 'image' ? params.batchSize : undefined,
    reference_urls: (model.max_references ?? 0) > 0 ? params.referenceUrls : undefined,
    frame_images: kind === 'video' ? params.frameImages : undefined,
    duration: kind === 'video' && params.duration ? String(params.duration) : undefined,
    generate_audio: kind === 'video' && model.supports_audio ? params.generateAudio : undefined,
    voice: kind === 'audio' ? params.voice : undefined,
    speed: kind === 'audio' && model.supports_speed ? params.speed : undefined,
    response_format: kind === 'audio' ? params.responseFormat : undefined,
    instructions:
      kind === 'audio' && model.supports_instructions ? params.instructions.trim() || undefined : undefined,
  };
  return request;
}
