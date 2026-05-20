// Tests all API endpoints with auth disabled (port 19876)

const os = require('os');
const path = require('path');
const fs = require('fs');
const { WebSocket } = require('ws');
const { startServer, stopServer } = require('../server');

const PORT = 19876;
const BASE = `http://localhost:${PORT}`;
let tmpDir;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eri-test-'));
  await startServer({ port: PORT, rootDir: tmpDir, security: { mode: 'none' }, onLog: () => {} });
});

afterAll(async () => {
  await stopServer();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const get  = (url)        => fetch(`${BASE}${url}`);
const del  = (url)        => fetch(`${BASE}${url}`, { method: 'DELETE' });
const post = (url, body)  => fetch(`${BASE}${url}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------
describe('GET /', () => {
  test('returns HTML listing all endpoint paths', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toMatch(/\/fs\/list/);
    expect(html).toMatch(/\/printers\/list/);
    expect(html).toMatch(/\/serial\/list/);
    expect(html).toMatch(/\/serial\/stream/);
  });
});

describe('GET /status', () => {
  test('returns ok and configured root', async () => {
    const res = await get('/status');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.root).toBe(tmpDir);
  });
});

// ---------------------------------------------------------------------------
// File System
// ---------------------------------------------------------------------------
describe('File System', () => {
  test('GET /fs/list returns entries array for root', async () => {
    const res = await get('/fs/list?path=/');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.entries)).toBe(true);
  });

  test('GET /fs/list on a file returns 400', async () => {
    fs.writeFileSync(path.join(tmpDir, 'notadir.txt'), 'x');
    const res = await get('/fs/list?path=notadir.txt');
    expect(res.status).toBe(400);
  });

  test('GET /fs/stat on root returns isDir true', async () => {
    const res = await get('/fs/stat?path=/');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.isDir).toBe(true);
  });

  test('GET /fs/stat on nonexistent path returns 500', async () => {
    const res = await get('/fs/stat?path=doesnotexist');
    expect(res.status).toBe(500);
  });

  test('POST /fs/mkdir creates a directory', async () => {
    const res = await post('/fs/mkdir?path=subdir', {});
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(tmpDir, 'subdir'))).toBe(true);
  });

  test('GET /fs/list on created subdir returns empty entries', async () => {
    const res = await get('/fs/list?path=subdir');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.entries).toHaveLength(0);
  });

  test('POST /fs/write writes a file via JSON body', async () => {
    const res = await post('/fs/write?path=subdir/hello.txt', { content: 'hello world' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'subdir/hello.txt'), 'utf8')).toBe('hello world');
  });

  test('POST /fs/write writes a file via multipart upload', async () => {
    const form = new FormData();
    form.append('file', new Blob(['uploaded content']), 'upload.txt');
    const res = await fetch(`${BASE}/fs/write?path=subdir/upload.txt`, { method: 'POST', body: form });
    expect(res.status).toBe(200);
    expect(fs.readFileSync(path.join(tmpDir, 'subdir/upload.txt'), 'utf8')).toBe('uploaded content');
  });

  test('GET /fs/read reads a file back', async () => {
    const res = await get('/fs/read?path=subdir/hello.txt');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello world');
  });

  test('GET /fs/read on a directory returns 400', async () => {
    const res = await get('/fs/read?path=subdir');
    expect(res.status).toBe(400);
  });

  test('GET /fs/read on nonexistent file returns 500', async () => {
    const res = await get('/fs/read?path=nope.txt');
    expect(res.status).toBe(500);
  });

  test('GET /fs/download returns Content-Disposition with filename', async () => {
    const res = await get('/fs/download?path=subdir/hello.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/hello\.txt/);
    expect(await res.text()).toBe('hello world');
  });

  test('GET /fs/stat on file returns correct size and isDir false', async () => {
    const res = await get('/fs/stat?path=subdir/hello.txt');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.isDir).toBe(false);
    expect(json.size).toBe(11); // 'hello world'.length
  });

  test('POST /fs/append appends content to a file', async () => {
    const res = await post('/fs/append?path=subdir/hello.txt', { content: ' appended' });
    expect(res.status).toBe(200);
    const content = fs.readFileSync(path.join(tmpDir, 'subdir/hello.txt'), 'utf8');
    expect(content).toBe('hello world appended');
  });

  test('POST /fs/move renames a file', async () => {
    const res = await post('/fs/move', { from: 'subdir/hello.txt', to: 'subdir/renamed.txt' });
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(tmpDir, 'subdir/hello.txt'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'subdir/renamed.txt'))).toBe(true);
  });

  test('DELETE /fs/delete removes a file', async () => {
    const res = await del('/fs/delete?path=subdir/renamed.txt');
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(tmpDir, 'subdir/renamed.txt'))).toBe(false);
  });

  test('DELETE /fs/delete removes a directory recursively', async () => {
    const res = await del('/fs/delete?path=subdir');
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(tmpDir, 'subdir'))).toBe(false);
  });

  test('GET /fs/read with path traversal returns 403', async () => {
    const res = await get('/fs/read?path=../../../etc/passwd');
    expect(res.status).toBe(403);
  });

  test('GET /fs/stat with path traversal returns 403', async () => {
    const res = await get('/fs/stat?path=../../etc');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Printers
// ---------------------------------------------------------------------------
describe('Printers', () => {
  test('GET /printers/list returns a printers array', async () => {
    const res = await get('/printers/list');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.printers)).toBe(true);
  });

  test('POST /printers/print without file returns 400', async () => {
    const res = await fetch(`${BASE}/printers/print`, { method: 'POST' });
    expect(res.status).toBe(400);
  });

  test('POST /printers/print-text without text returns 400', async () => {
    const res = await post('/printers/print-text', { printer: 'SomePrinter' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Serial Ports
// ---------------------------------------------------------------------------
describe('Serial Ports', () => {
  test('GET /serial/list returns a ports array', async () => {
    const res = await get('/serial/list');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.ports)).toBe(true);
  });

  test('GET /serial/status returns empty open ports on startup', async () => {
    const res = await get('/serial/status');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ports).toHaveLength(0);
  });

  test('POST /serial/open without port param returns 400', async () => {
    const res = await post('/serial/open', { baudRate: 9600 });
    expect(res.status).toBe(400);
  });

  test('POST /serial/open with nonexistent port returns 500', async () => {
    const res = await post('/serial/open', { port: '/dev/nonexistent_eri_999', baudRate: 9600 });
    expect(res.status).toBe(500);
  });

  test('POST /serial/close without port param returns 400', async () => {
    const res = await post('/serial/close', {});
    expect(res.status).toBe(400);
  });

  test('POST /serial/close on a port that is not open returns 404', async () => {
    const res = await post('/serial/close', { port: '/dev/ttyUSB_not_open' });
    expect(res.status).toBe(404);
  });

  test('POST /serial/write without port returns 400', async () => {
    const res = await post('/serial/write', { data: 'hello' });
    expect(res.status).toBe(400);
  });

  test('POST /serial/write on a port that is not open returns 404', async () => {
    const res = await post('/serial/write', { port: '/dev/ttyUSB_not_open', data: 'hello' });
    expect(res.status).toBe(404);
  });

  test('GET /serial/read without port param returns 400', async () => {
    const res = await get('/serial/read');
    expect(res.status).toBe(400);
  });

  test('GET /serial/read on a port that is not open returns 404', async () => {
    const res = await get('/serial/read?port=/dev/ttyUSB_not_open');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// WebSocket — Serial Stream
// ---------------------------------------------------------------------------
describe('WebSocket /serial/stream', () => {
  const ws = (params) => new WebSocket(`ws://localhost:${PORT}/serial/stream${params}`);

  test('closes with 4400 when port param is missing', (done) => {
    const sock = ws('');
    sock.on('close', (code) => { expect(code).toBe(4400); done(); });
    sock.on('error', done);
  });

  test('closes with 4404 when specified port is not open', (done) => {
    const sock = ws('?port=/dev/ttyUSB_not_open');
    sock.on('close', (code) => { expect(code).toBe(4404); done(); });
    sock.on('error', done);
  });
});

