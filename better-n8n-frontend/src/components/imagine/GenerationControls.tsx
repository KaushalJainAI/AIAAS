/**
 * Parameter controls for the Imagine form.
 *
 * One rule runs through the whole file: **a control exists here only where the
 * selected model advertises that dial**, and it offers only the values that
 * model accepts. Both halves were learned from the live API. A value outside a
 * model's advertised enum is a hard 400 —
 *
 *     resolution "512": not supported. Accepted: 2K, 4K
 *
 * — which is what the old panel produced for every model whose tiers were not
 * the invented `1K/2K` the catalog fell back to. A dial the model never
 * advertised is worse: OpenRouter answers 200 and ignores it, so the control
 * looked like it worked and the user paid for a result that never saw it.
 *
 * What is here is now the complete set the endpoints take. Image:
 * aspect_ratio, resolution, quality, output_format, background,
 * output_compression, n, seed, input_references. Video: resolution,
 * aspect_ratio, size, duration, frame_images, input_references, generate_audio,
 * seed. Audio: voice, speed, response_format, instructions.
 */
import type { ReactNode } from 'react';
import { Dices, ImagePlus, X } from 'lucide-react';
import { AspectRatioSelector } from './AspectRatioSelector';
import type { MediaKind, ModelCapability } from '../../api/imagine';
import type { GenerationParams } from '../../hooks/useImagineStudio';
import { cn } from '../../lib/utils';

interface Props {
  kind: MediaKind;
  model: ModelCapability | null;
  params: GenerationParams;
  onChange: (patch: Partial<GenerationParams>) => void;
}

const INPUT_CLASS =
  'w-full px-3 py-2 text-xs bg-muted/30 border border-border/50 rounded-lg outline-none ' +
  'focus:border-primary/50 transition-colors';

/** Which frame slot reads as what. The API spells them `first_frame`/`last_frame`. */
const FRAME_LABELS: Record<string, string> = {
  first_frame: 'Start frame',
  last_frame: 'End frame',
};

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          {label}
        </label>
        {hint && <span className="text-[11px] text-primary font-medium">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ChipRow<T extends string | number>({
  options,
  value,
  onSelect,
  format,
}: {
  options: T[];
  value: T | undefined;
  onSelect: (next: T) => void;
  format?: (option: T) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(option => (
        <button
          key={String(option)}
          type="button"
          onClick={() => onSelect(option)}
          className={cn(
            'px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors',
            value === option
              ? 'bg-primary/10 border-primary/50 text-primary'
              : 'border-border/50 text-muted-foreground hover:bg-muted/60',
          )}
        >
          {format ? format(option) : String(option)}
        </button>
      ))}
    </div>
  );
}

/**
 * A list of image urls the model may use as references.
 *
 * Urls rather than uploads on purpose: `input_references` takes an http(s) url
 * or a data URI, and nothing on the server fetches what is pasted here — it
 * goes to OpenRouter exactly as given. An upload pipeline would be a second
 * store of user media for a field that does not need one.
 */
