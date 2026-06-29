const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const os = require('os');

const fsRoutes = require('./routes/filesystem');
const printerRoutes = require('./routes/printers');
const serialRoutes = require('./routes/serial');
const { allowedByDomains, securityMiddleware } = require('./security');

let httpServer = null;
let wss = null;

function logMiddleware(onLog) {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      onLog({
        time: new Date().toISOString(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - start,
        ip: req.ip,
      });
    });
    next();
  };
}

async function startServer({ port = 8080, rootDir, security = { mode: 'none' }, onLog, binDir }) {
  const resolvedRoot = rootDir || os.homedir();

  const corsOptions = security.mode === 'domains'
    ? { origin: (origin, cb) => cb(null, allowedByDomains(security.allowedDomains, origin)), credentials: true }
    : { origin: '*' };

  const app = express();
  app.set('trust proxy', true);
  app.use(cors(corsOptions));
  app.use((_req, res, next) => { res.setHeader('Access-Control-Allow-Private-Network', 'true'); next(); });
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '100mb' }));
  if (onLog) app.use(logMiddleware(onLog));
  app.use(securityMiddleware(security));

  app.use('/fs', fsRoutes(resolvedRoot));
  app.use('/printers', printerRoutes(binDir));
  app.use('/serial', serialRoutes());

  app.get('/', (req, res) => {
    const groups = [
      {
        name: 'General',
        endpoints: [
          { method: 'GET',    path: '/',       description: 'This page — list all endpoints' },
          { method: 'GET',    path: '/status', description: 'Server status and configured root directory' },
        ],
      },
      {
        name: 'File System',
        endpoints: [
          { method: 'GET',    path: '/fs/list',     description: 'List directory contents',              params: '?path=/' },
          { method: 'GET',    path: '/fs/read',     description: 'Read file bytes',                      params: '?path=...' },
          { method: 'GET',    path: '/fs/download', description: 'Download file with original filename', params: '?path=...' },
          { method: 'GET',    path: '/fs/stat',     description: 'Stat a file or directory',             params: '?path=...' },
          { method: 'POST',   path: '/fs/write',    description: 'Write file — multipart field "file" or JSON body {content}', params: '?path=...' },
          { method: 'POST',   path: '/fs/append',   description: 'Append to file — JSON body {content}', params: '?path=...' },
          { method: 'POST',   path: '/fs/mkdir',    description: 'Create directory',                     params: '?path=...' },
          { method: 'POST',   path: '/fs/move',     description: 'Rename or move — JSON body {from, to}' },
          { method: 'DELETE', path: '/fs/delete',   description: 'Delete file or directory (recursive)', params: '?path=...' },
        ],
      },
      {
        name: 'Printers',
        endpoints: [
          { method: 'GET',  path: '/printers/list',       description: 'List available printers' },
          { method: 'POST', path: '/printers/print',      description: 'Print a file — multipart field "file", optional {printer}' },
          { method: 'POST', path: '/printers/print-text', description: 'Print plain text — JSON body {text, printer?}' },
        ],
      },
      {
        name: 'Serial Ports',
        endpoints: [
          { method: 'GET',  path: '/serial/list',   description: 'List available serial ports' },
          { method: 'GET',  path: '/serial/status', description: 'List currently open serial ports' },
          { method: 'POST', path: '/serial/open',   description: 'Open a port — JSON body {port, baudRate?, dataBits?, stopBits?, parity?}' },
          { method: 'POST', path: '/serial/close',  description: 'Close a port — JSON body {port}' },
          { method: 'POST', path: '/serial/write',  description: 'Write data — JSON body {port, data, encoding?}  (encoding: "utf8" | "hex")' },
          { method: 'GET',  path: '/serial/read',   description: 'Flush buffered received data',     params: '?port=...' },
          { method: 'WS',   path: '/serial/stream', description: 'Bidirectional WebSocket stream',   params: '?port=...&api_key=...' },
        ],
      },
    ];

    const methodColor = { GET: '#4fc3f7', POST: '#81c784', DELETE: '#e57373', WS: '#ffb74d' };

    const rows = groups.map(({ name, endpoints }) => `
      <tr class="group-header"><td colspan="3">${name}</td></tr>
      ${endpoints.map(({ method, path, description, params = '' }) => `
        <tr>
          <td><span class="badge" style="background:${methodColor[method] ?? '#aaa'}">${method}</span></td>
          <td class="path">${path}<span class="params">${params}</span></td>
          <td class="desc">${description}</td>
        </tr>`).join('')}`).join('');

    const authBadge = security.mode === 'none'
      ? `<span class="auth-off">Disabled</span>`
      : security.mode === 'domains'
        ? `<span class="auth-on">Domain Restricted</span> — allowed origins: <code>${security.allowedDomains}</code>`
        : `<span class="auth-on">API Key</span> — send header <code>x-api-key: &lt;key&gt;</code> or query param <code>?api_key=&lt;key&gt;</code>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Remote Access API</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f1117;color:#d0d6e0;font-family:'Segoe UI',system-ui,sans-serif;font-size:14px;padding:32px 24px}
  h1{font-size:22px;color:#4fc3f7;margin-bottom:4px}
  .subtitle{color:#666;font-size:13px;margin-bottom:24px}
  .auth-bar{background:#1a1f2e;border:1px solid #1e4080;border-radius:8px;padding:12px 16px;margin-bottom:28px;font-size:13px;line-height:1.6}
  .auth-on{background:#4caf50;color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;margin-right:6px}
  .auth-off{background:#555;color:#ddd;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;margin-right:6px}
  code{background:#0a0c14;border:1px solid #1e3060;padding:1px 6px;border-radius:4px;font-family:monospace;font-size:12px;color:#4fc3f7}
  table{width:100%;border-collapse:collapse;background:#12161f;border:1px solid #1e3060;border-radius:10px;overflow:hidden}
  tr.group-header td{background:#1a2240;color:#4fc3f7;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:10px 16px;border-top:2px solid #1e3060}
  tr:not(.group-header):hover{background:#161c2e}
  td{padding:10px 14px;border-bottom:1px solid #161c2e;vertical-align:middle}
  td:first-child{width:76px;text-align:center}
  .badge{display:inline-block;padding:3px 8px;border-radius:5px;font-size:11px;font-weight:700;color:#111;min-width:54px;text-align:center}
  .path{font-family:monospace;font-size:13px;color:#e0e0e0;width:240px}
  .params{color:#888;font-size:12px;margin-left:4px}
  .desc{color:#9aa5b4;font-size:13px}
</style>
</head>
<body>
<h1>Remote Access API</h1>
<p class="subtitle">Platform: ${process.platform} &nbsp;|&nbsp; Node ${process.version}</p>
<div class="auth-bar"><b>Authentication:</b> ${authBadge}</div>
<table>
  <tbody>${rows}</tbody>
</table>
</body>
</html>`);
  });

  app.get('/status', (req, res) => {
    res.json({ ok: true, 'root-directory': resolvedRoot, platform: process.platform });
  });

  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message });
  });

  httpServer = http.createServer(app);

  // WebSocket server for serial port streaming
  wss = new WebSocketServer({ server: httpServer, path: '/serial/stream' });
  serialRoutes.attachWebSocket(wss, security);

  await new Promise((resolve, reject) => {
    httpServer.listen(port, '0.0.0.0', resolve);
    httpServer.once('error', reject);
  });
}

async function stopServer() {
  serialRoutes.closeAll();
  if (wss) { wss.close(); wss = null; }
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
    httpServer = null;
  }
}

module.exports = { startServer, stopServer };
