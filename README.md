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
| DELETE | `/fs/delete?path=` | Delete file or directory |
| GET | `/printers/list` | List printers |
| POST | `/printers/print` | Print file (multipart) |
| POST | `/printers/print-text` | Print plain text `{text, printer?}` |
| GET | `/serial/list` | List serial ports |
| GET | `/serial/status` | List open ports |
| POST | `/serial/open` | Open port `{port, baudRate?, ...}` |
| POST | `/serial/close` | Close port `{port}` |
| POST | `/serial/write` | Write data `{port, data, encoding?}` |
| GET | `/serial/read?port=` | Flush buffered received data |
| WS | `/serial/stream?port=` | Bidirectional WebSocket stream |

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
