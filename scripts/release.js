#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const version = process.argv[2];
if (!version) {
  console.error('Usage: npm run release <version>');
  console.error('Example: npm run release 1.0.0-alpha.3');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Invalid version: "${version}". Must start with x.y.z`);
  process.exit(1);
}

const pkgPath = path.resolve(__dirname, '../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`✓ package.json → ${version}`);

execSync('npm install --package-lock-only --ignore-scripts', { stdio: 'inherit' });

execSync(`git add package.json package-lock.json`, { stdio: 'inherit' });
execSync(`git commit -m "Release v${version}"`, { stdio: 'inherit' });
execSync(`git tag v${version}`, { stdio: 'inherit' });
execSync(`git push`, { stdio: 'inherit' });
execSync(`git push origin v${version}`, { stdio: 'inherit' });

console.log(`\nRelease v${version} pushed — GitHub Actions will build the installers.`);
console.log(`https://github.com/catprintlabs/electron-remote-interface/actions`);
