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

function printFilePosix(file, printerName) {
  return new Promise((resolve, reject) => {
    const args = printerName ? ['-P', printerName, file] : [file];
    execFile('lpr', args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve();
    });
  });
}

function printFileWindows(file, printerName, binDir) {
  return new Promise((resolve, reject) => {
    const exe = path.join(binDir, 'PDFtoPrinter.exe');
    const args = printerName ? [file, printerName] : [file];
    execFile(exe, args, (err, _stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve();
    });
  });
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

  // Print a file uploaded via multipart, or a raw body
  router.post('/print', upload.single('file'), async (req, res, next) => {
    let tmpFile = null;
    try {
      const printerName = req.body?.printer || req.query.printer || null;

      if (!req.file) return res.status(400).json({ error: 'No file uploaded. Send multipart field "file".' });

      // Write to a temp file so we can hand it to the OS print command
      const ext = path.extname(req.file.originalname || '.bin') || '.bin';
      tmpFile = path.join(os.tmpdir(), `print-${Date.now()}${ext}`);
      fs.writeFileSync(tmpFile, req.file.buffer);

      if (process.platform === 'win32') {
        await printFileWindows(tmpFile, printerName, binDir);
      } else {
        await printFilePosix(tmpFile, printerName);
      }

      res.json({ ok: true, printer: printerName || 'default' });
    } catch (err) {
      next(err);
    } finally {
      if (tmpFile) try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  // Print raw text (plain-text only, sent as body)
  router.post('/print-text', async (req, res, next) => {
    let tmpFile = null;
    try {
      const printerName = req.body?.printer || req.query.printer || null;
      const text = req.body?.text;
      if (!text) return res.status(400).json({ error: 'Provide { text, printer? } in JSON body' });

      tmpFile = path.join(os.tmpdir(), `print-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, text, 'utf8');

      if (process.platform === 'win32') {
        await printFileWindows(tmpFile, printerName, binDir);
      } else {
        await printFilePosix(tmpFile, printerName);
      }

      res.json({ ok: true, printer: printerName || 'default' });
    } catch (err) {
      next(err);
    } finally {
      if (tmpFile) try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  return router;
};
