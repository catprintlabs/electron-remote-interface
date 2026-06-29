# PDF Printing Migration Plan

Source: `/Users/mitchvanduyn/catprintlabs/production_electron`
Target: `/Users/mitchvanduyn/catprintlabs/electron-remote-interface`

## What We're Porting

The production app uses **PDFtoPrinter.exe** for Windows PDF printing.

- Windows command: `"path/to/PDFtoPrinter.exe" "path/to/file.pdf" "PrinterName"`
- macOS/Linux command: `lpr -P PrinterName path/to/file.pdf` (unchanged — current implementation is correct)

---

## Steps

### 1. Copy the Binary

Copy `PDFtoPrinter.exe` from the production app into this project:

```
FROM: /Users/mitchvanduyn/catprintlabs/production_electron/bin/PDFtoPrinter.exe
TO:   /Users/mitchvanduyn/catprintlabs/electron-remote-interface/bin/PDFtoPrinter.exe
```

Size: ~9.5MB

---

### 2. Update `package.json` — Bundle Binary in Windows Build

Add `bin/PDFtoPrinter.exe` to `extraResources` so electron-builder includes it in the Windows installer:

```json
"extraResources": [
  {
    "from": ".env.example",
    "to": ".env.example"
  },
  {
    "from": "bin/PDFtoPrinter.exe",
    "to": "bin/PDFtoPrinter.exe"
  }
]
```

This places the binary at `resources/bin/PDFtoPrinter.exe` inside the packaged app.

---

### 3. Update `main.js` — Compute Binary Path

Add `binDir` computation and pass it to `startServer`. The path differs between dev and packaged builds:

- **Development**: `<project-root>/bin/PDFtoPrinter.exe`  
- **Packaged**: `<app>/resources/bin/PDFtoPrinter.exe` (via `process.resourcesPath`)

Pass `binDir` into `startServer(...)` alongside the existing options.

---

### 4. Update `server/index.js` — Accept and Forward `binDir`

Update `startServer({ port, rootDir, security, onLog, binDir })` to accept the new parameter and forward it to the printer router:

```js
app.use('/printers', printerRoutes(binDir));
```

---

### 5. Update `server/routes/printers.js` — Replace Windows Print Function

Replace the current `printFileWindows` (which uses `Start-Process -Verb Print`) with one that uses PDFtoPrinter.exe:

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

Update `printerRouter()` to accept `binDir` as a parameter and thread it through.

---

## Files Changed

| File | Change |
|------|--------|
| `bin/PDFtoPrinter.exe` | **New** — copied from production_electron |
| `package.json` | Add `bin/PDFtoPrinter.exe` to `extraResources` |
| `main.js` | Compute `binDir`, pass to `startServer` |
| `server/index.js` | Accept `binDir`, pass to `printerRoutes()` |
| `server/routes/printers.js` | Replace `printFileWindows` with PDFtoPrinter.exe implementation |

## Files NOT Changed

- `printFilePosix` — `lpr -P` is correct on macOS/Linux, no change needed
- All filesystem, serial, and security code — untouched
- All tests — no print behaviour tests currently exist for Windows path

---

## Notes

- The macOS `lpr` implementation stays as-is (it already works)
- PDFtoPrinter.exe is Windows-only; on macOS/Linux the binary is ignored
- The `binDir` is only used on `win32` platform at runtime
- No new npm dependencies required
