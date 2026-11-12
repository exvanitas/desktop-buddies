; Desktop Buddies' one hook into Tauri's NSIS installer, added by installer.py for its build only.
;
; A setup run over an older install (winget's upgrade runs it with /S, and in silent mode the template
; never offers to uninstall first) copies the new files over the old ones, so a file the new version
; dropped would stay in app. This replaces the app folder whole instead. It closes the app first, as the
; template does just after this hook, and only where the folder is plainly an install of ours: the exe,
; its uninstaller and app\hub.html all there. Nothing else is touched: no registry value, nothing in
; %APPDATA%, no uninstaller run.
!macro NSIS_HOOK_PREINSTALL
  ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
  ${AndIf} ${FileExists} "$INSTDIR\uninstall.exe"
  ${AndIf} ${FileExists} "$INSTDIR\app\hub.html"
    !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
    RMDir /r "$INSTDIR\app"
  ${EndIf}
!macroend
