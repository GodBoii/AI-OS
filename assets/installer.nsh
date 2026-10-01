; Adds Aetheria ai to the Windows "Open with" menu for common attachment types.
;
; Only OpenWithProgids entries are written, so the app is offered as a choice
; but never becomes the default program for PDFs, images or documents. The
; per-user hive (SHCTX resolves to HKCU because nsis.perMachine is false) keeps
; the installer free of elevation. The list matches OPEN_WITH_EXTENSIONS in
; js/file-open.js.

!define AETHERIA_PROGID "AetheriaAI.Attachment"

!macro AetheriaAddOpenWith EXT
  WriteRegStr SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${AETHERIA_PROGID}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" "${EXT}" ""
!macroend

!macro AetheriaRemoveOpenWith EXT
  DeleteRegValue SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${AETHERIA_PROGID}"
!macroend

!macro AetheriaForEachExtension MACRO
  !insertmacro ${MACRO} ".pdf"
  !insertmacro ${MACRO} ".png"
  !insertmacro ${MACRO} ".jpg"
  !insertmacro ${MACRO} ".jpeg"
  !insertmacro ${MACRO} ".gif"
  !insertmacro ${MACRO} ".webp"
  !insertmacro ${MACRO} ".txt"
  !insertmacro ${MACRO} ".md"
  !insertmacro ${MACRO} ".csv"
  !insertmacro ${MACRO} ".json"
  !insertmacro ${MACRO} ".docx"
  !insertmacro ${MACRO} ".xlsx"
  !insertmacro ${MACRO} ".pptx"
!macroend

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\${AETHERIA_PROGID}" "" "Aetheria ai attachment"
  WriteRegStr SHCTX "Software\Classes\${AETHERIA_PROGID}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\${AETHERIA_PROGID}\shell\open" "FriendlyAppName" "Aetheria ai"
  WriteRegStr SHCTX "Software\Classes\${AETHERIA_PROGID}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "Aetheria ai"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  !insertmacro AetheriaForEachExtension AetheriaAddOpenWith
  ; Tell Explorer the associations changed (SHCNE_ASSOCCHANGED).
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  !insertmacro AetheriaForEachExtension AetheriaRemoveOpenWith
  DeleteRegKey SHCTX "Software\Classes\${AETHERIA_PROGID}"
  DeleteRegKey SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
