/**
 * Style presets — prompt modifiers, not decoration.
 *
 * The page previously shipped five style cards backed by Unsplash thumbnails
 * whose selection was read once to highlight the active card and used nowhere
 * else. Picking "Cinematic" changed nothing about the request.
 *
 * These do something: the modifier is appended to the prompt at generate time
 * and shown to the user before they press the button. That is also the point
 * of a style gallery — it hands you the vocabulary for a look you can picture
 * but cannot phrase, which is the "articulation barrier" these galleries exist
 * to solve.
 *
 * Swatches are CSS gradients rather than remote images: a style picker that
 * needs the network to render its own controls is a picker that renders blank
 * on a slow connection.
 */

export interface StylePreset {
  id: string;
  name: string;
  /** Appended to the prompt. Empty for `none`. */
  modifier: string;
  /** Tailwind gradient classes for the swatch. */
  swatch: string;
}

export const IMAGE_STYLES: StylePreset[] = [
  { id: 'none', name: 'None', modifier: '', swatch: 'from-muted to-muted-foreground/20' },
  {
    id: 'photo',
    name: 'Photoreal',
    modifier: 'photorealistic, 85mm lens, natural light, fine detail, shallow depth of field',
    swatch: 'from-stone-400 via-stone-500 to-stone-700',
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    modifier: 'cinematic lighting, anamorphic lens flare, film grain, dramatic composition, teal and orange grade',
    swatch: 'from-orange-400 via-amber-600 to-teal-800',
  },
  {
    id: 'anime',
    name: 'Anime',
    modifier: 'anime style, cel shaded, clean linework, vibrant saturated colours, expressive',
    swatch: 'from-pink-400 via-rose-400 to-sky-400',
  },
  {
    id: 'digital-art',
    name: 'Digital art',
    modifier: 'digital painting, concept art, painterly brushwork, dramatic rim lighting',
    swatch: 'from-violet-500 via-purple-600 to-indigo-800',
  },
  {
    id: '3d',
    name: '3D render',
    modifier: '3D render, octane, subsurface scattering, soft studio lighting, high polish',
    swatch: 'from-cyan-300 via-blue-400 to-slate-600',
  },
  {
    id: 'watercolour',
    name: 'Watercolour',
    modifier: 'watercolour painting, soft pigment washes, visible paper texture, delicate edges',
    swatch: 'from-sky-200 via-emerald-200 to-amber-200',
  },
  {
    id: 'minimal',
    name: 'Minimal',
    modifier: 'minimalist, flat vector, generous negative space, limited palette, clean geometry',
    swatch: 'from-neutral-100 via-neutral-300 to-neutral-500',
  },
  {
    id: 'neon',
    name: 'Neon',
    modifier: 'neon-lit, cyberpunk, high contrast, volumetric haze, wet reflective surfaces',
    swatch: 'from-fuchsia-500 via-purple-600 to-cyan-500',
  },
];

export const VIDEO_STYLES: StylePreset[] = [
  { id: 'none', name: 'None', modifier: '', swatch: 'from-muted to-muted-foreground/20' },
  {
    id: 'cinematic',
    name: 'Cinematic',
    modifier: 'cinematic camera move, shallow depth of field, film grain, dramatic grade',
    swatch: 'from-orange-400 via-amber-600 to-teal-800',
  },
  {
    id: 'drone',
    name: 'Aerial',
    modifier: 'smooth aerial drone shot, wide establishing framing, slow forward push',
    swatch: 'from-sky-300 via-blue-500 to-indigo-700',
  },
  {
    id: 'documentary',
    name: 'Documentary',
    modifier: 'handheld documentary framing, natural light, realistic motion',
    swatch: 'from-stone-300 via-stone-500 to-stone-700',
  },
  {
    id: 'timelapse',
    name: 'Timelapse',
    modifier: 'timelapse, accelerated motion, moving clouds and shifting light',
    swatch: 'from-amber-300 via-rose-400 to-indigo-600',
  },
  {
    id: 'anime',
    name: 'Anime',
    modifier: 'anime animation, cel shaded, expressive motion, vibrant palette',
    swatch: 'from-pink-400 via-rose-400 to-sky-400',
  },
];

export function stylesFor(kind: 'image' | 'video' | 'audio'): StylePreset[] {
  if (kind === 'image') return IMAGE_STYLES;
  if (kind === 'video') return VIDEO_STYLES;
  // Speech has no visual style; the script is read verbatim.
  return [];
}

export function findStyle(kind: 'image' | 'video' | 'audio', id: string): StylePreset | null {
  return stylesFor(kind).find(s => s.id === id) ?? null;
}

/** Joins a prompt with its style modifier — the exact string that gets sent. */
export function applyStyle(prompt: string, style: StylePreset | null): string {
  const trimmed = prompt.trim();
  if (!style?.modifier) return trimmed;
  return `${trimmed}, ${style.modifier}`;
}
