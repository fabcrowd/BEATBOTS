#!/usr/bin/env node
/**
 * Refresh overnight repo-health tasks before an unattended run.
 *
 * - Runs verification commands; sets passes=false when a check fails.
 * - Resets all requirements with "recurring": true (default for overnight).
 *
 * Usage:
 *   node scripts/refresh-overnight-tasks.mjs
 *   node scripts/refresh-overnight-tasks.mjs --no-reset-recurring
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TASK_FILE = path.join(ROOT, 'docs/autopilot/overnight/repo-health.json');

const resetRecurring = !process.argv.includes('--no-reset-recurring');

function runCmd(cmd) {
  const r = spawnSync('bash', ['-lc', cmd], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0;
}

const raw = JSON.parse(fs.readFileSync(TASK_FILE, 'utf8'));

for (const req of raw.requirements) {
  const verifications = req.verification || [];
  let verified = true;
  if (verifications.length > 0) {
    for (const cmd of verifications) {
      if (!runCmd(cmd)) {
        verified = false;
        break;
      }
    }
    req.passes = verified;
    if (req.tdd) {
      req.tdd.test = req.tdd.test || {};
      req.tdd.implement = req.tdd.implement || {};
      req.tdd.refactor = req.tdd.refactor || {};
      req.tdd.test.passes = verified;
      req.tdd.implement.passes = verified;
      req.tdd.refactor.passes = verified;
    }
  } else if (resetRecurring && req.recurring) {
    req.passes = false;
    if (req.tdd) {
      if (req.tdd.test) req.tdd.test.passes = false;
      if (req.tdd.implement) req.tdd.implement.passes = false;
      if (req.tdd.refactor) req.tdd.refactor.passes = false;
    }
    delete req.stuck;
    delete req.blockedReason;
  }
}

const incomplete = raw.requirements.filter((r) => r.passes !== true && r.stuck !== true).length;
console.log(`Refreshed ${TASK_FILE}`);
console.log(`  Incomplete requirements: ${incomplete} / ${raw.requirements.length}`);

fs.writeFileSync(TASK_FILE, `${JSON.stringify(raw, null, 2)}\n`);
