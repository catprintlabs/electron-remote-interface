// Tests domain-based security mode (port 19879)

const os = require('os');
const { WebSocket } = require('ws');
const { startServer, stopServer } = require('../server');

const PORT = 19879;
const BASE = `http://localhost:${PORT}`;
const ALLOWED_DOMAINS = '*.catprint.com,www.example.org';

beforeAll(async () => {
  await startServer({
    port: PORT,
    rootDir: os.tmpdir(),
    security: { mode: 'domains', allowedDomains: ALLOWED_DOMAINS },
    onLog: () => {},
  });
});

afterAll(async () => {
  await stopServer();
});

const get = (url, origin) => fetch(`${BASE}${url}`, {
  headers: origin ? { Origin: origin } : {},
});

describe('Domains mode — allowed origins', () => {
  test('allows request from allowed subdomain', async () => {
    const res = await get('/status', 'https://app.catprint.com');
    expect(res.status).toBe(200);
  });

  test('allows request from another allowed subdomain', async () => {
    const res = await get('/status', 'https://print.catprint.com');
    expect(res.status).toBe(200);
  });

  test('allows request from exact allowed domain', async () => {
    const res = await get('/status', 'https://www.example.org');
    expect(res.status).toBe(200);
  });
});

describe('Domains mode — blocked origins', () => {
  test('blocks request with no origin header', async () => {
    const res = await get('/status', null);
    expect(res.status).toBe(403);
  });

  test('blocks request from disallowed domain', async () => {
    const res = await get('/status', 'https://evil.com');
    expect(res.status).toBe(403);
  });

  test('blocks bare domain when wildcard requires a subdomain', async () => {
    const res = await get('/status', 'https://catprint.com');
    expect(res.status).toBe(403);
  });

  test('blocks subdomain that is not in the list', async () => {
    const res = await get('/status', 'https://sub.example.org');
    expect(res.status).toBe(403);
  });
});

describe('Domains mode — WebSocket', () => {
  const ws = (params, origin) => new WebSocket(
    `ws://localhost:${PORT}/serial/stream${params}`,
    { headers: origin ? { Origin: origin } : {} }
  );

  test('closes with 4403 when origin is missing', (done) => {
    const sock = ws('?port=/dev/tty0', null);
    sock.on('close', (code) => { expect(code).toBe(4403); done(); });
    sock.on('error', done);
  });

  test('closes with 4403 when origin is not allowed', (done) => {
    const sock = ws('?port=/dev/tty0', 'https://evil.com');
    sock.on('close', (code) => { expect(code).toBe(4403); done(); });
    sock.on('error', done);
  });

  test('closes with 4404 (port not open) when origin is allowed', (done) => {
    const sock = ws('?port=/dev/tty0', 'https://app.catprint.com');
    sock.on('close', (code) => { expect(code).toBe(4404); done(); });
    sock.on('error', done);
  });
});
