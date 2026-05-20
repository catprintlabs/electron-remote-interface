const express = require('express');
const { SerialPort } = require('serialport');
const { allowedByDomains } = require('../security');

// Registry of open serial ports: portPath -> { port, buffer }
const openPorts = new Map();

function getOrThrow(portPath) {
  const entry = openPorts.get(portPath);
  if (!entry) throw Object.assign(new Error(`Port ${portPath} is not open`), { status: 404 });
  return entry;
}

module.exports = function serialRouter() {
  const router = express.Router();

  // List available ports
  router.get('/list', async (req, res, next) => {
    try {
      const ports = await SerialPort.list();
      res.json({ ports });
    } catch (err) { next(err); }
  });

  // Open a port
  router.post('/open', async (req, res, next) => {
    try {
      const { port: portPath, baudRate = 9600, dataBits = 8, stopBits = 1, parity = 'none' } = req.body || {};
      if (!portPath) return res.status(400).json({ error: 'port is required' });
      if (openPorts.has(portPath)) return res.status(409).json({ error: 'Port already open' });

      const sp = new SerialPort({ path: portPath, baudRate, dataBits, stopBits, parity, autoOpen: false });
      await new Promise((resolve, reject) => sp.open((err) => err ? reject(err) : resolve()));

      const entry = { port: sp, buffer: [] };
      sp.on('data', (data) => {
        entry.buffer.push({ ts: Date.now(), hex: data.toString('hex'), text: data.toString('utf8') });
        if (entry.buffer.length > 1000) entry.buffer.shift();
        // Broadcast to WebSocket subscribers
        if (entry.sockets) {
          const msg = JSON.stringify({ port: portPath, hex: data.toString('hex'), text: data.toString('utf8') });
          for (const ws of entry.sockets) {
            if (ws.readyState === 1) ws.send(msg);
          }
        }
      });
      sp.on('error', (err) => console.error(`Serial error on ${portPath}:`, err.message));
      openPorts.set(portPath, entry);

      res.json({ ok: true, port: portPath, baudRate });
    } catch (err) { next(err); }
  });

  // Close a port
  router.post('/close', async (req, res, next) => {
    try {
      const { port: portPath } = req.body || {};
      if (!portPath) return res.status(400).json({ error: 'port is required' });
      const entry = getOrThrow(portPath);
      await new Promise((resolve, reject) => entry.port.close((err) => err ? reject(err) : resolve()));
      openPorts.delete(portPath);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // Write data to a port
  router.post('/write', async (req, res, next) => {
    try {
      const { port: portPath, data, encoding = 'utf8' } = req.body || {};
      if (!portPath || data === undefined) return res.status(400).json({ error: 'port and data are required' });
      const entry = getOrThrow(portPath);
      const buf = encoding === 'hex' ? Buffer.from(data, 'hex') : Buffer.from(String(data), 'utf8');
      await new Promise((resolve, reject) =>
        entry.port.write(buf, (err) => err ? reject(err) : entry.port.drain(resolve))
      );
      res.json({ ok: true, bytes: buf.length });
    } catch (err) { next(err); }
  });

  // Read buffered data from a port
  router.get('/read', (req, res, next) => {
    try {
      const portPath = req.query.port;
      if (!portPath) return res.status(400).json({ error: 'port query param required' });
      const entry = getOrThrow(portPath);
      const records = entry.buffer.splice(0);
      res.json({ port: portPath, records });
    } catch (err) { next(err); }
  });

  // Status of open ports
  router.get('/status', (req, res) => {
    const status = [];
    for (const [portPath, entry] of openPorts.entries()) {
      status.push({ port: portPath, isOpen: entry.port.isOpen, buffered: entry.buffer.length });
    }
    res.json({ ports: status });
  });

  return router;
};

// WebSocket attachment (called from server/index.js after wss is created)
module.exports.attachWebSocket = function attachWebSocket(wss, security) {
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');

    if (security && security.mode !== 'none') {
      if (security.mode === 'api-key') {
        if (url.searchParams.get('api_key') !== security.apiKey) {
          ws.close(4401, 'Unauthorized');
          return;
        }
      } else if (security.mode === 'domains') {
        if (!allowedByDomains(security.allowedDomains, req.headers.origin)) {
          ws.close(4403, 'Forbidden');
          return;
        }
      }
    }

    const portPath = url.searchParams.get('port');
    if (!portPath) { ws.close(4400, 'port param required'); return; }

    const entry = openPorts.get(portPath);
    if (!entry) { ws.close(4404, 'Port not open'); return; }

    if (!entry.sockets) entry.sockets = new Set();
    entry.sockets.add(ws);

    ws.on('message', (msg) => {
      // Allow writing via WebSocket too
      try {
        const payload = JSON.parse(msg);
        const buf = payload.encoding === 'hex'
          ? Buffer.from(payload.data, 'hex')
          : Buffer.from(String(payload.data), 'utf8');
        entry.port.write(buf);
      } catch {}
    });

    ws.on('close', () => { if (entry.sockets) entry.sockets.delete(ws); });
  });
};

module.exports.closeAll = function closeAll() {
  for (const [portPath, entry] of openPorts.entries()) {
    try { entry.port.close(); } catch {}
  }
  openPorts.clear();
};
