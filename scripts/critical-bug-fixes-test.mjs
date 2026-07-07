#!/usr/bin/env node
/**
 * Regression checks for critical bug fixes (no browser).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

const content = read('target-checkout-helper/content.js');
const harvest = read('target-checkout-helper/cookieHarvest.js');
const background = read('target-checkout-helper/background.js');
const walmart = read('target-checkout-helper/walmart-content.js');

// Passive poll leak: interval cleared when monitor stops
assert(content.includes('let monitorPassivePollId'), 'monitorPassivePollId declared');
assert(content.includes('function stopMonitorPassivePoll'), 'stopMonitorPassivePoll helper');
assert(content.includes('if (!data.monitor?.active) stopMonitorPassivePoll()'), 'init clears poll when monitor off');
assert(content.includes('if (!pollMon?.active) { stopMonitorPassivePoll(); return; }'), 'poll checks monitor.active');

// Multi-tab: only assigned monitor tab runs ATC
assert(background.includes("case 'IS_MONITOR_TAB'"), 'IS_MONITOR_TAB handler');
assert(content.includes("type: 'IS_MONITOR_TAB'"), 'content asks IS_MONITOR_TAB');
assert(content.includes('not_monitor_tab'), 'non-assigned tab skips ATC');

// Harvest apply: do not consume snapshot when all cookie sets fail
assert(harvest.includes('if (setOk === 0)'), 'harvest apply checks setOk');
assert(harvest.includes("reason: 'cookie_set_failed'"), 'harvest apply returns cookie_set_failed');
assert(harvest.includes('_harvestLock'), 'harvest apply uses lock');

// BIN pending: guard ATC_SUCCESS on stale checkout loads
assert(content.includes('BIN pending cleared without ATC_SUCCESS'), 'BIN pending guard');

// Walmart init concurrency: outer finally owns wmInitInFlight
assert(!walmart.includes('wmInitInFlight = false;\n      return;\n    }\n    if (onLoginPage)'),
  'wmInit does not clear inFlight before login redirect');
assert(!/onLoginPage\)[\s\S]{0,400}wmInitInFlight = false/.test(walmart),
  'wmInit does not clear inFlight on login page branch');

if (process.exitCode) {
  console.error('\ncritical-bug-fixes-test: FAILED');
  process.exit(1);
}
console.log('\ncritical-bug-fixes-test: all checks passed');
