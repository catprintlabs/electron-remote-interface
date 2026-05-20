require('dotenv').config();
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { startServer, stopServer } = require('./server');

let mainWindow = null;
let tray = null;
let serverPort = 8080;
let securityConfig = null;
let TUNNEL_MODE = false;
let NO_UI = true;
let serverRunning = false;
let tunnelProcess = null;
let tunnelUrl = null;

function resolveConfig() {
  let fileConfig = {};
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    if (fs.existsSync(configPath)) {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch {}

  // tunnel: CLI --tunnel overrides config
  const tunnel = process.argv.includes('--tunnel') || fileConfig.tunnel === true;

  // showUi: CLI --show-ui overrides config
  const noUi = !process.argv.includes('--show-ui') && fileConfig.showUi !== true;

  // Security: CLI flags take priority over config file
  let security;
  if (process.argv.includes('--no-security')) {
    security = { mode: 'none' };
  } else {
    const apiKeyArg = process.argv.find(a => a.startsWith('--api-key='));
    if (apiKeyArg) {
      security = { mode: 'api-key', apiKey: apiKeyArg.slice('--api-key='.length) };
    } else {
      const domainsArg = process.argv.find(a => a.startsWith('--secure-domains=') || a === '--secure-domains');
      if (domainsArg) {
        const domains = domainsArg.includes('=')
          ? domainsArg.slice('--secure-domains='.length)
          : (process.env.ERI_ALLOWED_DOMAINS || '*.catprint.com');
        security = { mode: 'domains', allowedDomains: domains };
      } else if (fileConfig.security === 'none') {
        security = { mode: 'none' };
      } else if (fileConfig.security === 'api-key') {
        security = { mode: 'api-key', apiKey: fileConfig.apiKey || process.env.ERI_API_KEY };
      } else if (fileConfig.security === 'domains') {
        security = { mode: 'domains', allowedDomains: fileConfig.allowedDomains || process.env.ERI_ALLOWED_DOMAINS || '*.catprint.com' };
      } else {
        security = { mode: 'domains', allowedDomains: process.env.ERI_ALLOWED_DOMAINS || '*.catprint.com' };
      }
    }
  }

  return { security, tunnel, noUi };
}

function resolveCloudflared() {
  // Bundled .app on Mac doesn't inherit shell PATH, so check common install locations
  const candidates = [
    '/opt/homebrew/bin/cloudflared',  // Homebrew on Apple Silicon
    '/usr/local/bin/cloudflared',     // Homebrew on Intel / manual install
    '/usr/bin/cloudflared',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return 'cloudflared'; // fall back to PATH lookup (works in dev)
}

function startTunnel(port) {
  return new Promise((resolve) => {
    tunnelProcess = spawn(resolveCloudflared(), ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const urlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
    let resolved = false;

    function scan(data) {
      if (resolved) return;
      const match = data.toString().match(urlPattern);
      if (match) {
        resolved = true;
        tunnelUrl = match[0];
        process.stdout.write(`\nCloudflare Tunnel: ${tunnelUrl}\n\n`);
        mainWindow?.webContents.send('tunnel-url', tunnelUrl);
        resolve(tunnelUrl);
      }
    }

    tunnelProcess.on('error', (err) => {
      if (!resolved) { resolved = true; resolve(null); }
      process.stderr.write(`cloudflared not found: ${err.message}\n`);
      tunnelProcess = null;
    });

    tunnelProcess.stdout.on('data', scan);
    tunnelProcess.stderr.on('data', scan);

    tunnelProcess.on('exit', () => {
      tunnelProcess = null;
      tunnelUrl = null;
      mainWindow?.webContents.send('tunnel-url', null);
    });

    // Give cloudflared 30s to establish the tunnel before giving up
    setTimeout(() => { if (!resolved) { resolved = true; resolve(null); } }, 30000);
  });
}

function stopTunnel() {
  if (tunnelProcess) {
    tunnelProcess.kill();
    tunnelProcess = null;
    tunnelUrl = null;
  }
}

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(interfaces)) {
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) {
        ips.push(alias.address);
      }
    }
  }
  return ips;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 600,
    minWidth: 600,
    minHeight: 480,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Remote Access Server',
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (e) => {
    if (serverRunning) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

ipcMain.handle('get-status', () => ({
  running: serverRunning,
  port: serverPort,
  securityConfig: securityConfig || { mode: 'none' },
  ips: getLocalIPs(),
  tunnelMode: TUNNEL_MODE,
  tunnelUrl,
}));

async function autoStart() {
  if (serverRunning) return;
  try {
    await startServer({ port: serverPort, rootDir: null, security: securityConfig, onLog });
    serverRunning = true;
    mainWindow?.webContents.send('status-changed', { running: true, port: serverPort, securityConfig, ips: getLocalIPs(), tunnelMode: TUNNEL_MODE, tunnelUrl: null });
    if (NO_UI) {
      const ips = getLocalIPs().map((ip) => `  http://${ip}:${serverPort}`).join('\n');
      process.stdout.write(`\nServer running on port ${serverPort}\n${ips}\n`);
      if (securityConfig.mode === 'api-key') process.stdout.write(`API key: ${securityConfig.apiKey}\n`);
      if (securityConfig.mode === 'domains') process.stdout.write(`Allowed domains: ${securityConfig.allowedDomains}\n`);
    }
    if (TUNNEL_MODE) startTunnel(serverPort);
  } catch (err) {
    console.error('Auto-start failed:', err.message);
  }
}

ipcMain.handle('start-server', async (_, { port, rootDir }) => {
  if (serverRunning) return { ok: false, error: 'Already running' };
  serverPort = port || 8080;
  try {
    await startServer({ port: serverPort, rootDir, security: securityConfig, onLog });
    serverRunning = true;
    mainWindow?.webContents.send('status-changed', { running: true, port: serverPort, securityConfig, ips: getLocalIPs(), tunnelMode: TUNNEL_MODE, tunnelUrl: null });
    if (TUNNEL_MODE) startTunnel(serverPort);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('stop-server', async () => {
  stopTunnel();
  await stopServer();
  serverRunning = false;
  mainWindow?.webContents.send('status-changed', { running: false, port: serverPort, securityConfig, ips: getLocalIPs(), tunnelMode: TUNNEL_MODE, tunnelUrl: null });
  return { ok: true };
});

ipcMain.handle('select-directory', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

function onLog(entry) {
  mainWindow?.webContents.send('log', entry);
}

app.whenReady().then(() => {
  const cfg = resolveConfig();
  securityConfig = cfg.security;
  TUNNEL_MODE = cfg.tunnel;
  NO_UI = cfg.noUi;

  if (NO_UI) {
    if (process.platform === 'darwin') app.dock.hide();
    autoStart();
  } else {
    createWindow();
    mainWindow.once('ready-to-show', autoStart);
    app.on('activate', () => {
      if (mainWindow) mainWindow.show();
    });
  }
});

app.on('window-all-closed', () => {
  // In --no-ui mode keep the process alive even though there are no windows
  if (!NO_UI && process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  stopTunnel();
  if (serverRunning) await stopServer();
});
