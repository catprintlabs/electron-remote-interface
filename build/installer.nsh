!macro customInstall
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ElectronRemoteInterface" "$INSTDIR\Electron Remote Interface.exe"
!macroend

!macro customUninstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ElectronRemoteInterface"
!macroend
