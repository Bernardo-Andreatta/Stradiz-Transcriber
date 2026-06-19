# Stradiz Transcriber

A local, privacy-first audio transcription desktop app built on [whisper.cpp](https://github.com/ggerganov/whisper.cpp). All processing happens on your machine — no audio ever leaves your computer.

![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![Windows](https://img.shields.io/badge/Windows-x64-0078D4?logo=windows)

## Features

- **Local transcription** — powered by whisper.cpp with the `ggml-large-v3-turbo` model
- **GPU acceleration** — auto-detects NVIDIA / AMD via Vulkan; falls back to CPU
- **Silence removal** — optional FFmpeg preprocessing to skip dead air before transcription
- **Hallucination recovery** — detects and auto-skips repeated-line hallucinations, resumes from the next segment until the file ends or you cancel
- **Subtitle catalog** — browse, play, and edit all transcribed files in one place
- **Editable subtitles** — double-click any line to edit; insert new lines between existing ones
- **SRT + TXT export** — saves both formats side-by-side whenever you edit
- **Import existing transcriptions** — bring in audio + SRT pairs you already have
- **Self-contained setup** — downloads whisper.cpp, FFmpeg, and the model automatically on first launch

## Installation

Download the latest installer from the [Releases](../../releases) page and run it. No dependencies to install manually — the app handles everything on first launch (~1.8 GB download: whisper.cpp binary + FFmpeg + large-v3-turbo model).

> Files are stored in `%USERPROFILE%\.whisper-app` and are preserved across uninstalls.

## Usage

1. Go to **Transcribe**, click the drop zone to select any audio or video file (mp3, mp4, m4a, wav, mkv…)
2. Optionally toggle silence removal and choose an output folder
3. Click **Start Transcription** — progress appears in real time
4. When done, the app switches to **Catalog** automatically
5. Click any entry to play the audio with synchronized subtitles
6. Double-click a subtitle line to edit it; click **Save edits** when done

## Development

**Prerequisites:** Node.js 20+, Git, Windows (the whisper.cpp binaries and installer target are Windows-only)

```bash
git clone https://github.com/Bernardo-Andreatta/Stradiz-Transcriber.git
cd Stradiz-Transcriber
npm install
npm run start        # launches Vite dev server + Electron
```

On first run in dev mode the Setup screen will download whisper.cpp, FFmpeg, and the model to `~/.whisper-app` (same as production). Subsequent runs skip this.

**Build the installer:**

```bash
npm run dist:win     # outputs release/Stradiz Transcriber Setup 1.0.0.exe
```

## Tech stack

| Layer | Technology |
|---|---|
| Shell | Electron 42 |
| UI | React 19 + Vite |
| Icons | Lucide React |
| Transcription | whisper.cpp (ggml-large-v3-turbo) |
| Audio processing | FFmpeg |
| Packaging | electron-builder (NSIS) |

## Open-source components

- **[whisper.cpp](https://github.com/ggerganov/whisper.cpp)** — © The ggml authors — MIT License
- **[OpenAI Whisper](https://github.com/openai/whisper)** — © OpenAI — MIT License
- **[FFmpeg](https://ffmpeg.org)** — © FFmpeg contributors — LGPL v2.1+ / GPL v2+

## License

MIT — see [LICENSE](LICENSE) for details.

Built by [Stradiz](https://github.com/Bernardo-Andreatta).