function UrlList({
  urls,
  max,
  onChange,
  placeholder,
}: {
  urls: string[];
  max: number;
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-1.5">
      {urls.map((url, i) => (
        <div key={i} className="flex gap-1.5">
          <input
            value={url}
            onChange={e => onChange(urls.map((u, j) => (j === i ? e.target.value : u)))}
            placeholder={placeholder}
            className={INPUT_CLASS}
          />
          <button
            type="button"
            onClick={() => onChange(urls.filter((_, j) => j !== i))}
            title="Remove"
            className="px-2.5 rounded-lg border border-border/50 text-muted-foreground hover:bg-muted/60 transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      ))}
      {urls.length < max && (
        <button
          type="button"
          onClick={() => onChange([...urls, ''])}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-dashed border-border/60 text-muted-foreground hover:bg-muted/60 transition-colors"
        >
          <ImagePlus size={12} />
          Add reference {urls.length > 0 && `(${urls.length}/${max})`}
        </button>
      )}
    </div>
  );
}

export function GenerationControls({ kind, model, params, onChange }: Props) {
  if (!model) {
    return (
      <p className="text-xs text-muted-foreground">
        Select a model to see the options it supports.
      </p>
    );
  }

  // Long ratio lists (some models advertise 17) are trimmed to the common ones
  // plus whatever is currently selected, so the panel stays readable.
  const COMMON_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];
  const ratios = (model.aspect_ratios ?? []).filter(
    r => COMMON_RATIOS.includes(r) || r === params.aspectRatio,
  );
  const maxReferences = model.max_references ?? 0;
  const frameSlots = model.frame_slots ?? [];
  const compression = model.output_compression;
  const batch = model.batch;
  const speedRange = model.speed_range ?? { min: 0.5, max: 2 };
  // Compression only applies to the lossy formats; the API accepts it beside
  // png and ignores it, which is the failure this panel exists to avoid.
  const compressible = ['jpeg', 'jpg', 'webp'].includes((params.outputFormat ?? '').toLowerCase());

  const setFrame = (slot: string, url: string) => {
    const rest = params.frameImages.filter(f => f.frame_type !== slot);
    onChange({ frameImages: url ? [...rest, { url, frame_type: slot }] : rest });
  };

  return (
    <div className="space-y-6">
      {kind !== 'audio' && ratios.length > 0 && (
        <Field label="Aspect ratio">
          <AspectRatioSelector
            options={ratios}
            value={params.aspectRatio}
            onChange={aspectRatio => onChange({ aspectRatio })}
          />
        </Field>
      )}

      {kind !== 'audio' && (model.resolutions?.length ?? 0) > 0 && (
        <Field label={kind === 'video' ? 'Resolution' : 'Size'}>
          <ChipRow
            options={model.resolutions!}
            value={params.resolution}
            onSelect={resolution => onChange({ resolution })}
          />
        </Field>
      )}

      {kind === 'video' && (model.sizes?.length ?? 0) > 0 && (
        <Field label="Exact size" hint="pixels">
          <ChipRow
            options={model.sizes!}
            value={params.size}
            onSelect={size => onChange({ size })}
          />
        </Field>
      )}

      {kind === 'image' && (model.qualities?.length ?? 0) > 0 && (
        <Field label="Quality">
          <ChipRow
            options={model.qualities!}
            value={params.quality}
            onSelect={quality => onChange({ quality })}
          />
        </Field>
      )}

      {kind === 'image' && (model.output_formats?.length ?? 0) > 0 && (
        <Field label="File format">
          <ChipRow
            options={model.output_formats!}
            value={params.outputFormat}
            onSelect={outputFormat => onChange({ outputFormat })}
          />
        </Field>
      )}

      {kind === 'image' && (model.backgrounds?.length ?? 0) > 0 && (
        <Field label="Background">
          <ChipRow
            options={model.backgrounds!}
            value={params.background}
            onSelect={background => onChange({ background })}
          />
        </Field>
      )}

      {kind === 'image' && compression && compressible && (
        <Field label="Compression" hint={`${params.outputCompression ?? compression.max}`}>
          <input
            type="range"
            min={compression.min}
            max={compression.max}
            step={1}
            value={params.outputCompression ?? compression.max}
            onChange={e => onChange({ outputCompression: Number(e.target.value) })}
            className="w-full accent-primary"
          />
        </Field>
      )}

      {kind === 'image' && batch && batch.max > 1 && (
        <Field label="Images per run" hint={`${params.batchSize ?? batch.min}`}>
          <ChipRow
            options={Array.from(
              { length: batch.max - batch.min + 1 },
              (_, i) => batch.min + i,
            )}
            value={params.batchSize}
            onSelect={batchSize => onChange({ batchSize })}
          />
        </Field>
      )}

      {kind === 'video' && (model.durations?.length ?? 0) > 0 && (
        <Field label="Length">
          <ChipRow
            options={model.durations!}
            value={params.duration}
            onSelect={duration => onChange({ duration })}
            format={d => `${d}s`}
          />
        </Field>
      )}

      {kind === 'video' && model.supports_audio && (
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={params.generateAudio}
            onChange={e => onChange({ generateAudio: e.target.checked })}
            className="accent-primary h-4 w-4"
          />
          <span className="text-xs font-medium">Generate audio track</span>
        </label>
      )}

      {maxReferences > 0 && (
        <Field
          label={kind === 'video' ? 'Reference images' : 'Reference images'}
          hint={`up to ${maxReferences}`}
        >
          <UrlList
            urls={params.referenceUrls}
            max={maxReferences}
            onChange={referenceUrls => onChange({ referenceUrls })}
            placeholder="https://… or a data: URI"
          />
        </Field>
      )}

      {kind === 'video' &&
        frameSlots.map(slot => (
          <Field key={slot} label={FRAME_LABELS[slot] ?? slot} hint="optional">
            <input
              value={params.frameImages.find(f => f.frame_type === slot)?.url ?? ''}
              onChange={e => setFrame(slot, e.target.value)}
              placeholder="Image url the clip should start or end on"
              className={INPUT_CLASS}
            />
          </Field>
        ))}

      {kind === 'audio' && (model.voices?.length ?? 0) > 0 && (
        <Field label="Voice">
          <ChipRow
            options={model.voices!}
            value={params.voice}
            onSelect={voice => onChange({ voice })}
          />
        </Field>
      )}

      {kind === 'audio' && (model.voices?.length ?? 0) === 0 && (
        <Field label="Voice" hint="optional">
          <input
            value={params.voice ?? ''}
            onChange={e => onChange({ voice: e.target.value })}
            placeholder="Provider voice id — leave blank for the default"
            className={INPUT_CLASS}
          />
        </Field>
      )}

      {kind === 'audio' && model.supports_speed && (
        <Field label="Speed" hint={`${params.speed.toFixed(2)}×`}>
          <input
            type="range"
            min={speedRange.min}
            max={speedRange.max}
            step={0.05}
            value={params.speed}
            onChange={e => onChange({ speed: parseFloat(e.target.value) })}
            className="w-full accent-primary"
          />
        </Field>
      )}

      {kind === 'audio' && model.supports_instructions && (
        <Field label="Delivery" hint="optional">
          <input
            value={params.instructions}
            onChange={e => onChange({ instructions: e.target.value })}
            placeholder="Speak warmly and unhurried, like a documentary narrator"
            className={INPUT_CLASS}
          />
        </Field>
      )}

      {kind === 'audio' && (model.response_formats?.length ?? 0) > 1 && (
        <Field
          label="Audio format"
          hint={params.responseFormat === 'pcm' ? 'raw — downloads' : 'plays inline'}
        >
          <ChipRow
            options={model.response_formats!}
            value={params.responseFormat}
            onSelect={responseFormat => onChange({ responseFormat })}
          />
        </Field>
      )}

      {kind !== 'audio' && (
        <Field label="Negative prompt" hint="optional">
          <textarea
            value={params.negativePrompt}
            onChange={e => onChange({ negativePrompt: e.target.value })}
            placeholder="What to avoid — text, watermarks, blur…"
            className="w-full min-h-[80px] p-3 text-xs bg-muted/30 border border-border/50 rounded-lg outline-none focus:border-primary/50 transition-colors resize-none leading-relaxed"
          />
        </Field>
      )}

      {model.supports_seed && (
        <Field label="Seed">
          <div className="flex gap-2">
            <input
              value={params.seed}
              onChange={e => onChange({ seed: e.target.value.replace(/[^0-9]/g, '') })}
              placeholder="Random"
              inputMode="numeric"
              className={cn(INPUT_CLASS, 'flex-1')}
            />
            <button
              type="button"
              onClick={() => onChange({ seed: String(Math.floor(Math.random() * 1_000_000)) })}
              title="Randomize seed"
              className="px-3 rounded-lg border border-border/50 text-muted-foreground hover:bg-muted/60 transition-colors"
            >
              <Dices size={14} />
            </button>
          </div>
        </Field>
      )}
    </div>
  );
}
