# Read Aloud

Adds a small speaker button under each finished agent reply. Pressing it reads
the reply out loud; pressing it again stops.

## How it works

When a turn completes, the plugin adds a button row below the turn's final
reply. The reply itself is still drawn by Paseo, with its normal Markdown and
copy button.

Before speaking, the reply is turned into plain speech: code blocks are
announced as "code block", links are read as their text, and Markdown marks,
table pipes and emoji are dropped (characters inside words, like snake_case or
C#, are kept). The text is spoken a sentence or two at a time.

It is built to start fast and flow without gaps:

- The first part is kept short, so speech starts almost at once.
- Local voices are loaded as soon as a chat is open, and the first part is
  prepared when you touch the button (or hover over it for a moment on
  desktop), before the press finishes.
- The next parts are prepared while the current one plays, and each is queued
  just before the one before it ends, with the models' padding silence trimmed,
  so it sounds like one continuous reading.
- Stopping drops any parts still waiting to be prepared, so the next press
  isn't held up behind them.

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
text to the configured endpoint, only when you press (or touch) the button,
never on hover. The plugin reads the daemon config file to
pick up the voice settings and to find its own installed files.

## Limitations

- One reply is read at a time; starting another stops the current one.
- Paseo can't cut a clip off mid-way, so Stop takes effect at the end of the
  part currently playing (usually a few seconds). The button shows it is
  stopping until then.
- Reading carries on if you scroll the reply out of view.
- About 20,000 characters of a reply are read per press.
- Languages are whatever the selected Paseo voice speaks.
