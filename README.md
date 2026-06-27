# Stradiz Transcriber

A local, privacy-first audio transcription desktop app built on [whisper.cpp](https://github.com/ggerganov/whisper.cpp). All processing happens on your machine — no audio ever leaves your computer.

![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![Windows](https://img.shields.io/badge/Windows-x64-0078D4?logo=windows)
![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon%20%2B%20Intel-000000?logo=apple)
![Linux](https://img.shields.io/badge/Linux-AppImage%20x64-FCC624?logo=linux&logoColor=black)

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
| Linux (x64) | `Stradiz.Transcriber-x86_64.AppImage` |

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

> **Uninstalling on macOS:** Dragging the app to the Trash leaves the ~1.6 GB of downloaded engine/model data behind (macOS apps have no uninstaller). To remove it: in the app, go to **Setup → Remove downloaded data**, or delete the folder manually with `rm -rf ~/.whisper-app`, then trash the app.

### Linux (x64)

Download the `.AppImage`, make it executable, and run it:

```bash
chmod +x "Stradiz Transcriber-x86_64.AppImage"
./"Stradiz Transcriber-x86_64.AppImage"
```

First launch pulls a CPU whisper.cpp build + FFmpeg + model. Transcription runs on the CPU (no GPU acceleration on Linux yet). Files are stored in `~/.whisper-app`; **Setup → Remove downloaded data** clears them.

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

## Releasing

Releases are built by GitHub Actions (`.github/workflows/release.yml`) — no local Windows machine needed. Pushing a version tag builds the Windows `.exe` and the macOS DMGs on their native runners and attaches them to that tag's GitHub release.

### Two kinds of asset, on purpose

The app ships in two layers that version independently:

| Layer | What | Where it lives | When it changes |
|---|---|---|---|
| **Installer** | the Electron app shell (`.exe` / `.dmg`) | the release for each version tag (`v1.0.1`, …) | every app release |
| **Engine** | whisper.cpp + ffmpeg binaries + model | hosted once on the **`v1.0.0`** release | only when the engine itself changes |

`RELEASE_BASE` in `electron/main.cjs` points the in-app downloader at the **`v1.0.0`** engine assets. It deliberately does **not** track the app version — bumping the app to `v1.0.2` does not move the engine. Don't change `RELEASE_BASE` unless you re-host the engine zips somewhere else.

### Cut an app release

1. Land your changes on `main` via PR.
2. Bump the version in **`package.json`** and the About modal in **`src/App.jsx`** (one PR).
3. Tag and push — CI does the rest:
   ```bash
   git checkout main && git pull
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
4. Actions builds both OSes and attaches `Stradiz.Transcriber.Setup.exe` + the two DMGs to the `vX.Y.Z` release.

Tag the version *after* the bump is on `main` — otherwise electron-builder packages the old version number onto the new release.

### Ship a new engine (whisper / ffmpeg / model)

The app re-downloads a component only when it's missing or **out of date**, tracked per component in `~/.whisper-app/installed.json`.

1. Bump the relevant string in `CURRENT_VERSIONS` (`electron/main.cjs`).
2. Re-host the matching asset on the `v1.0.0` release (e.g. run `scripts/build-mac-whisper.sh` for whisper, then `gh release upload v1.0.0 …`).
3. On next launch, Setup shows **"Update engine"** and re-downloads only the changed component — existing installs aren't forced to refetch everything.

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
