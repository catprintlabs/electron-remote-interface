const dot = document.getElementById('dot');
const headerStatus = document.getElementById('header-status');
const toggleBtn = document.getElementById('toggle-btn');
const portInput = document.getElementById('port-input');
const rootDirInput = document.getElementById('root-dir');
const browseBtn = document.getElementById('browse-btn');
const securityDisplay = document.getElementById('security-display');
const copyKeyBtn = document.getElementById('copy-key-btn');
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

function securityLabel(config) {
  if (!config || config.mode === 'none') return '(disabled)';
  if (config.mode === 'domains') return `Domains: ${config.allowedDomains}`;
  if (config.mode === 'api-key') return config.apiKey || '(none)';
  return '—';
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
  portInput.disabled = running;
  rootDirInput.disabled = running;
  browseBtn.disabled = running;

  const cfg = data.securityConfig;
  securityDisplay.textContent = securityLabel(cfg);
  if (cfg?.mode === 'api-key') {
    copyKeyBtn.style.display = '';
    authHint.innerHTML = `Header: <code>x-api-key: &lt;key&gt;</code>`;
  } else if (cfg?.mode === 'domains') {
    copyKeyBtn.style.display = 'none';
    authHint.innerHTML = `Requests must include an <code>Origin</code> header from an allowed domain`;
  } else {
    copyKeyBtn.style.display = 'none';
    authHint.textContent = '';
  }

  if (running) {
    infoBox.style.display = 'flex';
    infoPort.textContent = data.port;
    ipList.innerHTML = '';
    const ips = data.ips && data.ips.length ? data.ips : ['127.0.0.1'];
    for (const ip of ips) {
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

  if (logCount > MAX_LOG) {
    logEntries.removeChild(logEntries.firstChild);
  }

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
  applyStatus(status);

  window.api.onStatusChanged(applyStatus);
  window.api.onTunnelUrl(applyTunnelUrl);
  window.api.onLog(addLog);
}

toggleBtn.addEventListener('click', async () => {
  toggleBtn.disabled = true;
  if (running) {
    await window.api.stopServer();
  } else {
    const port = parseInt(portInput.value, 10) || 8080;
    const rootDir = rootDirInput.value.trim() || null;
    const result = await window.api.startServer({ port, rootDir });
    if (!result.ok) {
      alert('Failed to start server: ' + result.error);
    }
  }
  toggleBtn.disabled = false;
});

browseBtn.addEventListener('click', async () => {
  const dir = await window.api.selectDirectory();
  if (dir) rootDirInput.value = dir;
});

copyKeyBtn.addEventListener('click', () => {
  const key = securityDisplay.textContent;
  if (key && key !== '—' && key !== '(none)' && key !== '(disabled)') {
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
