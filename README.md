# electron-remote-interface

Electron app that exposes the local machine's file system, printers, and serial ports over HTTP. Built for catprint.com internal use — allows web apps served from `*.catprint.com` to interact with local hardware and the file system via a REST API.

## Installation

### Mac

1. Download `electron-remote-interface-mac.dmg` from the releases page
2. Open the DMG and drag the app to `/Applications`
3. On first launch, macOS may block it — go to **System Settings → Privacy & Security** and click **Open Anyway**
4. Create the config file to set your security and startup options (see below)

### Windows

1. Download `electron-remote-interface-setup.exe` from the releases page
2. Run the installer — you can choose the install directory
3. The app will appear in the Start Menu as **Electron Remote Interface**
4. Create the config file to set your security and startup options (see below)

### Config file

Settings that control how the app starts. CLI flags override these when running from source.

- **Mac:** `~/Library/Application Support/electron-remote-interface/config.json`
- **Windows:** `%APPDATA%\electron-remote-interface\config.json`

```json
{
  "security": "domains",
  "allowedDomains": "*.catprint.com",
  "tunnel": false
}
```

`security` options: `"domains"` | `"api-key"` | `"none"`

## Running from source

```bash
npm start                                  # start with window minimized (domains security by default)
npm start -- --no-security                 # disable auth (for testing)
npm start -- --api-key=yourkey             # API key auth
npm start -- --secure-domains=*.foo.com    # override allowed domains
npm start -- --tunnel                      # start Cloudflare tunnel
```

## Environment variables (.env)

```
ERI_API_KEY=          # used with api-key security mode
ERI_ALLOWED_DOMAINS=*.catprint.com   # default domain list for domains mode
```

## Binary dependencies

### pdfprint + Ghostscript (Windows only)

PDF printing on Windows uses `pdfprint.exe`, a custom Go-based utility developed
by CatPrint. It drives Ghostscript to rasterize PDFs and submits them to the
Windows RAW spooler.

**Source repo:** `github.com/catprintlabs/pdfprint`

**CLI usage:**
```
pdfprint.exe --printer "Printer Name" job.pdf
pdfprint.exe --ppd hp.ppd --printer "Printer Name" --duplex long --copies 2 job.pdf
pdfprint.exe --list-printers
```

**Ghostscript:** shipped alongside `pdfprint.exe` in a `gs/` subdirectory.
`pdfprint.exe` auto-detects it by looking next to itself — no separate install needed.

**How binaries get into the installer:**

The `bin/` directory is intentionally empty in git (see `.gitignore`). The CI
build job (`build-win` in `.github/workflows/build.yml`) automatically downloads
the latest `pdfprint-windows-amd64.zip` from the pdfprint GitHub releases,
extracts `pdfprint.exe` and `gs/` into `bin/`, then electron-builder bundles
them via `win.extraResources`. The downloaded pdfprint version is logged in the
CI output and written to `bin/pdfprint-version.txt`, which is displayed in the
app's GUI.

**Local dev / testing on Windows:**

To test printing locally without running a full CI build, run the same download
step manually:
```powershell
gh release download --repo catprintlabs/pdfprint --pattern "pdfprint-windows-amd64.zip" --dir .
Expand-Archive pdfprint-windows-amd64.zip -DestinationPath bin-tmp
Copy-Item bin-tmp\pdfprint.exe bin\
Copy-Item -Recurse bin-tmp\gs bin\gs
Remove-Item -Recurse bin-tmp
```

**Releasing a new pdfprint version:** tag and push a release in the pdfprint
repo, then tag a new electron-remote-interface release — the next build
automatically picks up the latest pdfprint.

## API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/` | HTML page listing all endpoints |
| GET | `/status` | Server status |
| GET | `/fs/list?path=` | List directory |
| GET | `/fs/read?path=` | Read file |
| GET | `/fs/download?path=` | Download file |
| GET | `/fs/stat?path=` | Stat file or directory |
| POST | `/fs/write?path=` | Write file (multipart or JSON `{content}`) |
| POST | `/fs/append?path=` | Append to file |
| POST | `/fs/mkdir?path=` | Create directory |
| POST | `/fs/move` | Move/rename `{from, to}` |
| POST | `/fs/copy-to-network` | Copy file to absolute/UNC path outside rootDir `{from, to}` |
| DELETE | `/fs/delete?path=` | Delete file or directory |
| GET | `/printers/list` | List printers |
| POST | `/printers/print` | Print file (multipart) `{printer?, copies?, duplex?, color?, scale?, page-size?, doc-name?}` |
| POST | `/printers/print-text` | Print plain text `{text, printer?, copies?, duplex?}` |
| POST | `/printers/print-url` | Download URL and print `{url, printer?, copies?, duplex?, color?, scale?, page-size?, doc-name?}` |
| GET | `/serial/list` | List serial ports |
| GET | `/serial/status` | List open ports |
| POST | `/serial/open` | Open port `{port, baudRate?, ...}` |
| POST | `/serial/close` | Close port `{port}` |
| POST | `/serial/write` | Write data `{port, data, encoding?}` |
| GET | `/serial/read?port=` | Flush buffered received data |
| WS | `/serial/stream?port=` | Bidirectional WebSocket stream |
| GET | `/scale/status` | Scale plug-in state and current weight `{pluggedIn, weightLb}` |
| GET | `/scale/weight` | Current weight in pounds (404 if not connected) |
| WS | `/scale/stream` | Pushes `{weightLb}` on every weight change |

