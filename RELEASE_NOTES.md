# Release notes

## ⚠️ Known issues (all versions)

### Windows may block the app or the transcription engine (unsigned build)

The app and its bundled/downloaded binaries are **not code-signed yet**, so Windows security may flag or block them:

- **SmartScreen** (on install): *"Windows protected your PC"* → **More info → Run anyway**.
- **Smart App Control** (Windows 11, if enabled): transcription may fail to start with *"An Application Control policy has blocked this file."* Smart App Control blocks **unsigned executables outright**. Allow it via **Windows Security → App & browser control → Smart App Control**, or add `%USERPROFILE%\.whisper-app\` as a security exclusion.
  - ⚠️ Smart App Control can only be turned **off**, not back on, without resetting Windows.

**macOS:** the app isn't notarized — first launch requires **right-click → Open** (see README → Troubleshooting).

The permanent fix for both is code-signing / notarization (Azure Trusted Signing or a Microsoft Store MSIX build on Windows; Apple notarization on macOS). Tracked, not yet in place.

---

## Unreleased

- **Batch queue** — files now accumulate in a queue (add via browse or drag-and-drop); remove individual files or clear all, then transcribe the whole queue in one run.
- **Graceful engine-launch failures** — if the transcription engine can't start (e.g. blocked by Smart App Control/antivirus, or missing), the app now shows a clear error and stays responsive instead of freezing on "Transcribing…" with a dead Stop button.

## 1.0.8

- Baseline release. See the Git history for details.
