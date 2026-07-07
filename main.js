require('dotenv').config();
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const { startServer, stopServer } = require('./server');
const { resolveConfig: resolveConfigFromFile, saveConfig: saveConfigToFile } = require('./lib/config');

let mainWindow = null;
let serverPort = 8080;
const binDir = app.isPackaged
  ? path.join(process.resourcesPath, 'bin')
  : path.join(__dirname, 'bin');

let pdfprintVersion = 'not installed';
try {
  const vf = path.join(binDir, 'pdfprint-version.txt');
  if (fs.existsSync(vf)) pdfprintVersion = fs.readFileSync(vf, 'utf8').trim();
} catch {}

const versions = {
  app: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  pdfprint: pdfprintVersion,
};

let securityConfig = null;
let TUNNEL_MODE = false;
let serverRunning = false;
let tunnelProcess = null;
let tunnelUrl = null;

function saveConfig(opts) {
  saveConfigToFile(app.getPath('userData'), opts);
}

function resolveConfig() {
  return resolveConfigFromFile(app.getPath('userData'));
}

function resolveCloudflared() {
  const candidates = process.platform === 'win32'
    ? [path.join(binDir, 'cloudflared.exe')]
    : [
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
        send('tunnel-url', tunnelUrl);
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
      send('tunnel-url', null);
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

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function broadcastStatus() {
  send('status-changed', {
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
    if (app.isPackaged) {
      autoUpdater.on('update-downloaded', () => send('update-downloaded'));
      autoUpdater.checkForUpdates();
    }
  });

  mainWindow.on('close', () => {
    app.isQuitting = true;
    app.quit();
  });
}

ipcMain.handle('get-status', () => ({
  running: serverRunning,
  port: serverPort,
  securityConfig: securityConfig || { mode: 'none' },
  ips: getLocalIPs(),
  tunnelMode: TUNNEL_MODE,
  tunnelUrl,
  isDev: !app.isPackaged,
  versions,
}));

if (!app.isPackaged) {
  ipcMain.handle('scale-simulate', (_, weightLb) => {
    require('./server/lib/scale-reader').simulate(weightLb);
  });
}

async function autoStart() {
  if (serverRunning) return;
  try {
    await startServer({ port: serverPort, rootDir: null, security: securityConfig, onLog, binDir, versions });
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
  saveConfig({ security: securityConfig, tunnel: TUNNEL_MODE, port: serverPort });
  try {
    await startServer({ port: serverPort, rootDir, security: securityConfig, onLog, binDir, versions });
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

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});

function onLog(entry) {
  send('log', entry);
}

app.whenReady().then(() => {
  const cfg = resolveConfig();
  securityConfig = cfg.security;
  TUNNEL_MODE = cfg.tunnel;
  serverPort = cfg.port;

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
