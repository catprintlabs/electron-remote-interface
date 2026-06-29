const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveConfig, saveConfig } = require('../lib/config');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eri-config-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// resolveConfig — no config file
// ---------------------------------------------------------------------------
describe('resolveConfig with no config file', () => {
  test('defaults to domains mode with ERI_ALLOWED_DOMAINS env var', () => {
    const { security } = resolveConfig(tmpDir, [], { ERI_ALLOWED_DOMAINS: '*.example.com' });
    expect(security).toEqual({ mode: 'domains', allowedDomains: '*.example.com' });
  });

  test('falls back to *.catprint.com when env var is not set', () => {
    const { security } = resolveConfig(tmpDir, [], {});
    expect(security).toEqual({ mode: 'domains', allowedDomains: '*.catprint.com' });
  });

  test('defaults tunnel to false', () => {
    const { tunnel } = resolveConfig(tmpDir, [], {});
    expect(tunnel).toBe(false);
  });

  test('defaults port to 8080', () => {
    const { port } = resolveConfig(tmpDir, [], {});
    expect(port).toBe(8080);
  });
});

// ---------------------------------------------------------------------------
// resolveConfig — CLI flags override everything
// ---------------------------------------------------------------------------
describe('resolveConfig CLI flags', () => {
  test('--no-security sets mode to none', () => {
    const { security } = resolveConfig(tmpDir, ['--no-security'], {});
    expect(security).toEqual({ mode: 'none' });
  });

  test('--api-key=xxx sets api-key mode', () => {
    const { security } = resolveConfig(tmpDir, ['--api-key=mysecret'], {});
    expect(security).toEqual({ mode: 'api-key', apiKey: 'mysecret' });
  });

  test('--secure-domains=*.foo.com sets domains mode', () => {
    const { security } = resolveConfig(tmpDir, ['--secure-domains=*.foo.com'], {});
    expect(security).toEqual({ mode: 'domains', allowedDomains: '*.foo.com' });
  });

  test('--tunnel sets tunnel to true', () => {
    const { tunnel } = resolveConfig(tmpDir, ['--tunnel'], {});
    expect(tunnel).toBe(true);
  });

  test('CLI flag overrides config file security', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ security: 'api-key', apiKey: 'filekey' }));
    const { security } = resolveConfig(tmpDir, ['--no-security'], {});
    expect(security.mode).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// resolveConfig — config file
// ---------------------------------------------------------------------------
describe('resolveConfig from config file', () => {
  test('reads security: none from config', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ security: 'none' }));
    const { security } = resolveConfig(tmpDir, [], {});
    expect(security).toEqual({ mode: 'none' });
  });

  test('reads security: api-key from config', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ security: 'api-key', apiKey: 'abc123' }));
    const { security } = resolveConfig(tmpDir, [], {});
    expect(security).toEqual({ mode: 'api-key', apiKey: 'abc123' });
  });

  test('reads security: domains from config', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ security: 'domains', allowedDomains: '*.mysite.com' }));
    const { security } = resolveConfig(tmpDir, [], {});
    expect(security).toEqual({ mode: 'domains', allowedDomains: '*.mysite.com' });
  });

  test('reads tunnel: true from config', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ tunnel: true }));
    const { tunnel } = resolveConfig(tmpDir, [], {});
    expect(tunnel).toBe(true);
  });

  test('reads port from config', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ port: 9090 }));
    const { port } = resolveConfig(tmpDir, [], {});
    expect(port).toBe(9090);
  });

  test('falls back to env var for api-key when config has no apiKey', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ security: 'api-key' }));
    const { security } = resolveConfig(tmpDir, [], { ERI_API_KEY: 'envkey' });
    expect(security.apiKey).toBe('envkey');
  });

  test('ignores a malformed config file and uses defaults', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), 'not json {{{');
    const { security, tunnel, port } = resolveConfig(tmpDir, [], {});
    expect(security.mode).toBe('domains');
    expect(tunnel).toBe(false);
    expect(port).toBe(8080);
  });
});

// ---------------------------------------------------------------------------
// saveConfig
// ---------------------------------------------------------------------------
describe('saveConfig', () => {
  test('creates config.json when it does not exist', () => {
    saveConfig(tmpDir, { security: { mode: 'none' }, tunnel: false, port: 8080 });
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf8'));
    expect(saved.security).toBe('none');
    expect(saved.tunnel).toBe(false);
    expect(saved.port).toBe(8080);
  });

  test('saves api-key mode with apiKey', () => {
    saveConfig(tmpDir, { security: { mode: 'api-key', apiKey: 'mykey' } });
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf8'));
    expect(saved.security).toBe('api-key');
    expect(saved.apiKey).toBe('mykey');
  });

  test('saves domains mode with allowedDomains', () => {
    saveConfig(tmpDir, { security: { mode: 'domains', allowedDomains: '*.catprint.com' } });
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf8'));
    expect(saved.security).toBe('domains');
    expect(saved.allowedDomains).toBe('*.catprint.com');
  });

  test('merges with existing config without removing other keys', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ port: 9000, tunnel: true }));
    saveConfig(tmpDir, { security: { mode: 'none' } });
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf8'));
    expect(saved.port).toBe(9000);
    expect(saved.tunnel).toBe(true);
    expect(saved.security).toBe('none');
  });

  test('round-trips: saveConfig then resolveConfig returns the same values', () => {
    saveConfig(tmpDir, { security: { mode: 'api-key', apiKey: 'roundtrip' }, tunnel: true, port: 3000 });
    const { security, tunnel, port } = resolveConfig(tmpDir, [], {});
    expect(security).toEqual({ mode: 'api-key', apiKey: 'roundtrip' });
    expect(tunnel).toBe(true);
    expect(port).toBe(3000);
  });
});
