class ElectronInterface {
  constructor({ port = 8080, apiKey = null } = {}) {
    this.base  = `http://localhost:${port}`;
    this.wsBase = `ws://localhost:${port}`;
    this.apiKey = apiKey;
  }

  // Status
  status() { return this.#get('/status'); }

  // File system
  fsList(path = '/')    { return this.#get(`/fs/list?path=${enc(path)}`); }
  fsStat(path)          { return this.#get(`/fs/stat?path=${enc(path)}`); }
  fsRead(path)          { return this.#getText(`/fs/read?path=${enc(path)}`); }
  fsDownload(path)      { return this.#getBlob(`/fs/download?path=${enc(path)}`); }
  fsWrite(path, content, encoding = 'utf8') {
    return this.#post(`/fs/write?path=${enc(path)}`, { content, encoding });
  }
  fsAppend(path, content)  { return this.#post('/fs/append', { path, content }); }
  fsMkdir(path)            { return this.#post('/fs/mkdir', { path }); }
  fsMove(from, to)         { return this.#post('/fs/move', { from, to }); }
  fsCopyToNetwork(from, to){ return this.#post('/fs/copy-to-network', { from, to }); }
  fsDelete(path)           { return this.#delete(`/fs/delete?path=${enc(path)}`); }

  // Printers
  listPrinters()           { return this.#get('/printers/list'); }
  printUrl(url, opts = {}) { return this.#post('/printers/print-url', { url, ...opts }); }
  printText(text, opts={}) { return this.#post('/printers/print-text', { text, ...opts }); }
  print(file, opts = {}) {
    const form = new FormData();
    form.append('file', file);
    for (const [k, v] of Object.entries(opts)) if (v != null) form.append(k, String(v));
    return this.#postForm('/printers/print', form);
  }

  // Scale
  scaleStatus() { return this.#get('/scale/status'); }
  scaleWeight() { return this.#get('/scale/weight'); }
  streamScale(callback) {
    const ws = new WebSocket(this.#wsUrl('/scale/stream'));
    ws.onmessage = (e) => callback(JSON.parse(e.data));
    return () => ws.close();
  }

  // Serial
  serialList()                     { return this.#get('/serial/list'); }
  serialStatus()                   { return this.#get('/serial/status'); }
  serialRead(port)                 { return this.#get(`/serial/read?port=${enc(port)}`); }
  serialOpen(port, opts = {})      { return this.#post('/serial/open', { port, ...opts }); }
  serialClose(port)                { return this.#post('/serial/close', { port }); }
  serialWrite(port, data, opts={}) { return this.#post('/serial/write', { port, data, ...opts }); }
  streamSerial(port, callback) {
    const ws = new WebSocket(this.#wsUrl(`/serial/stream?port=${enc(port)}`));
    ws.onmessage = (e) => callback(JSON.parse(e.data));
    return () => ws.close();
  }

  // --- private ---

  async #get(path) {
    const res = await fetch(this.base + path, { headers: this.#headers() });
    return this.#parse(res);
  }

  async #getText(path) {
    const res = await fetch(this.base + path, { headers: this.#headers() });
    if (!res.ok) throw await this.#err(res);
    return res.text();
  }

  async #getBlob(path) {
    const res = await fetch(this.base + path, { headers: this.#headers() });
    if (!res.ok) throw await this.#err(res);
    return res.blob();
  }

  async #post(path, body) {
    const res = await fetch(this.base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.#headers() },
      body: JSON.stringify(body),
    });
    return this.#parse(res);
  }

  async #postForm(path, form) {
    const res = await fetch(this.base + path, {
      method: 'POST',
      headers: this.#headers(),
      body: form,
    });
    return this.#parse(res);
  }

  async #delete(path) {
    const res = await fetch(this.base + path, { method: 'DELETE', headers: this.#headers() });
    return this.#parse(res);
  }

  async #parse(res) {
    if (!res.ok) throw await this.#err(res);
    return res.json();
  }

  async #err(res) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch {}
    return Object.assign(new Error(msg), { status: res.status });
  }

  #headers() {
    return this.apiKey ? { 'x-api-key': this.apiKey } : {};
  }

  #wsUrl(path) {
    const url = this.wsBase + path;
    if (!this.apiKey) return url;
    return url + (url.includes('?') ? '&' : '?') + `api_key=${enc(this.apiKey)}`;
  }
}

function enc(v) { return encodeURIComponent(v); }

if (typeof module !== 'undefined') module.exports = { ElectronInterface };
