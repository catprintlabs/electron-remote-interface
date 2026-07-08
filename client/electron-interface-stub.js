// Drop-in replacement for electron-interface.js for use in Rails test/CI environments.
// Include this file instead of electron-interface.js — it redefines ElectronInterface
// with fake responses that match the real API shapes so Rails tests run without a
// running Electron app.

class ElectronInterface {
  constructor() {}

  status() {
    return ok({ platform: 'win32', 'root-directory': 'C:\\Users\\stub', versions: { app: '1.0.0-stub', pdfprint: '1.0.0-stub' } });
  }

  // File system
  fsList(path = '/') {
    return ok({
      path,
      entries: [
        { name: 'documents', isDir: true,  size: 0,     mtime: isoNow() },
        { name: 'ticket.pdf', isDir: false, size: 12345, mtime: isoNow() },
      ],
    });
  }
  fsStat(path)             { return ok({ path, isDir: false, size: 1024, mtime: isoNow(), ctime: isoNow() }); }
  fsRead()                 { return Promise.resolve('stub file content'); }
  fsDownload()             { return Promise.resolve(new Blob(['stub'], { type: 'application/octet-stream' })); }
  fsWrite()                { return ok({}); }
  fsAppend()               { return ok({}); }
  fsMkdir()                { return ok({}); }
  fsMove()                 { return ok({}); }
  fsCopyToNetwork()        { return ok({}); }
  fsDelete()               { return ok({}); }

  // Printers
  listPrinters() {
    return ok({
      printers: [
        { name: 'HP LaserJet Pro M404n', status: '3' },
        { name: 'Microsoft Print to PDF', status: '3' },
      ],
    });
  }
  print()    { return ok({ printer: 'HP LaserJet Pro M404n' }); }
  printText(){ return ok({ printer: 'HP LaserJet Pro M404n' }); }
  printUrl() { return ok({ printer: 'HP LaserJet Pro M404n' }); }

  // Scale
  scaleStatus() { return ok({ pluggedIn: true, weightLb: 1.23 }); }
  scaleWeight() { return ok({ weightLb: 1.23 }); }
  streamScale(callback) {
    let weight = 1.23;
    const id = setInterval(() => {
      weight = Math.max(0, weight + (Math.random() - 0.5) * 0.05);
      callback({ weightLb: Math.round(weight * 100) / 100 });
    }, 500);
    return () => clearInterval(id);
  }

  // Serial
  serialList()              { return ok({ ports: [{ path: 'COM3', manufacturer: 'FTDI' }] }); }
  serialStatus()            { return ok({ ports: [] }); }
  serialOpen(port)          { return ok({ port, baudRate: 9600 }); }
  serialClose()             { return ok({}); }
  serialWrite()             { return ok({ bytes: 4 }); }
  serialRead(port)          { return ok({ port, records: [] }); }
  streamSerial(port, callback) {
    const id = setInterval(() => callback({ port, hex: '48656c6c6f', text: 'Hello' }), 1000);
    return () => clearInterval(id);
  }
}

function ok(extra = {}) { return Promise.resolve({ ok: true, ...extra }); }
function isoNow()       { return new Date().toISOString(); }

if (typeof module !== 'undefined') module.exports = { ElectronInterface };
