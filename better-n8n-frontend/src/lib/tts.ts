/**
 * Speech defaults the Settings page offers.
 *
 * Mirrors `Backend/imagine/services/catalog.py::TTS_MODELS` (OpenRouter has
 * no discovery endpoint for speech models, so the list is curated on both
 * sides). `voices: []` means the model takes a free-form voice id (Kokoro,
 * Qwen, Grok) — rendered as a text field; a non-empty list renders as chips.
 * Blank model/voice everywhere means the platform default (Kokoro + af_heart,
 * see `voice/tts.py::DEFAULT_TTS_*`).
 */

export interface TtsModel {
  id: string;
  name: string;
  description: string;
  voices: string[];
}

export const TTS_MODELS: TtsModel[] = [
  {
    id: 'google/gemini-3.8-flash-tts',
    name: 'Gemini 3.8 Flash TTS',
    description: 'Best-rated voice. Expressive, multi-speaker capable.',
    voices: ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede'],
  },
  {
    id: 'qwen/qwen-audio-3.0-tts-plus',
    name: 'Qwen-Audio-3.0-TTS Plus',
    description: 'Close second; strong on Chinese and mixed-language text.',
    voices: [],
  },
  {
    id: 'google/gemini-3.8-flash-lite-tts',
    name: 'Gemini 3.8 Flash-Lite TTS',
    description: 'Cheaper, faster sibling of Flash TTS.',
    voices: ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede'],
  },
  {
    id: 'x-ai/grok-voice-tts-1.0',
    name: 'Grok Voice TTS',
    description: 'Conversational delivery from xAI.',
    voices: [],
  },
  {
    id: 'microsoft/mai-voice-2-flash',
    name: 'MAI-Voice-2 Flash',
    description: 'Expressive 24 kHz speech, 15 languages.',
    voices: ['en-US-Harper:MAI-Voice-2', 'en-US-Aria:MAI-Voice-2'],
  },
  {
    id: 'hexgrad/kokoro-82m',
    name: 'Kokoro 82M (platform default)',
    description: 'Small open-weight TTS — by far the cheapest, for bulk narration.',
    voices: [],
  },
];

export function ttsVoices(modelId: string): string[] {
  return TTS_MODELS.find((m) => m.id === modelId)?.voices ?? [];
}
