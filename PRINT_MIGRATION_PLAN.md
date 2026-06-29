# PDF Printing Migration — Completed

## Status: IMPLEMENTED — Awaiting Windows smoke test

---

## Background

The original `printFileWindows` implementation used PowerShell's `Start-Process -Verb Print`
which is unreliable for PDFs on Windows (depends on default PDF viewer, often pops dialogs).

We replaced it with **PDFtoPrinter.exe**, a small Windows utility proven in production at CatPrint.

---

## Source of PDFtoPrinter.exe

**Copied from the production Electron app at:**
```
/Users/mitchvanduyn/catprintlabs/production_electron/bin/PDFtoPrinter.exe
```

That repo (`production_electron`) is a sibling directory to this project under:
```
/Users/mitchvanduyn/catprintlabs/
```

The binary is a PE32 Windows executable, ~9.5MB. It is NOT open source — it came from the
CatPrint production app. If it needs to be sourced again, check the `production_electron` repo.

**PDFtoPrinter.exe CLI usage:**
```
PDFtoPrinter.exe "path\to\file.pdf"                  # print to default printer
PDFtoPrinter.exe "path\to\file.pdf" "Printer Name"   # print to named printer
```

---

## What Was Changed

### 1. `bin/PDFtoPrinter.exe` — NEW FILE
Copied from `production_electron/bin/PDFtoPrinter.exe`.
Windows-only binary. Ignored on macOS/Linux at runtime.

### 2. `package.json`
Added to `extraResources` so electron-builder bundles it in Windows installers:
```json
{
  "from": "bin/PDFtoPrinter.exe",
  "to": "bin/PDFtoPrinter.exe"
}
```
In a packaged build this lands at `resources/bin/PDFtoPrinter.exe` inside the app.

### 3. `main.js`
Added `binDir` computation near the top of the file (after variable declarations):
```js
const binDir = app.isPackaged
  ? path.join(process.resourcesPath, 'bin')
  : path.join(__dirname, 'bin');
```
- **Dev mode** (`npm start`): resolves to `<project-root>/bin/`
- **Packaged build**: resolves to `<app>/resources/bin/`

`binDir` is passed into both `startServer(...)` calls (auto-start and manual start via IPC).

### 4. `server/index.js`
`startServer()` now accepts `binDir` and forwards it to the printer router:
```js
async function startServer({ port, rootDir, security, onLog, binDir }) {
  ...
  app.use('/printers', printerRoutes(binDir));
}
```

### 5. `server/routes/printers.js`
`printerRouter()` now accepts `binDir`. `printFileWindows` replaced:

**Before (broken on PDFs):**
```js
function printFileWindows(file, printerName) {
  const ps = printerName
    ? `Start-Process -FilePath "${file}" -Verb Print -ArgumentList "/p /h \\"${printerName}\\""`
    : `Start-Process -FilePath "${file}" -Verb Print`;
  return new Promise((resolve, reject) => {
    exec(`powershell -command "${ps}"`, (err, _stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve();
    });
  });
}
```

**After (uses PDFtoPrinter.exe):**
```js
function printFileWindows(file, printerName, binDir) {
  return new Promise((resolve, reject) => {
    const exe = path.join(binDir, 'PDFtoPrinter.exe');
    const args = printerName ? [file, printerName] : [file];
    execFile(exe, args, (err, _stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve();
    });
  });
}
```

macOS/Linux still uses `lpr -P <printer> <file>` — unchanged.

---

## How to Test on Windows (Dev Mode)

### Prerequisites
- Node.js installed (via nodejs.org or `winget install OpenJS.NodeJS`)
- Git installed (`winget install Git.Git`)
- SSH keys copied from Mac (stored in `~/.ssh/id_ed25519`)

### Steps
```powershell
# 1. Add SSH key
mkdir $HOME\.ssh
copy <thumbdrive>\id_ed25519 $HOME\.ssh\
copy <thumbdrive>\id_ed25519.pub $HOME\.ssh\

# 2. Clone the repo (get the SSH remote URL from GitHub)
git clone git@github.com:<org>/electron-remote-interface.git
cd electron-remote-interface

# 3. Install dependencies
npm install

# 4. Start the app
npm start
```

### Test the print endpoint
With the app running, send a POST to print a PDF:
```powershell
curl -X POST "http://localhost:8080/printers/print" `
  -F "file=@C:\path\to\test.pdf" `
  -F "printer=Your Printer Name"
```

Or without specifying a printer (uses Windows default):
```powershell
curl -X POST "http://localhost:8080/printers/print" `
  -F "file=@C:\path\to\test.pdf"
```

---

## Debugging Tips for the Windows Session

### Check PDFtoPrinter.exe is found
In the running app, if printing fails with "ENOENT" or "not found", the binary path is wrong.
Check that `bin\PDFtoPrinter.exe` exists relative to the project root.

### Check printer name
Get exact printer names via PowerShell:
```powershell
Get-Printer | Select-Object Name
```
Or hit the list endpoint:
```
GET http://localhost:8080/printers/list
```

### Error from PDFtoPrinter.exe itself
If `execFile` returns an error from the binary (not a path error), try running it manually:
```powershell
.\bin\PDFtoPrinter.exe "C:\path\to\test.pdf" "Printer Name"
```
This will show any error output directly.

### Check what binDir resolves to
In dev mode `binDir` = `<project-root>\bin`. Verify:
```powershell
ls .\bin\PDFtoPrinter.exe
```

---

## macOS / Linux
No changes to the macOS/Linux print path. It continues to use:
```
lpr -P "Printer Name" /path/to/file.pdf
```
