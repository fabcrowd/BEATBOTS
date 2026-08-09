#!/usr/bin/env node
/**
 * One automated drop-prep debug cycle (no user at keyboard).
 * Appends results to docs/autopilot/overnight/drop-prep-notes.md
 *
 * Usage: node scripts/drop-prep-cycle.mjs
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TASK_FILE = path.join(ROOT, 'docs/autopilot/overnight/drop-prep-4am.json');
const NOTES = path.join(ROOT, 'docs/autopilot/overnight/drop-prep-notes.md');
const LIVE = path.join(ROOT, 'docs/autopilot/overnight/it-live.md');
const ENV_REHEARSAL = path.join(ROOT, 'scripts/browser-smoke/.env.rehearsal');

function appendLive(lines) {
  const block = `\n## ${new Date().toISOString()} (@it cycle)\n\n${lines.join('\n')}\n`;
  fs.appendFileSync(LIVE, block);
}

function run(cmd, opts = {}) {
  const r = spawnSync('bash', ['-lc', cmd], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: opts.timeoutMs || 600000,
  });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

function appendNote(lines) {
  const block = `\n### Cycle ${new Date().toISOString()}\n\n${lines.join('\n')}\n`;
  fs.appendFileSync(NOTES, block);
}

const gates = [
  { name: 'verify.sh', cmd: 'bash scripts/verify.sh' },
  { name: 'test:extension', cmd: 'cd scripts/browser-smoke && xvfb-run -a npm run test:extension' },
  { name: 'untested-areas', cmd: 'node scripts/browser-smoke/untested-areas-test.mjs' },
];

const results = [];
let allOk = true;
for (const g of gates) {
  const r = run(g.cmd);
  results.push(`- **${g.name}:** ${r.ok ? 'PASS' : 'FAIL'}`);
  if (!r.ok) {
    allOk = false;
    results.push('```');
    results.push(r.out.trim().slice(-800));
    results.push('```');
  }
}

if (fs.existsSync(ENV_REHEARSAL)) {
  const r = run('cd scripts/browser-smoke && set -a && source .env.rehearsal && set +a && npm run checkout-rehearsal', {
    timeoutMs: 900000,
  });
  results.push(`- **checkout-rehearsal:** ${r.ok ? 'PASS' : 'FAIL (see log)'}`);
  if (!r.ok) {
    results.push('```');
    results.push(r.out.trim().slice(-1200));
    results.push('```');
  }
} else {
  results.push('- **checkout-rehearsal:** SKIP (no .env.rehearsal on host)');
}

const dropAt = process.env.TCH_DROP_EXPECTED_AT || '(set TCH_DROP_EXPECTED_AT)';
results.push(`- **dropExpectedAt env:** ${dropAt}`);
results.push(`- **cycle:** ${allOk ? 'ALL GATES GREEN' : 'FAILURES — see above'}`);

appendNote(results);
appendLive([
  '**Thought process:** automated gate cycle — verify extension paths before drop.',
  ...results,
  allOk ? '**Next:** keep cycling; boss agent works in Cloud Agent chat for code fixes.' : '**Next:** investigate failures above.',
]);

if (fs.existsSync(TASK_FILE)) {
  const data = JSON.parse(fs.readFileSync(TASK_FILE, 'utf8'));
  for (const req of data.requirements) {
    const verifications = req.verification || [];
    if (verifications.length === 0) continue;
    let verified = true;
    for (const cmd of verifications) {
      if (!run(cmd).ok) {
        verified = false;
        break;
      }
    }
    req.passes = verified;
  }
  if (!fs.existsSync(ENV_REHEARSAL) && data.requirements.find((r) => r.id === '6')) {
    const r6 = data.requirements.find((r) => r.id === '6');
    r6.stuck = true;
    r6.blockedReason = 'missing_credentials — add scripts/browser-smoke/.env.rehearsal on host for live rehearsal';
    r6.passes = false;
  }
  fs.writeFileSync(TASK_FILE, `${JSON.stringify(data, null, 2)}\n`);
}

console.log(results.join('\n'));
process.exit(allOk ? 0 : 1);
