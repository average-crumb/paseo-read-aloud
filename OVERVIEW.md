# Read Aloud

Adds a speaker button to completed assistant replies in the agent timeline.
Pressing it reads the reply out loud.

## How it works

Synthesis runs in a daemon plugin subprocess using the TTS provider already
configured in Paseo's voice settings (Settings > Voice > Text to speech).
Local mode reuses the Kokoro (English) model Paseo already downloads, so there
is no extra download; OpenAI mode calls the configured OpenAI-compatible TTS
endpoint with the configured key and base URL. The resulting audio (WAV for
local mode, MP3 for OpenAI mode) is sent to the client and played through
Paseo's shared audio queue.

The plugin has no settings of its own; all behavior follows Paseo's voice
settings.

## Data

Local mode keeps everything on-device. OpenAI mode sends the reply text (capped
at 4000 characters) to the configured TTS endpoint. The plugin reads the
daemon config only to pick up the TTS settings and locate the downloaded local
model.

## Limitations

- One reply is read at a time; a second press is ignored while audio plays.
- At most about 4000 characters of the reply are read per press.
- Playback cannot be interrupted from the button.
- Local mode is English-only (Kokoro English model) and requires the local TTS
  model to be downloaded in Paseo Settings > Voice.
