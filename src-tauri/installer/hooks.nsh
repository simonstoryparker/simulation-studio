!macro NSIS_HOOK_PREINSTALL
  ; The updater exits Studio before invoking setup. Manual setup must not kill a simulation.
  nsExec::ExecToStack '"$SYSDIR\cmd.exe" /D /C "tasklist /FI \"IMAGENAME eq simulation-studio.exe\" /NH | findstr /I /C:\"simulation-studio.exe\""'
  Pop $0
  Pop $1
  ${If} $0 == 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Close Simulation Studio before installing or updating it."
    Abort
  ${EndIf}
!macroend
