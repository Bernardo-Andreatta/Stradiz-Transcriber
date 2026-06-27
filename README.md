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

### Which build do I download?

| Your machine | Download |
|---|---|
| Windows 10/11 (64-bit) | `Stradiz.Transcriber.Setup.exe` |
| Mac with Apple Silicon (M1/M2/M3/M4) | `Stradiz.Transcriber-arm64.dmg` |
| Mac with Intel processor | `Stradiz.Transcriber-x64.dmg` |

**Not sure which Mac you have?** Click the  Apple menu → **About This Mac**. If it says **Apple M1/M2/M3/M4** (or "Apple silicon"), use `arm64`. If it lists an **Intel** chip, use `x64`. (Picking the wrong one still runs, just slower under translation — but match it for best speed.)

The `whisper-*.zip` assets on the release are the engine binaries the app downloads for you. You don't download those yourself.

### Windows

Run `Stradiz.Transcriber.Setup.exe`. First launch pulls the Vulkan-accelerated whisper.cpp build + FFmpeg + model.

> **SmartScreen warning:** Because the installer isn't code-signed yet, Windows may show "Windows protected your PC". Click **More info → Run anyway** to proceed — the app is safe.

> Files are stored in `%USERPROFILE%\.whisper-app` and preserved across uninstalls. The uninstaller offers to delete them for a clean removal.

### macOS (Apple Silicon + Intel)

Open the `.dmg` and drag **Stradiz Transcriber** into the **Applications** folder. First launch pulls a universal Metal whisper.cpp build + FFmpeg + model.

> **First open — "damaged" or "unidentified developer":** The app isn't notarized yet, so macOS blocks it the first time. **Right-click (or Control-click) the app in Applications → Open → Open.** You only do this once; afterward it opens normally. See [Troubleshooting](#troubleshooting) if the dialog gives you no Open button.

> Files are stored in `~/.whisper-app`.

## Usage

1. Go to **Transcribe**, click the drop zone to select any audio or video file (mp3, mp4, m4a, wav, mkv…)
2. Optionally toggle silence removal and choose an output folder
3. Click **Start Transcription** — progress appears in real time
4. When done, the app switches to **Catalog** automatically
5. Click any entry to play the audio with synchronized subtitles
6. Double-click a subtitle line to edit it; click **Save edits** when done

## Troubleshooting

### macOS: "Stradiz Transcriber is damaged and can't be opened" (no Open button)

This happens when the app is launched straight from the `.dmg` or from Downloads while still quarantined — macOS shows the harsh version of the warning with only "Move to Trash."

1. **First, drag the app into `/Applications`** (don't run it from the disk image).
2. **Right-click the app → Open → Open.** This is the normal first-run unlock.
3. If you still get no Open button, clear the quarantine flag from Terminal:
   ```bash
   xattr -dr com.apple.quarantine "/Applications/Stradiz Transcriber.app"
   ```
   Then open it normally. (This is safe — it only removes the "downloaded from the internet" mark. The app is open-source; you can read or build it yourself.)

The lasting fix is Apple notarization, which isn't in place yet — that's the only reason the warning appears.

### Windows: "Windows protected your PC" (SmartScreen)

The installer isn't code-signed yet. Click **More info → Run anyway**.

### Setup download fails or stalls

First launch downloads ~1.6 GB (engine + FFmpeg + model). If it fails:

- Check your internet connection and click **Download & set up** again — it retries automatically and resumes from where each component left off.
- Corporate networks/VPNs sometimes block GitHub or Hugging Face downloads; try another network.
- Open the **Setup activity** log (shown during setup) to see exactly which step failed, then copy it if you need to report the issue.

### Transcription fails or quits immediately

- Re-run **Setup** — if the engine or FFmpeg download was incomplete, Setup re-fetches the missing pieces.
- Open the **Engine log** (terminal icon, top-right of the Transcribe screen) to see the ffmpeg/whisper output and the exit code.

### GPU not detected / running on CPU

- **macOS:** every Mac uses the Metal GPU automatically — no setup.
- **Windows:** GPU acceleration uses Vulkan (NVIDIA/AMD). If it falls back to CPU, update your graphics drivers. CPU still works, just slower.

### Where are my files?

Models and the engine live in `~/.whisper-app` (macOS) or `%USERPROFILE%\.whisper-app` (Windows). Deleting that folder triggers a fresh download on next launch. Your transcripts (`.srt` / `.txt`) are saved next to each source file (or your chosen output folder), not in there.

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
