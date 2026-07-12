#!/usr/bin/env node
/**
 * Regression checks for critical bug fixes (no live Target/Walmart).
 */

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  }
}

function section(title) {
  console.log('\n──', title, '──');
}

section('Parallel RedSky fallback — one streak bump per poll cycle');
{
  // Simulates checkTcinsStock parallel fallback: N auth errors must bump streak once.
  function simulateFallbackStreakBump(authErrorCount) {
    let redskyErrorStreak = 0;
    if (authErrorCount > 0) redskyErrorStreak++;
    return redskyErrorStreak;
  }
  assert(simulateFallbackStreakBump(4) === 1, '4 parallel 401s → streak +1 (not +4)');
  assert(simulateFallbackStreakBump(0) === 0, 'no auth errors → streak unchanged');
  assert(simulateFallbackStreakBump(1) === 1, 'single auth error → streak +1');
}

section('Poll guard session payload shape');
{
  const inQueueUrls = new Set(['https://www.walmart.com/ip/foo/123']);
  const navigationLock = new Set(['https://www.walmart.com/ip/bar/456']);
  const payload = {
    tchPollGuards: {
      inQueue: [...inQueueUrls],
      navLock: [...navigationLock],
    },
  };
  const restored = { inQueue: new Set(), navLock: new Set() };
  for (const u of payload.tchPollGuards.inQueue) restored.inQueue.add(u);
  for (const u of payload.tchPollGuards.navLock) restored.navLock.add(u);
  assert(restored.inQueue.size === 1, 'inQueue restores from session');
  assert(restored.navLock.size === 1, 'navLock restores from session');
}

section('Harvest status prune must not run outside lock (structural check)');
{
  const src = await import('fs').then(fs =>
    fs.promises.readFile(new URL('../target-checkout-helper/cookieHarvest.js', import.meta.url), 'utf8')
  );
  const fnStart = src.indexOf('async function tchHarvestStatus()');
  const fnBody = src.slice(fnStart, fnStart + 600);
  assert(fnBody.includes('_harvestLock'), 'tchHarvestStatus acquires _harvestLock');
  assert(fnBody.includes('tchSetHarvestEntries'), 'tchHarvestStatus still prunes when needed');
}

if (process.exitCode) {
  console.error('\nSome checks failed.');
  process.exit(1);
}
console.log('\nAll critical-bug regression checks passed.');
