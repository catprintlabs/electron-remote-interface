const express = require('express');
const scale = require('../lib/scale-reader');
const { allowedByDomains } = require('../security');

scale.start();

const clients = new Set();

scale.events.on('change', (weightLb) => {
  const msg = JSON.stringify({ weightLb });
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
});

module.exports = function scaleRouter() {
  const router = express.Router();

  router.get('/status', (req, res) => {
    const pluggedIn = scale.isPluggedIn();
    res.json({ pluggedIn, weightLb: pluggedIn ? scale.getWeightLb() : 0 });
  });

  router.get('/weight', (req, res) => {
    if (!scale.isPluggedIn()) return res.status(404).json({ error: 'Scale not connected' });
    res.json({ weightLb: scale.getWeightLb() });
  });

  return router;
};

module.exports.attachWebSocket = function attachWebSocket(wss, security) {
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');

    if (security && security.mode !== 'none') {
      if (security.mode === 'api-key') {
        if (url.searchParams.get('api_key') !== security.apiKey) {
          ws.close(4401, 'Unauthorized'); return;
        }
      } else if (security.mode === 'domains') {
        if (!allowedByDomains(security.allowedDomains, req.headers.origin)) {
          ws.close(4403, 'Forbidden'); return;
        }
      }
    }

    clients.add(ws);

    // Send current reading immediately on connect
    if (scale.isPluggedIn()) {
      ws.send(JSON.stringify({ weightLb: scale.getWeightLb() }));
    }

    ws.on('close', () => clients.delete(ws));
  });
};
