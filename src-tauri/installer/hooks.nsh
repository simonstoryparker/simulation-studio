!macro STUDIO_REQUIRE_STOPPED
  ; The updater exits Studio before invoking setup. Manual setup must not kill a simulation.
  ; Use PowerShell directly: cmd.exe quoting can otherwise hide a failed process check.
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "if (Get-Process -Name simulation-studio -ErrorAction SilentlyContinue) { exit 10 } else { exit 0 }"'
  Pop $0
  Pop $1
  ${If} $0 != "0"
    MessageBox MB_OK|MB_ICONEXCLAMATION "Close Simulation Studio before installing or updating it. If this message persists, verify that Windows PowerShell is available."
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro STUDIO_REQUIRE_STOPPED
  ; NSIS updater mode skips the old uninstaller. Replace our bundled resources
  ; directory so removed package files cannot survive an upgrade. Workspaces
  ; live in AppData and are never stored here.
  ${If} ${FileExists} "$INSTDIR\resources\*.*"
    ClearErrors
    RMDir /r "$INSTDIR\resources"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Cannot replace bundled resources. Close Simulation Studio and retry setup."
      Abort
    ${EndIf}
  ${EndIf}
!macroend

; Manual setup can run the old uninstaller before its install section.
!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro STUDIO_REQUIRE_STOPPED
!macroend
