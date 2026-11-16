# `voice/`: speech to text and text to speech

The user sees this as the chat microphone (speech to text) and the speaker
button on a reply (text to speech). The matching tools are `transcribe_audio`
and `text_to_speech` (`chat/tools/voice.py`). Not a Django app: no models, no URLs.
The chat endpoints are `POST /api/chat/transcribe/` (`chat/views.py`) and
`POST /api/chat/speak/`.

Both default to OpenRouter on the platform key, so they work without any
setup, as long as `OPENROUTER_API_KEY` is set.

| Setting | Default | Turns off |
|---|---|---|
| `STT_ENGINE` (+ `STT_MODEL`) | `openrouter` | `none` |
| `TTS_ENGINE` | `openrouter` | `none` |

## Files

| File | What it does |
|---|---|
| `stt.py` | Speech to text, chosen by `STT_ENGINE`: `openrouter`, `none`, or a remote endpoint |
| `tts.py` | Text to speech, chosen by `TTS_ENGINE`. `resolve_voice()` picks the model and voice for every caller |

## Rules

- Which speech model and voice is used is decided in one place, `tts.resolve_voice()`: the call, then the user's saved choice, then the default.
- A saved voice is used only with the model it belongs to.

## Tests

`chat/tests/test_transcribe.py`, `chat/tests/test_speak.py`, `chat/tests/test_voice.py`.
