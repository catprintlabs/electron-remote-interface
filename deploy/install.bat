@echo off
setlocal

echo Installing Electron Remote Interface...

:: Run the installer silently
for %%f in ("%~dp0electron-remote-interface-setup*.exe") do set INSTALLER=%%f
if not defined INSTALLER (
    echo ERROR: Installer not found on this drive.
    pause
    exit /b 1
)

"%INSTALLER%" /S
if errorlevel 1 (
    echo ERROR: Installation failed.
    pause
    exit /b 1
)

:: Create config directory and copy config
set CONFIG_DIR=%APPDATA%\electron-remote-interface
if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"
copy /Y "%~dp0config.json" "%CONFIG_DIR%\config.json" >nul

:: Add to Windows startup so it runs automatically on login
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" ^
    /v "ElectronRemoteInterface" ^
    /t REG_SZ ^
    /d "\"%LOCALAPPDATA%\Programs\Electron Remote Interface\Electron Remote Interface.exe\"" ^
    /f >nul

echo.
echo Installation complete. The app will start automatically on next login.
echo To start it now, open: %LOCALAPPDATA%\Programs\Electron Remote Interface\
echo.
pause
