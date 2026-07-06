const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Resolve a user-supplied path against the root, rejecting traversal attempts.
function safePath(root, userPath) {
  const resolved = path.resolve(root, userPath.replace(/^\//, ''));
  if (!resolved.startsWith(path.resolve(root))) {
    throw Object.assign(new Error('Path traversal denied'), { status: 403 });
  }
  return resolved;
}

module.exports = function fsRouter(root) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

  // List directory
  router.get('/list', (req, res, next) => {
    try {
      const target = safePath(root, req.query.path || '/');
      const stat = fs.statSync(target);
      if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });
      const entries = fs.readdirSync(target).map((name) => {
        const s = fs.statSync(path.join(target, name));
        return { name, isDir: s.isDirectory(), size: s.size, mtime: s.mtime };
      });
      res.json({ path: target, entries });
    } catch (err) { next(err); }
  });

  // Read file (inline)
  router.get('/read', (req, res, next) => {
    try {
      const target = safePath(root, req.query.path || '');
      const stat = fs.statSync(target);
      if (stat.isDirectory()) return res.status(400).json({ error: 'Is a directory' });
      const content = fs.readFileSync(target);
      res.set('Content-Type', 'application/octet-stream');
      res.send(content);
    } catch (err) { next(err); }
  });

  // Download file with original filename
  router.get('/download', (req, res, next) => {
    try {
      const target = safePath(root, req.query.path || '');
      res.download(target);
    } catch (err) { next(err); }
  });

  // Write file (raw body or multipart)
  router.post('/write', upload.single('file'), (req, res, next) => {
    try {
      const target = safePath(root, req.query.path || req.body?.path || '');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const encoding = req.body?.encoding === 'base64' ? 'base64' : 'utf8';
      const data = req.file ? req.file.buffer : Buffer.from(req.body?.content ?? '', encoding);
      fs.writeFileSync(target, data);
      res.json({ ok: true, path: target });
    } catch (err) { next(err); }
  });

  // Append to file
  router.post('/append', (req, res, next) => {
    try {
      const target = safePath(root, req.query.path || req.body?.path || '');
      fs.appendFileSync(target, req.body?.content ?? '');
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // Delete file or directory
  router.delete('/delete', (req, res, next) => {
    try {
      const target = safePath(root, req.query.path || '');
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        fs.rmSync(target, { recursive: true });
      } else {
        fs.unlinkSync(target);
      }
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // Create directory
  router.post('/mkdir', (req, res, next) => {
    try {
      const target = safePath(root, req.query.path || req.body?.path || '');
      fs.mkdirSync(target, { recursive: true });
      res.json({ ok: true, path: target });
    } catch (err) { next(err); }
  });

  // Rename / move
  router.post('/move', (req, res, next) => {
    try {
      const from = safePath(root, req.body?.from || '');
      const to = safePath(root, req.body?.to || '');
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // Copy a file from rootDir to an absolute network/UNC path outside rootDir
  router.post('/copy-to-network', (req, res, next) => {
    try {
      const from = safePath(root, req.body?.from || '');
      const to = req.body?.to || '';
      if (!to) return res.status(400).json({ error: 'to is required' });
      if (!path.isAbsolute(to)) return res.status(400).json({ error: 'to must be an absolute path' });
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // Stat a file/directory
  router.get('/stat', (req, res, next) => {
    try {
      const target = safePath(root, req.query.path || '');
      const stat = fs.statSync(target);
      res.json({ path: target, isDir: stat.isDirectory(), size: stat.size, mtime: stat.mtime, ctime: stat.ctime });
    } catch (err) { next(err); }
  });

  return router;
};
