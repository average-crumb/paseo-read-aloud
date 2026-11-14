# Read Aloud

Adds a small speaker button under each finished agent reply. Pressing it reads
the reply out loud; pressing it again stops.

## How it works

When a turn completes, the plugin adds a button row below the turn's final
reply. The reply itself is still drawn by Paseo, with its normal Markdown and
copy button.

Before speaking, the reply is turned into plain speech: code blocks are
announced as "code block", links are read as their text, and Markdown marks,
table pipes and emoji are dropped. The text is spoken a sentence or two at a
time, preparing the next part while the current one plays.

Speech always uses the voice Paseo's voice mode would use, chosen the same way
Paseo chooses it: voice environment variables first, then Settings > Voice >
Text to speech, then Paseo's default voice.

- Local: whichever downloaded voice is selected (Kokoro, Kokoro Lite, Kitten or
  Piper), with its speaker and speed. Voice files are located through Paseo's
  own model catalog and run by Paseo's own speech runtime, with a bundled
  WebAssembly copy as a fallback.
- OpenAI: the configured OpenAI-compatible speech endpoint, key, model and
  voice.

Audio (WAV for local, MP3 for OpenAI) is played through Paseo's shared audio
queue on the device you press it on.

## Setup

No settings of its own. For local speech, the selected voice must be downloaded
in Paseo Settings > Voice. Replies that finished before the plugin was enabled have no
button.

## Data

Local mode keeps everything on the daemon host. OpenAI mode sends the spoken
text to the configured endpoint. The plugin reads the daemon config file to
pick up the voice settings and to find its own installed files.

## Limitations

- One reply is read at a time; starting another stops the current one.
- Stop takes effect at the end of the current sentence group (about two sentences).
- About 20,000 characters of a reply are read per press.
- Languages are whatever the selected Paseo voice speaks.
