/**
 * Style presets: prompt modifiers added to the prompt at generate time, so the
 * stored prompt is the exact string the model saw. Copied from
 * better-n8n-frontend/src/lib/imagineStyles.ts (ids, names and modifiers).
 */
import type { MediaKind } from './types';

export interface StylePreset {
  id: string;
  name: string;
  modifier: string;
}

const NONE: StylePreset = { id: 'none', name: 'None', modifier: '' };

export const IMAGE_STYLES: StylePreset[] = [
  NONE,
  { id: 'photo', name: 'Photoreal', modifier: 'photorealistic, 85mm lens, natural light, fine detail, shallow depth of field' },
  { id: 'cinematic', name: 'Cinematic', modifier: 'cinematic lighting, anamorphic lens flare, film grain, dramatic composition, teal and orange grade' },
  { id: 'anime', name: 'Anime', modifier: 'anime style, cel shaded, clean linework, vibrant saturated colours, expressive' },
  { id: 'digital-art', name: 'Digital art', modifier: 'digital painting, concept art, painterly brushwork, dramatic rim lighting' },
  { id: '3d', name: '3D render', modifier: '3D render, octane, subsurface scattering, soft studio lighting, high polish' },
  { id: 'watercolour', name: 'Watercolour', modifier: 'watercolour painting, soft pigment washes, visible paper texture, delicate edges' },
  { id: 'minimal', name: 'Minimal', modifier: 'minimalist, flat vector, generous negative space, limited palette, clean geometry' },
  { id: 'neon', name: 'Neon', modifier: 'neon-lit, cyberpunk, high contrast, volumetric haze, wet reflective surfaces' },
];

export const VIDEO_STYLES: StylePreset[] = [
  NONE,
  { id: 'cinematic', name: 'Cinematic', modifier: 'cinematic camera move, shallow depth of field, film grain, dramatic grade' },
  { id: 'drone', name: 'Aerial', modifier: 'smooth aerial drone shot, wide establishing framing, slow forward push' },
  { id: 'documentary', name: 'Documentary', modifier: 'handheld documentary framing, natural light, realistic motion' },
  { id: 'timelapse', name: 'Timelapse', modifier: 'timelapse, accelerated motion, moving clouds and shifting light' },
  { id: 'anime', name: 'Anime', modifier: 'anime animation, cel shaded, expressive motion, vibrant palette' },
];

/** Speech has no visual style; the script is read verbatim. */
export function stylesFor(kind: MediaKind): StylePreset[] {
  if (kind === 'image') return IMAGE_STYLES;
  if (kind === 'video') return VIDEO_STYLES;
  return [];
}

/** Joins a prompt with its style modifier. This is the exact string that is sent. */
export function applyStyle(prompt: string, style: StylePreset | null): string {
  const trimmed = prompt.trim();
  if (!style?.modifier) return trimmed;
  return `${trimmed}, ${style.modifier}`;
}
