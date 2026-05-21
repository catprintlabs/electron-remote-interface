require('dotenv').config();
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { startServer, stopServer } = require('./server');

let mainWindow = null;
let serverPort = 8080;
let securityConfig = null;
let TUNNEL_MODE = false;
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

  const tunnel = process.argv.includes('--tunnel') || fileConfig.tunnel === true;

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

  return { security, tunnel };
}

function resolveCloudflared() {
  const candidates = [
    '/opt/homebrew/bin/cloudflared',
    '/usr/local/bin/cloudflared',
    '/usr/bin/cloudflared',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return 'cloudflared';
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

function broadcastStatus() {
  mainWindow?.webContents.send('status-changed', {
    running: serverRunning,
    port: serverPort,
    securityConfig,
    ips: getLocalIPs(),
    tunnelMode: TUNNEL_MODE,
    tunnelUrl,
  });
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

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.minimize();
    autoStart();
  });

  // Close button minimizes; use Quit button to actually exit
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.minimize();
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
    broadcastStatus();
    if (TUNNEL_MODE) startTunnel(serverPort);
  } catch (err) {
    console.error('Auto-start failed:', err.message);
  }
}

ipcMain.handle('start-server', async (_, { port, rootDir, security, tunnelMode }) => {
  if (serverRunning) return { ok: false, error: 'Already running' };
  serverPort = port || 8080;
  if (security) securityConfig = security;
  if (tunnelMode !== undefined) TUNNEL_MODE = tunnelMode;
  try {
    await startServer({ port: serverPort, rootDir, security: securityConfig, onLog });
    serverRunning = true;
    broadcastStatus();
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
  broadcastStatus();
  return { ok: true };
});

ipcMain.handle('select-directory', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('quit-app', async () => {
  app.isQuitting = true;
  app.quit();
});

function onLog(entry) {
  mainWindow?.webContents.send('log', entry);
}

app.whenReady().then(() => {
  const cfg = resolveConfig();
  securityConfig = cfg.security;
  TUNNEL_MODE = cfg.tunnel;

  createWindow();

  app.on('activate', () => {
    if (mainWindow) mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  stopTunnel();
  if (serverRunning) await stopServer();
});
