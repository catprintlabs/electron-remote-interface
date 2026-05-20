function domainMatches(pattern, origin) {
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // e.g. '.catprint.com'
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === pattern;
  } catch {
    return false;
  }
}

function allowedByDomains(allowedDomains, origin) {
  const domains = (allowedDomains || '').split(',').map(d => d.trim()).filter(Boolean);
  return domains.some(d => domainMatches(d, origin));
}

function securityMiddleware(security) {
  return (req, res, next) => {
    if (!security || security.mode === 'none') return next();

    if (security.mode === 'domains') {
      const origin = req.headers.origin;
      if (allowedByDomains(security.allowedDomains, origin)) return next();
      return res.status(403).json({ error: 'Forbidden: origin not allowed' });
    }

    if (security.mode === 'api-key') {
      const token = req.headers['x-api-key'] || req.query.api_key;
      if (token === security.apiKey) return next();
      return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
  };
}

module.exports = { domainMatches, allowedByDomains, securityMiddleware };
