'use strict';

const fs = require('fs');
const path = require('path');

function resolveConfig(userDataPath, argv = process.argv, env = process.env) {
  let fileConfig = {};
  try {
    const configPath = path.join(userDataPath, 'config.json');
    if (fs.existsSync(configPath)) {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch {}

  const tunnel = argv.includes('--tunnel') || fileConfig.tunnel === true;
  const port = fileConfig.port || 8080;

  let security;
  if (argv.includes('--no-security')) {
    security = { mode: 'none' };
  } else {
    const apiKeyArg = argv.find(a => a.startsWith('--api-key='));
    if (apiKeyArg) {
      security = { mode: 'api-key', apiKey: apiKeyArg.slice('--api-key='.length) };
    } else {
      const domainsArg = argv.find(a => a.startsWith('--secure-domains=') || a === '--secure-domains');
      if (domainsArg) {
        const domains = domainsArg.includes('=')
          ? domainsArg.slice('--secure-domains='.length)
          : (env.ERI_ALLOWED_DOMAINS || '*.catprint.com');
        security = { mode: 'domains', allowedDomains: domains };
      } else if (fileConfig.security === 'none') {
        security = { mode: 'none' };
      } else if (fileConfig.security === 'api-key') {
        security = { mode: 'api-key', apiKey: fileConfig.apiKey || env.ERI_API_KEY };
      } else if (fileConfig.security === 'domains') {
        security = { mode: 'domains', allowedDomains: fileConfig.allowedDomains || env.ERI_ALLOWED_DOMAINS || '*.catprint.com' };
      } else {
        security = { mode: 'domains', allowedDomains: env.ERI_ALLOWED_DOMAINS || '*.catprint.com' };
      }
    }
  }

  return { security, tunnel, port };
}

function saveConfig(userDataPath, { security, tunnel, port }) {
  try {
    const configPath = path.join(userDataPath, 'config.json');
    const current = fs.existsSync(configPath)
      ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
      : {};
    const updated = { ...current };
    if (security) {
      updated.security = security.mode;
      if (security.mode === 'domains') updated.allowedDomains = security.allowedDomains;
      if (security.mode === 'api-key') updated.apiKey = security.apiKey;
    }
    if (tunnel !== undefined) updated.tunnel = tunnel;
    if (port) updated.port = port;
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
  } catch (err) {
    console.error('Failed to save config:', err.message);
  }
}

module.exports = { resolveConfig, saveConfig };
