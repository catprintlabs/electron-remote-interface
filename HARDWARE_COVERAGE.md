# Hardware Coverage Audit

Comparison of hardware/OS access in `production_electron` vs what is implemented
in `electron-remote-interface`.

Source app audited: `/Users/mitchvanduyn/catprintlabs/production_electron`

---

## Covered

| Production App | Method | Our API |
|---|---|---|
| USB weight scale (mtbc-reader / node-hid) | USB HID, VID 3768 PID 61440 | `GET /scale/status`, `GET /scale/weight`, `WS /scale/stream` |
| Printers — tickets & labels | `lpr` (macOS/Linux), `pdfprint.exe` (Windows) | `POST /printers/print`, `POST /printers/print-text`, `GET /printers/list` |
| Filesystem — read, write, append, delete, list, stat, mkdir, move | Node.js `fs` module | Full `/fs/*` suite |
| Serial ports | `serialport` npm package | Full `/serial/*` suite (added proactively — not in production app) |

---

## Gap — iGen Hot Folder (Network Share Copy)

The production app has a second, separate print path used for the **iGen press**.
Rather than sending to a print spooler, it downloads a PDF and copies it directly
to a **network share folder** (UNC path) from which the iGen picks up the job:

- **Source**: `{userData}/print_queue/{job_id}.pdf` (downloaded from API)
- **Destination**: `{job[:printer_path]}/{job[:free_flow_queue]}/{job[:full_job_name]}`
  - e.g. `\\printer-server\print_queue\jobname.pdf`
- **Method**: Node.js file stream pipe (`from.pipe(to)`)
- **Implemented in**: `app/hyperstack/components/stations/print_queue/job_fetcher.rb`

Our `/fs/write` endpoint is constrained to the configured `rootDir` and does not
support writing to arbitrary UNC/network paths.

### Solution implemented: `/fs/copy-to-network`

A dedicated endpoint accepts an absolute destination path (UNC or otherwise)
outside of rootDir. This keeps the rootDir safety constraint intact for general
filesystem access while explicitly allowing network share writes through a
separate, clearly-named route.

```
POST /fs/copy-to-network
Body: { "from": "relative/path/in/rootDir.pdf", "to": "\\\\server\\share\\folder\\file.pdf" }
```

- `from` is resolved against rootDir and blocked from traversal (403 on `..` escape)
- `to` must be an absolute path; destination directories are created automatically
- Returns `{ ok: true }` on success

**Status: implemented and tested** (`server/routes/filesystem.js`, `tests/api.test.js`)

---

## Disabled / Not Applicable

| Feature | Notes |
|---|---|
| Windows native API (`winApi.js`) | `ffi-napi` bindings for `user32.dll` — commented out in `main.js`, never active |
| Global keyboard shortcuts (F5, Ctrl+R, F11) | Dev/reload shortcuts — UI only, not needed in new architecture |
| `electron-config` persistence | Replaced by our `lib/config.js` |
| S3/AWS update downloads | Replaced by `electron-updater` + GitHub Releases |
| Rollbar error reporting | Not carried over — can be added independently if needed |
