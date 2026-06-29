const dot = document.getElementById('dot');
const headerStatus = document.getElementById('header-status');
const toggleBtn = document.getElementById('toggle-btn');
const portInput = document.getElementById('port-input');
const rootDirInput = document.getElementById('root-dir');
const browseBtn = document.getElementById('browse-btn');
const securityMode = document.getElementById('security-mode');
const domainsSection = document.getElementById('domains-section');
const domainsInput = document.getElementById('domains-input');
const apikeySection = document.getElementById('apikey-section');
const apikeyInput = document.getElementById('apikey-input');
const copyKeyBtn = document.getElementById('copy-key-btn');
const tunnelCheck = document.getElementById('tunnel-check');
const authHint = document.getElementById('auth-hint');
const infoBox = document.getElementById('info-box');
const infoPort = document.getElementById('info-port');
const ipList = document.getElementById('ip-list');
const tunnelBox = document.getElementById('tunnel-box');
const tunnelUrlDisplay = document.getElementById('tunnel-url-display');
const copyTunnelBtn = document.getElementById('copy-tunnel-btn');
const logEntries = document.getElementById('log-entries');
const clearLogBtn = document.getElementById('clear-log-btn');

let running = false;
let logCount = 0;
const MAX_LOG = 500;

function getSecurityFromUI() {
  const mode = securityMode.value;
  if (mode === 'domains') return { mode: 'domains', allowedDomains: domainsInput.value.trim() || '*.catprint.com' };
  if (mode === 'api-key') return { mode: 'api-key', apiKey: apikeyInput.value.trim() };
  return { mode: 'none' };
}

function applySecurityToUI(cfg) {
  if (!cfg) return;
  securityMode.value = cfg.mode || 'none';
  if (cfg.mode === 'domains') domainsInput.value = cfg.allowedDomains || '';
  if (cfg.mode === 'api-key') apikeyInput.value = cfg.apiKey || '';
  updateSecuritySections();
}

function updateSecuritySections() {
  const mode = securityMode.value;
  domainsSection.style.display = mode === 'domains' ? '' : 'none';
  apikeySection.style.display  = mode === 'api-key'  ? '' : 'none';

  if (mode === 'api-key') {
    authHint.innerHTML = `Header: <code>x-api-key: &lt;key&gt;</code>`;
  } else if (mode === 'domains') {
    authHint.innerHTML = `Requests must include an <code>Origin</code> header from an allowed domain`;
  } else {
    authHint.textContent = '';
  }
}

function setControlsDisabled(disabled) {
  portInput.disabled = disabled;
  rootDirInput.disabled = disabled;
  browseBtn.disabled = disabled;
  securityMode.disabled = disabled;
  domainsInput.disabled = disabled;
  apikeyInput.disabled = disabled;
  tunnelCheck.disabled = disabled;
}

function applyTunnelUrl(url) {
  if (url) {
    tunnelUrlDisplay.innerHTML = `<a href="${url}" target="_blank" style="color:#ffcc80;text-decoration:none;">${url}</a>`;
    copyTunnelBtn.style.display = '';
  } else {
    tunnelUrlDisplay.innerHTML = '<span class="tunnel-connecting">Connecting…</span>';
    copyTunnelBtn.style.display = 'none';
  }
}

function applyStatus(data) {
  running = data.running;
  dot.className = 'status-dot' + (running ? ' on' : '');
  headerStatus.textContent = running ? `Running on :${data.port}` : 'Stopped';
  toggleBtn.textContent = running ? 'Stop Server' : 'Start Server';
  toggleBtn.className = 'toggle-btn' + (running ? ' stop' : '');
  setControlsDisabled(running);

  if (running) {
    infoBox.style.display = 'flex';
    infoPort.textContent = data.port;
    ipList.innerHTML = '';
    for (const ip of ['127.0.0.1']) {
      const chip = document.createElement('div');
      chip.className = 'ip-chip';
      chip.textContent = `http://${ip}:${data.port}`;
      ipList.appendChild(chip);
    }
    if (data.tunnelMode) {
      tunnelBox.style.display = 'flex';
      applyTunnelUrl(data.tunnelUrl || null);
    }
  } else {
    infoBox.style.display = 'none';
    tunnelBox.style.display = 'none';
  }
}

function statusClass(code) {
  if (code >= 500) return 's5xx';
  if (code >= 400) return 's4xx';
  return 's2xx';
}

function addLog(entry) {
  if (logCount === 0) logEntries.innerHTML = '';
  logCount++;
  if (logCount > MAX_LOG) logEntries.removeChild(logEntries.firstChild);

  const row = document.createElement('div');
  row.className = 'log-entry';
  const time = new Date(entry.time).toLocaleTimeString();
  row.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-method">${entry.method}</span>
    <span class="log-path">${entry.path}</span>
    <span class="log-status ${statusClass(entry.status)}">${entry.status}</span>
    <span class="log-ms">${entry.ms}ms</span>
    <span class="log-ip">${entry.ip || ''}</span>
  `;

  const atBottom = logEntries.scrollHeight - logEntries.scrollTop <= logEntries.clientHeight + 40;
  logEntries.appendChild(row);
  if (atBottom) logEntries.scrollTop = logEntries.scrollHeight;
}

async function init() {
  const status = await window.api.getStatus();

  // Pre-populate controls from initial config
  portInput.value = status.port || 8080;
  applySecurityToUI(status.securityConfig);
  tunnelCheck.checked = status.tunnelMode || false;

  applyStatus(status);

  window.api.onStatusChanged(applyStatus);
  window.api.onTunnelUrl(applyTunnelUrl);
  window.api.onLog(addLog);
}

securityMode.addEventListener('change', updateSecuritySections);

toggleBtn.addEventListener('click', async () => {
  toggleBtn.disabled = true;
  if (running) {
    await window.api.stopServer();
  } else {
    const port = parseInt(portInput.value, 10) || 8080;
    const rootDir = rootDirInput.value.trim() || null;
    const security = getSecurityFromUI();
    const tunnelMode = tunnelCheck.checked;
    const result = await window.api.startServer({ port, rootDir, security, tunnelMode });
    if (!result.ok) alert('Failed to start server: ' + result.error);
  }
  toggleBtn.disabled = false;
});

browseBtn.addEventListener('click', async () => {
  const dir = await window.api.selectDirectory();
  if (dir) rootDirInput.value = dir;
});

copyKeyBtn.addEventListener('click', () => {
  const key = apikeyInput.value;
  if (key) {
    navigator.clipboard.writeText(key).catch(() => {});
    copyKeyBtn.textContent = '✓';
    setTimeout(() => { copyKeyBtn.textContent = '⎘'; }, 1200);
  }
});

copyTunnelBtn.addEventListener('click', () => {
  const url = tunnelUrlDisplay.querySelector('a')?.href;
  if (url) {
    navigator.clipboard.writeText(url).catch(() => {});
    copyTunnelBtn.textContent = '✓';
    setTimeout(() => { copyTunnelBtn.textContent = '⎘'; }, 1200);
  }
});

clearLogBtn.addEventListener('click', () => {
  logEntries.innerHTML = '<div style="color: var(--muted); padding: 12px 0; text-align:center;">Log cleared.</div>';
  logCount = 0;
});

init();