## Rails Integration

`client/electron-interface.js` is a browser JS library that wraps all endpoints.
Include it in your Rails layout and call it from ERB or Stimulus controllers.
The electron app runs on the same machine as the browser, so all calls go to `localhost:8080`.

### Setup

Copy (or symlink) the two files from this repo into your Rails `app/assets/javascripts/` or `vendor/`:

| File | Use |
|---|---|
| `client/electron-interface.js` | Production — real HTTP/WebSocket calls to localhost |
| `client/electron-interface-stub.js` | Test/CI — fake responses, same API shape |

Include the right file from your layout based on environment:

```erb
<%# application.html.erb %>
<%= javascript_include_tag Rails.env.test? ? 'electron-interface-stub' : 'electron-interface' %>
```

### Commands (fire-and-forget)

```erb
<button onclick="new ElectronInterface().printUrl('<%= @pdf_url %>', { printer: '<%= @printer %>' })">
  Print
</button>
```

### Commands with feedback (Stimulus)

```js
// print_controller.js
export default class extends Controller {
  static values = { url: String, printer: String }

  async print(event) {
    const btn = event.currentTarget
    btn.disabled = true
    btn.textContent = 'Printing…'
    try {
      await new ElectronInterface().printUrl(this.urlValue, { printer: this.printerValue })
      btn.textContent = '✓ Sent to printer'
    } catch (err) {
      btn.textContent = 'Failed'
    }
  }
}
```

```erb
<button data-controller="print"
        data-print-url-value="<%= @pdf_url %>"
        data-print-printer-value="<%= @printer %>"
        data-action="click->print#print">Print</button>
```

### Queries (Stimulus populates DOM)

```js
// printer_select_controller.js
export default class extends Controller {
  static targets = ["select"]
  async connect() {
    const { printers } = await new ElectronInterface().listPrinters()
    this.selectTarget.innerHTML = printers
      .map(p => `<option value="${p.name}">${p.name}</option>`).join('')
  }
}
```

```erb
<div data-controller="printer-select">
  <select name="printer" data-printer-select-target="select"><option>Loading…</option></select>
</div>
```

### Streams (Stimulus manages lifecycle)

```js
// scale_controller.js
export default class extends Controller {
  static targets = ["weight"]
  connect()    { this.stop = new ElectronInterface().streamScale(({ weightLb }) => {
                   this.weightTarget.textContent = weightLb.toFixed(2) }) }
  disconnect() { this.stop?.() }
}
```

```erb
<div data-controller="scale">Weight: <span data-scale-target="weight">—</span> lb</div>
```

## API Spec

`openapi.yml` in the repo root is a complete OpenAPI 3.0 spec for all endpoints.
Use it to generate a Rails client, write RSpec stubs, or import into Postman/Insomnia.
All print options (`printer`, `copies`, `duplex`, `color`, `scale`, `page-size`, `doc-name`)
are defined in the shared `PrintOptions` schema under `components`.
WebSocket endpoints (`/serial/stream`, `/scale/stream`) are documented in the
spec's `info.description` block since OpenAPI 3.0 does not natively support WebSockets.

## Testing

```bash
npm test             # run all tests
npm test -- --verbose  # with per-test output
```

## Releasing

Use the release script to bump the version, commit, tag, and push in one step. GitHub Actions picks up the tag and builds both installers automatically.

```bash
npm run release 1.0.0-alpha.4
```

This updates `package.json`, commits, creates a `v1.0.0-alpha.4` git tag, and pushes everything. The Mac DMG and Windows installer will appear under the matching GitHub Release when the build finishes (~10 min).

**Do not** run `git tag` manually or edit `package.json` version by hand — always use this script so the installer filenames match the release tag.

## Building locally

```bash
npm run build:mac    # DMG for arm64 + x64
npm run build:win    # NSIS installer for x64
npm run build        # both
```

Output goes to `dist/`. Note: building Windows on Mac produces Mac-compiled native bindings and will not work on a PC — use `npm run release` and let GitHub Actions build for the correct platform.
