const express = require('express');
const { exec, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

function listPrintersPosix() {
  return new Promise((resolve, reject) => {
    exec('lpstat -a 2>/dev/null || lpstat -p 2>/dev/null', (err, stdout) => {
      if (err && !stdout) return reject(err);
      const printers = [];
      for (const line of stdout.trim().split('\n')) {
        if (!line) continue;
        const match = line.match(/^(\S+)/);
        if (match) printers.push({ name: match[1], status: line });
      }
      resolve(printers);
    });
  });
}

function listPrintersWindows() {
  return new Promise((resolve, reject) => {
    exec(
      'powershell -command "Get-Printer | Select-Object Name,PrinterStatus | ConvertTo-Json"',
      (err, stdout) => {
        if (err) return reject(err);
        try {
          const raw = JSON.parse(stdout);
          const list = Array.isArray(raw) ? raw : [raw];
          resolve(list.map((p) => ({ name: p.Name, status: String(p.PrinterStatus) })));
        } catch (e) { reject(e); }
      }
    );
  });
}

function printFilePosix(file, opts) {
  return new Promise((resolve, reject) => {
    const args = opts.printer ? ['-P', opts.printer, file] : [file];
    execFile('lpr', args, (err, _stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve();
    });
  });
}

// opts: { printer?, copies?, duplex?, color?, scale?, pageSize?, docName? }
function printFileWindows(file, opts, binDir) {
  return new Promise((resolve, reject) => {
    const exe = path.join(binDir, 'pdfprint.exe');
    const args = [];
    if (opts.printer)  args.push('--printer',   opts.printer);
    if (opts.copies)   args.push('--copies',    String(opts.copies));
    if (opts.duplex)   args.push('--duplex',    opts.duplex);
    if (opts.color)    args.push('--color',     opts.color);
    if (opts.scale)    args.push('--scale',     opts.scale);
    if (opts.pageSize) args.push('--page-size', opts.pageSize);
    if (opts.docName)  args.push('--doc-name',  opts.docName);
    args.push(file);
    execFile(exe, args, (err, _stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve();
    });
  });
}

// Download url to a temp file; returns the temp path.
// Infers extension from Content-Disposition, then URL path, then defaults to .pdf.
async function downloadToTemp(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw Object.assign(
      new Error(`Download failed: ${res.status} ${res.statusText}`),
      { status: 502 }
    );
  }

  let ext = '.pdf';
  const cd = res.headers.get('content-disposition') || '';
  const cdMatch = cd.match(/filename[^;=\n]*=["']?([^"';\n]+)/i);
  if (cdMatch) {
    ext = path.extname(cdMatch[1].trim()) || ext;
  } else {
    const urlExt = path.extname(new URL(url).pathname);
    if (urlExt) ext = urlExt;
  }

  const tmpFile = path.join(os.tmpdir(), `print-url-${Date.now()}${ext}`);
  fs.writeFileSync(tmpFile, Buffer.from(await res.arrayBuffer()));
  return tmpFile;
}

// Extract the print opts shared by /print, /print-text, and /print-url
function printOpts(body) {
  return {
    printer:  body?.printer   || null,
    copies:   body?.copies    || null,
    duplex:   body?.duplex    || null,
    color:    body?.color     || null,
    scale:    body?.scale     || null,
    pageSize: body?.['page-size'] || null,
    docName:  body?.['doc-name']  || null,
  };
}

module.exports = function printerRouter(binDir) {
  const router = express.Router();

  // List printers
  router.get('/list', async (req, res, next) => {
    try {
      const printers = process.platform === 'win32'
        ? await listPrintersWindows()
        : await listPrintersPosix();
      res.json({ printers });
    } catch (err) { next(err); }
  });

  // Print a file uploaded via multipart
  router.post('/print', upload.single('file'), async (req, res, next) => {
    let tmpFile = null;
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded. Send multipart field "file".' });
      const opts = printOpts(req.body);
      const ext = path.extname(req.file.originalname || '.bin') || '.bin';
      tmpFile = path.join(os.tmpdir(), `print-${Date.now()}${ext}`);
      fs.writeFileSync(tmpFile, req.file.buffer);
      if (process.platform === 'win32') {
        await printFileWindows(tmpFile, opts, binDir);
      } else {
        await printFilePosix(tmpFile, opts);
      }
      res.json({ ok: true, printer: opts.printer || 'default' });
    } catch (err) {
      next(err);
    } finally {
      if (tmpFile) try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  // Print raw text
  router.post('/print-text', async (req, res, next) => {
    let tmpFile = null;
    try {
      const text = req.body?.text;
      if (!text) return res.status(400).json({ error: 'Provide { text, printer? } in JSON body' });
      const opts = printOpts(req.body);
      tmpFile = path.join(os.tmpdir(), `print-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, text, 'utf8');
      if (process.platform === 'win32') {
        await printFileWindows(tmpFile, opts, binDir);
      } else {
        await printFilePosix(tmpFile, opts);
      }
      res.json({ ok: true, printer: opts.printer || 'default' });
    } catch (err) {
      next(err);
    } finally {
      if (tmpFile) try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  // Download a URL and print it
  router.post('/print-url', async (req, res, next) => {
    let tmpFile = null;
    try {
      const url = req.body?.url;
      if (!url) return res.status(400).json({ error: 'url is required' });
      const opts = printOpts(req.body);
      tmpFile = await downloadToTemp(url);
      if (process.platform === 'win32') {
        await printFileWindows(tmpFile, opts, binDir);
      } else {
        await printFilePosix(tmpFile, opts);
      }
      res.json({ ok: true, printer: opts.printer || 'default' });
    } catch (err) {
      next(err);
    } finally {
      if (tmpFile) try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  return router;
};
