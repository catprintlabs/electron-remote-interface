// Syntax-checks files that are never imported by other tests (e.g. Electron
// entry points) so parse errors are caught by `npm test`.
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const FILES = [
  'main.js',
  'preload.js',
  'renderer/app.js',
  'scripts/release.js',
];

describe('syntax check', () => {
  for (const file of FILES) {
    test(file, () => {
      execFileSync(process.execPath, ['--check', path.join(ROOT, file)]);
    });
  }
});
