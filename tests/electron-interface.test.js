const { ElectronInterface } = require('../client/electron-interface');

function mockFetch(body, { ok = true, status = 200 } = {}) {
  global.fetch = jest.fn().mockResolvedValue({
    ok, status,
    statusText: ok ? 'OK' : 'Error',
    json:  async () => body,
    text:  async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    blob:  async () => new Blob([JSON.stringify(body)]),
  });
}

function mockWS() {
  const ws = { onmessage: null, close: jest.fn() };
  global.WebSocket = jest.fn(() => ws);
  return ws;
}

afterEach(() => {
  delete global.fetch;
  delete global.WebSocket;
});

// --- Construction ---

test('uses port 8080 by default', () => {
  expect(new ElectronInterface().base).toBe('http://localhost:8080');
});

test('accepts custom port', () => {
  expect(new ElectronInterface({ port: 9090 }).base).toBe('http://localhost:9090');
});

// --- GET ---

test('listPrinters sends GET /printers/list', async () => {
  const printers = [{ name: 'HP', status: '3' }];
  mockFetch({ printers });
  const result = await new ElectronInterface().listPrinters();
  expect(fetch).toHaveBeenCalledWith('http://localhost:8080/printers/list', expect.objectContaining({ headers: {} }));
  expect(result.printers).toEqual(printers);
});

test('fsList encodes path', async () => {
  mockFetch({ path: '/my docs', entries: [] });
  await new ElectronInterface().fsList('/my docs');
  expect(fetch).toHaveBeenCalledWith(
    'http://localhost:8080/fs/list?path=%2Fmy%20docs',
    expect.anything()
  );
});

test('scaleStatus returns pluggedIn and weightLb', async () => {
  mockFetch({ pluggedIn: true, weightLb: 1.5 });
  const result = await new ElectronInterface().scaleStatus();
  expect(result).toEqual({ pluggedIn: true, weightLb: 1.5 });
});

// --- POST ---

test('printUrl sends correct POST body', async () => {
  mockFetch({ ok: true, printer: 'HP' });
  await new ElectronInterface().printUrl('http://example.com/file.pdf', { printer: 'HP', copies: 2 });
  expect(fetch).toHaveBeenCalledWith('http://localhost:8080/printers/print-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'http://example.com/file.pdf', printer: 'HP', copies: 2 }),
  });
});

test('fsMove sends from and to', async () => {
  mockFetch({ ok: true });
  await new ElectronInterface().fsMove('old.pdf', 'new.pdf');
  expect(fetch).toHaveBeenCalledWith('http://localhost:8080/fs/move', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ from: 'old.pdf', to: 'new.pdf' }),
  }));
});

test('serialOpen sends port and options', async () => {
  mockFetch({ ok: true, port: 'COM3', baudRate: 115200 });
  await new ElectronInterface().serialOpen('COM3', { baudRate: 115200 });
  expect(fetch).toHaveBeenCalledWith('http://localhost:8080/serial/open', expect.objectContaining({
    body: JSON.stringify({ port: 'COM3', baudRate: 115200 }),
  }));
});

// --- DELETE ---

test('fsDelete sends DELETE with encoded path', async () => {
  mockFetch({ ok: true });
  await new ElectronInterface().fsDelete('sub/file.pdf');
  expect(fetch).toHaveBeenCalledWith(
    'http://localhost:8080/fs/delete?path=sub%2Ffile.pdf',
    expect.objectContaining({ method: 'DELETE' })
  );
});

// --- WebSocket ---

test('streamScale opens WebSocket and calls callback', () => {
  const ws = mockWS();
  const received = [];
  const stop = new ElectronInterface().streamScale((d) => received.push(d));

  expect(WebSocket).toHaveBeenCalledWith('ws://localhost:8080/scale/stream');
  ws.onmessage({ data: JSON.stringify({ weightLb: 2.5 }) });
  expect(received).toEqual([{ weightLb: 2.5 }]);
  stop();
  expect(ws.close).toHaveBeenCalled();
});

test('streamSerial opens WebSocket with port param', () => {
  const ws = mockWS();
  const received = [];
  const stop = new ElectronInterface().streamSerial('COM3', (d) => received.push(d));

  expect(WebSocket).toHaveBeenCalledWith('ws://localhost:8080/serial/stream?port=COM3');
  ws.onmessage({ data: JSON.stringify({ port: 'COM3', text: 'hi' }) });
  expect(received).toEqual([{ port: 'COM3', text: 'hi' }]);
  stop();
  expect(ws.close).toHaveBeenCalled();
});

// --- API key ---

test('sends x-api-key header on GET requests', async () => {
  mockFetch({ printers: [] });
  await new ElectronInterface({ apiKey: 'secret' }).listPrinters();
  expect(fetch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ headers: { 'x-api-key': 'secret' } })
  );
});

test('appends api_key param to WebSocket URL', () => {
  const ws = mockWS();
  new ElectronInterface({ apiKey: 'secret' }).streamScale(() => {});
  expect(WebSocket).toHaveBeenCalledWith('ws://localhost:8080/scale/stream?api_key=secret');
  ws.close();
});

// --- Error handling ---

test('throws with server error message on non-ok response', async () => {
  mockFetch({ error: 'Path traversal denied' }, { ok: false, status: 403 });
  await expect(new ElectronInterface().fsList('/etc/passwd')).rejects.toThrow('Path traversal denied');
});

test('thrown error includes HTTP status code', async () => {
  mockFetch({ error: 'Not found' }, { ok: false, status: 404 });
  const err = await new ElectronInterface().scaleWeight().catch((e) => e);
  expect(err.status).toBe(404);
});
