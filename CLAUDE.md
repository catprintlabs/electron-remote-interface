# electron-remote-interface — project context

Electron app that exposes local hardware over HTTP/WebSocket for ~10 internal
Windows PCs at catprint.com. All business logic lives in the Rails app; this is
a thin hardware-access layer only.

## Current version

`v1.0.0-alpha.9` — live on GitHub Releases as a single Windows installer.

## What's implemented

| Endpoint | Notes |
|---|---|
| `GET /fs/list,read,download,stat,write,append,mkdir,move,delete` | rootDir-constrained via safePath() |
| `POST /fs/copy-to-network` | copies rootDir file to absolute/UNC path (iGen hot-folder) |
| `GET /printers/list` | PowerShell Get-Printer on Windows, lpstat on Mac |
| `POST /printers/print` | multipart upload → pdfprint.exe |
| `POST /printers/print-text` | plain text → pdfprint.exe |
| `POST /printers/print-url` | downloads URL to temp file → pdfprint.exe ✓ tested working |
| `GET,WS /scale/status,weight,stream` | USB HID MTBC scale (VID 3768 / PID 61440) |
| `GET,WS /serial/list,status,open,close,write,read,stream` | serialport npm package |

All print endpoints accept: `printer, copies, duplex (none|long|short), color (auto|color|mono), scale (none|fit), page-size, doc-name`

## Binary dependencies (Windows, bundled in installer)

- **pdfprint.exe** + **gs/** (Ghostscript) — downloaded from `catprintlabs/pdfprint` latest release at CI build time
- **cloudflared.exe** — downloaded from `cloudflare/cloudflared` latest release at CI build time

Both land in `resources/bin/` inside the installer. `bin/` is gitignored.

## Releasing

```bash
npm run release 1.0.0-alpha.X
# CI builds Windows installer automatically (~5 min)
# Then publish the draft release:
gh release edit vX.X.X --draft=false --title "vX.X.X" --notes "..."
```

electron-updater checks for updates on app startup. When a new version is
downloaded, a green banner appears in the app UI with a "Restart Now" button.

## Architecture notes

- `main.js` — Electron main process; reads `bin/pdfprint-version.txt` at startup for version display
- `server/` — Express HTTP server; started via IPC from main process
- `server/lib/scale-reader.js` — USB HID polling loop; `simulate(weightLb)` available in dev mode
- `lib/config.js` — persists config to userData (port, security mode, tunnel)
- `bin/` — populated by CI only; empty in git (`.gitkeep`)
- `binDir` = `resources/bin` when packaged, `__dirname/bin` when running from source

## Dev mode extras

- Scale simulator input in the GUI (enter a weight in lb, fires the WebSocket)
- `npm test` — 118 tests covering all HTTP endpoints and scale byte math

## GitHub

- Repo: `catprintlabs/electron-remote-interface` (public)
- CI: `.github/workflows/build.yml` — Windows only; Mac runs from source for dev
- Auto-update provider: GitHub Releases (`latest.yml`)
