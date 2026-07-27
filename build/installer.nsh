ManifestDPIAware true

!macro customUnInstall
  # On an update, electron-builder runs the OLD uninstaller silently with
  # --updated to swap in the new version. Never prompt (or delete the ~1.6 GB
  # models) in that path — only ask on a real, user-initiated uninstall.
  # Without this guard the message box has no silent default, so it blocks the
  # silent update-uninstall and the in-place update stalls.
  ${ifNot} ${isUpdated}
    IfSilent skipWhisperData
    MessageBox MB_YESNO|MB_ICONQUESTION "Also delete downloaded models and binaries (~1.6 GB) from $PROFILE\.whisper-app?$\n$\nChoose No to keep them for a future reinstall." /SD IDNO IDNO skipWhisperData
      RMDir /r "$PROFILE\.whisper-app"
    skipWhisperData:
  ${endIf}
!macroend
