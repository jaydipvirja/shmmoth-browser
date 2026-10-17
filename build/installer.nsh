; SHMMOTH Browser — installer additions (electron-builder includes this file: package.json → build.nsis.include)
;
; Registers SHMMOTH Browser with Windows as a web browser, so it is listed in Settings → Apps → Default apps and can
; be chosen for http and https links. Windows 10/11 let only the user pick the default browser; the browser opens that
; page for them (Settings → General → Default browser, src/services/defaultBrowser.js).
;
; SHCTX is HKCU for a "just me" installation and HKLM for "anyone who uses this computer".
; The link is passed after "--", so nothing in it can be read as a command-line switch (Electron advisory
; CVE-2018-1000006); src/utils/launchArgs.js then accepts only http(s) addresses.

!define SHMMOTH_CLIENT "SHMMOTH Browser"
!define SHMMOTH_PROGID "SHMMOTHURL"
!define SHMMOTH_CLIENT_KEY "Software\Clients\StartMenuInternet\${SHMMOTH_CLIENT}"

!macro customInstall
  ; the browser entry
  WriteRegStr SHCTX "${SHMMOTH_CLIENT_KEY}" "" "${SHMMOTH_CLIENT}"
  WriteRegStr SHCTX "${SHMMOTH_CLIENT_KEY}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "${SHMMOTH_CLIENT_KEY}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  WriteRegStr SHCTX "${SHMMOTH_CLIENT_KEY}\Capabilities" "ApplicationName" "${SHMMOTH_CLIENT}"
  WriteRegStr SHCTX "${SHMMOTH_CLIENT_KEY}\Capabilities" "ApplicationDescription" "Fast, private web browser with a built-in ad blocker."
  WriteRegStr SHCTX "${SHMMOTH_CLIENT_KEY}\Capabilities" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "${SHMMOTH_CLIENT_KEY}\Capabilities\StartMenu" "StartMenuInternet" "${SHMMOTH_CLIENT}"
  WriteRegStr SHCTX "${SHMMOTH_CLIENT_KEY}\Capabilities\URLAssociations" "http" "${SHMMOTH_PROGID}"
  WriteRegStr SHCTX "${SHMMOTH_CLIENT_KEY}\Capabilities\URLAssociations" "https" "${SHMMOTH_PROGID}"
  WriteRegStr SHCTX "Software\RegisteredApplications" "${SHMMOTH_CLIENT}" "${SHMMOTH_CLIENT_KEY}\Capabilities"

  ; what Windows runs for a link once the user has chosen SHMMOTH
  WriteRegStr SHCTX "Software\Classes\${SHMMOTH_PROGID}" "" "SHMMOTH Browser link"
  WriteRegStr SHCTX "Software\Classes\${SHMMOTH_PROGID}\Application" "ApplicationName" "${SHMMOTH_CLIENT}"
  WriteRegStr SHCTX "Software\Classes\${SHMMOTH_PROGID}\Application" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\${SHMMOTH_PROGID}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\${SHMMOTH_PROGID}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" -- "%1"'

  ; tell Explorer the associations changed
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "${SHMMOTH_CLIENT_KEY}"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "${SHMMOTH_CLIENT}"
  DeleteRegKey SHCTX "Software\Classes\${SHMMOTH_PROGID}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
