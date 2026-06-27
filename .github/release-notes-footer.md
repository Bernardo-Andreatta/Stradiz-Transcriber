## Which build do I download?

| Your machine | Download |
|---|---|
| **Windows 10/11** (64-bit) | `Stradiz.Transcriber.Setup.exe` |
| **Mac — Apple Silicon** (M1/M2/M3/M4) | `Stradiz.Transcriber-arm64.dmg` |
| **Mac — Intel** | `Stradiz.Transcriber-x64.dmg` |

**Not sure which Mac?**  Apple menu → **About This Mac**. "Apple M…" → `arm64`. "Intel" → `x64`.

## First launch

No manual setup. On first run the app downloads the right engine + FFmpeg + the large-v3-turbo model (~1.6 GB), then runs fully offline. A GPU is used automatically — Metal on Mac, Vulkan (NVIDIA/AMD) on Windows.

## Opening it the first time

Not code-signed yet, so the OS warns once:

- **macOS** — if you see **"is damaged" / "unidentified developer"**: drag the app to **Applications**, then **right-click → Open → Open**. If there's no Open button, run:
  `xattr -dr com.apple.quarantine "/Applications/Stradiz Transcriber.app"`
- **Windows** — "Windows protected your PC": **More info → Run anyway**.

You only do this once. More fixes in the [README troubleshooting](https://github.com/Bernardo-Andreatta/Stradiz-Transcriber#troubleshooting).

Files are stored in `~/.whisper-app` (macOS) / `%USERPROFILE%\.whisper-app` (Windows).
