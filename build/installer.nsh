ManifestDPIAware true

!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION "Also delete downloaded models and binaries (~1.6 GB) from $PROFILE\.whisper-app?$\n$\nChoose No to keep them for a future reinstall." IDNO skipWhisperData
    RMDir /r "$PROFILE\.whisper-app"
  skipWhisperData:
!macroend
