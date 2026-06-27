# Stradiz Transcriber

A local, privacy-first audio transcription desktop app built on [whisper.cpp](https://github.com/ggerganov/whisper.cpp). All processing happens on your machine — no audio ever leaves your computer.

![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![Windows](https://img.shields.io/badge/Windows-x64-0078D4?logo=windows)
![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon%20%2B%20Intel-000000?logo=apple)

## Features

- **Local transcription** — powered by whisper.cpp with the `ggml-large-v3-turbo` model
- **GPU acceleration** — Windows: auto-detects NVIDIA / AMD via Vulkan (CPU fallback). macOS: Metal on every Mac (Apple Silicon + Intel)
- **Silence removal** — optional FFmpeg preprocessing to skip dead air before transcription
- **Hallucination recovery** — detects and auto-skips repeated-line hallucinations, resumes from the next segment until the file ends or you cancel
- **Subtitle catalog** — browse, play, and edit all transcribed files in one place
- **Editable subtitles** — double-click any line to edit; insert new lines between existing ones
- **SRT + TXT export** — saves both formats side-by-side whenever you edit
- **Import existing transcriptions** — bring in audio + SRT pairs you already have
- **Self-contained setup** — downloads whisper.cpp, FFmpeg, and the model automatically on first launch

## Installation

Download the latest build for your OS from the [Releases](../../releases) page. No dependencies to install manually — the app downloads the right whisper.cpp engine, FFmpeg, and the model on first launch (~1.6 GB), then runs fully offline.

### Windows

Download and run `Stradiz Transcriber Setup.exe`. First launch pulls the Vulkan-accelerated whisper.cpp build + FFmpeg + model.

> **SmartScreen warning:** Because the installer isn't code-signed yet, Windows may show "Windows protected your PC". Click **More info → Run anyway** to proceed — the app is safe.

> Files are stored in `%USERPROFILE%\.whisper-app` and preserved across uninstalls. The uninstaller offers to delete them for a clean removal.

### macOS (Apple Silicon + Intel)

Download the `.dmg` (`Stradiz Transcriber-arm64.dmg` for Apple Silicon, `-x64.dmg` for Intel), open it, and drag the app to Applications. First launch pulls a universal Metal whisper.cpp build + FFmpeg + model.

> **Gatekeeper warning:** The app isn't notarized yet, so macOS will say it "can't be opened because Apple cannot check it for malware." Right-click the app → **Open** → **Open** (only needed once). Alternatively: `xattr -dr com.apple.quarantine "/Applications/Stradiz Transcriber.app"`.

> Files are stored in `~/.whisper-app`.

## Usage

1. Go to **Transcribe**, click the drop zone to select any audio or video file (mp3, mp4, m4a, wav, mkv…)
2. Optionally toggle silence removal and choose an output folder
3. Click **Start Transcription** — progress appears in real time
4. When done, the app switches to **Catalog** automatically
5. Click any entry to play the audio with synchronized subtitles
6. Double-click a subtitle line to edit it; click **Save edits** when done

## Development

**Prerequisites:** Node.js 20+, Git. Builds on Windows and macOS.

```bash
git clone https://github.com/Bernardo-Andreatta/Stradiz-Transcriber.git
cd Stradiz-Transcriber
npm install
npm run start        # launches Vite dev server + Electron
```

On first run in dev mode the Setup screen downloads the whisper.cpp engine, FFmpeg, and the model to `~/.whisper-app` (same as production). Subsequent runs skip this.

**Build the installer:**

```bash
npm run dist:win     # outputs release/Stradiz Transcriber Setup.exe
npm run dist:mac     # outputs release/Stradiz Transcriber-{arm64,x64}.dmg
```

**Refresh the macOS whisper engine asset** (maintainers only — produces the universal binary the installer downloads; run once per whisper.cpp version bump, then upload to the release):

```bash
brew install cmake
./scripts/build-mac-whisper.sh           # → release/binaries/whisper-metal-bin-universal.zip
gh release upload v1.0.0 "release/binaries/whisper-metal-bin-universal.zip" \
  --repo Bernardo-Andreatta/Stradiz-Transcriber
```

## Tech stack

| Layer | Technology |
|---|---|
| Shell | Electron 42 |
| UI | React 19 + Vite |
| Icons | Lucide React |
| Transcription | whisper.cpp (ggml-large-v3-turbo) |
| Audio processing | FFmpeg |
| Packaging | electron-builder (NSIS on Windows, DMG on macOS) |

## Open-source components

- **[whisper.cpp](https://github.com/ggerganov/whisper.cpp)** — © The ggml authors — MIT License
- **[OpenAI Whisper](https://github.com/openai/whisper)** — © OpenAI — MIT License
- **[FFmpeg](https://ffmpeg.org)** — © FFmpeg contributors — LGPL v2.1+ / GPL v2+

## License

MIT — see [LICENSE](LICENSE) for details.

Built by [Stradiz](https://github.com/Bernardo-Andreatta).
