# `voice/`: speech to text and text to speech

Behind the `transcribe_audio` and `text_to_speech` tools (`chat/tools/voice.py`)
and the chat mic (`POST /api/chat/transcribe/`, in `chat/views.py`).
Not a Django app: no models, no URLs.

Speech to text is **on by default** through OpenRouter on the platform key
(`STT_ENGINE=openrouter`, model `STT_MODEL`). Text to speech is **off** until
`TTS_ENGINE` is set.

| File | What it does |
|---|---|
| `stt.py` | Speech to text, chosen by `STT_ENGINE` (`openrouter`, `none`, or a remote URL) |
| `tts.py` | Text to speech, chosen by `TTS_ENGINE` |
