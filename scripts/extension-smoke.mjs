#!/usr/bin/env node
/**
 * Automated smoke for Target Checkout Helper (no Chrome).
 * Run: node scripts/extension-smoke.mjs
 */
import { execSync } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

function playwrightChromiumReady(smokeDir) {
  try {
    const req = createRequire(path.join(smokeDir, 'package.json'));
    const { chromium } = req('playwright');
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const extRoot = path.join(repoRoot, 'target-checkout-helper');

function mustExist(rel, label = rel) {
  const p = path.join(extRoot, rel);
  if (!fs.existsSync(p)) {
    console.error(`FAIL: missing ${label} → ${p}`);
    process.exit(1);
  }
}

function collectManifestPaths(manifest) {
  const out = new Set();
  out.add(manifest.background.service_worker);
  out.add(manifest.action.default_popup);
  for (const cs of manifest.content_scripts || []) {
    for (const j of cs.js || []) out.add(j);
  }
  const di = manifest.action?.default_icon || {};
  for (const v of Object.values(di)) out.add(v);
  const ic = manifest.icons || {};
  for (const v of Object.values(ic)) out.add(v);
  return [...out];
}

const manifest = JSON.parse(fs.readFileSync(path.join(extRoot, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) {
  console.error('FAIL: expected MV3');
  process.exit(1);
}

for (const rel of collectManifestPaths(manifest)) {
  mustExist(rel);
}
mustExist('popup.css');

const extraJs = ['popup.js'];
for (const rel of extraJs) {
  mustExist(rel);
}

const jsToCheck = new Set();
for (const rel of collectManifestPaths(manifest)) {
  if (rel.endsWith('.js')) jsToCheck.add(rel);
}
for (const rel of extraJs) jsToCheck.add(rel);

for (const rel of [...jsToCheck].sort()) {
  const p = path.join(extRoot, rel);
  execSync(`node --check "${p}"`, { stdio: 'inherit' });
}

execSync('node scripts/checkout-speed-test.mjs', {
  cwd: repoRoot,
  stdio: 'inherit',
});

const browserSmokeDir = path.join(repoRoot, 'scripts', 'browser-smoke');
const browserSmokePkg = path.join(browserSmokeDir, 'node_modules');
if (fs.existsSync(browserSmokePkg)) {
  if (!playwrightChromiumReady(browserSmokeDir)) {
    console.log('\n--- Installing Playwright Chromium (first run; large download) ---');
    execSync('npm run install-chromium', { cwd: browserSmokeDir, stdio: 'inherit' });
  }
  execSync('node run.mjs', { cwd: browserSmokeDir, stdio: 'inherit' });
} else {
  console.log('\n(skip) scripts/browser-smoke: run npm install in scripts/browser-smoke for browser load test');
}

console.log('\nSMOKE OK (automated): manifest + assets + syntax + drop-polling test.');
console.log(
  'Browser load test: cd scripts/browser-smoke && npm install && npm run install-chromium && node run.mjs'
);
console.log(
  'Puppeteer E2E + functional (background + popup): cd scripts/browser-smoke && npm run test:extension'
);
console.log('Manual: chrome://extensions → Load unpacked → target-checkout-helper/');
