// Tests that auth enforcement works correctly (port 19877)

const os = require('os');
const path = require('path');
const fs = require('fs');
const { WebSocket } = require('ws');
const { startServer, stopServer } = require('../server');

const PORT = 19877;
const BASE = `http://localhost:${PORT}`;
const API_KEY = 'test-secret-key-eri-xyz';
let tmpDir;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eri-auth-test-'));
  await startServer({ port: PORT, rootDir: tmpDir, security: { mode: 'api-key', apiKey: API_KEY }, onLog: () => {} });
});

afterAll(async () => {
  await stopServer();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Representative endpoints covering each route group
const ENDPOINTS = [
  ['GET',    '/'],
  ['GET',    '/status'],
  ['GET',    '/fs/list?path=/'],
  ['GET',    '/fs/stat?path=/'],
  ['GET',    '/printers/list'],
  ['GET',    '/serial/list'],
  ['GET',    '/serial/status'],
];

// ---------------------------------------------------------------------------
// No key — every endpoint must 401
// ---------------------------------------------------------------------------
describe('No API key → 401', () => {
  test.each(ENDPOINTS)('%s %s', async (method, url) => {
    const res = await fetch(`${BASE}${url}`, { method });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Wrong key — every endpoint must 401
// ---------------------------------------------------------------------------
describe('Wrong API key → 401', () => {
  test.each(ENDPOINTS)('%s %s', async (method, url) => {
    const res = await fetch(`${BASE}${url}`, {
      method,
      headers: { 'x-api-key': 'totally-wrong-key' },
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Correct key in header → 200
// ---------------------------------------------------------------------------
describe('Correct API key in x-api-key header → 200', () => {
  test.each(ENDPOINTS)('%s %s', async (method, url) => {
    const res = await fetch(`${BASE}${url}`, {
      method,
      headers: { 'x-api-key': API_KEY },
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Correct key in query param → 200
// ---------------------------------------------------------------------------
describe('Correct API key as ?api_key query param → 200', () => {
  test.each(ENDPOINTS)('%s %s', async (method, url) => {
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetch(`${BASE}${url}${sep}api_key=${API_KEY}`, { method });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// WebSocket auth
// ---------------------------------------------------------------------------
describe('WebSocket auth', () => {
  const ws = (params) => new WebSocket(`ws://localhost:${PORT}/serial/stream${params}`);

  test('no key → closes with 4401', (done) => {
    const sock = ws('?port=/dev/tty0');
    sock.on('close', (code) => { expect(code).toBe(4401); done(); });
    sock.on('error', done);
  });

  test('wrong key → closes with 4401', (done) => {
    const sock = ws('?port=/dev/tty0&api_key=wrong');
    sock.on('close', (code) => { expect(code).toBe(4401); done(); });
    sock.on('error', done);
  });

  test('correct key → does not close with 4401 (closes with port-not-open 4404)', (done) => {
    const sock = ws(`?port=/dev/tty0&api_key=${API_KEY}`);
    sock.on('close', (code) => {
      expect(code).not.toBe(4401);
      done();
    });
    sock.on('error', done);
  });
});
