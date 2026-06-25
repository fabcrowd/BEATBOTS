/**
 * Structured blockedReason codes and TCH log helpers for checkout-rehearsal.mjs.
 * Run: node scripts/browser-smoke/rehearsal-errors.mjs
 */

export const BLOCKED_REASON = {
  MISSING_PRODUCT_URL: 'missing_product_url',
  NO_CHROMIUM: 'no_chromium',
  NO_DISPLAY: 'no_display',
  REVIEW_TIMEOUT: 'review_timeout',
  SIGNIN_TIMEOUT: 'signin_timeout',
  OOS_OR_ATC_FAILED: 'oos_or_atc_failed',
};

/**
 * @param {string[]} lines
 * @param {number} [n]
 * @returns {string[]}
 */
export function tailTchLines(lines, n = 15) {
  const filtered = (lines || []).filter((l) => String(l).includes('[TCH]'));
  return filtered.slice(-n);
}

/**
 * @param {string} code
 * @param {string} message
 * @param {string[]} [tchLines]
 * @returns {string}
 */
export function formatRehearsalFail(code, message, tchLines = []) {
  const tail = tailTchLines(tchLines);
  const parts = [`blockedReason: ${code}`, message];
  if (tail.length > 0) {
    parts.push('Last [TCH] lines:', ...tail);
  }
  return parts.join('\n');
}

/**
 * @param {string} code
 * @param {string} message
 * @param {string[]} [tchLines]
 * @returns {never}
 */
export function exitRehearsal(code, message, tchLines = []) {
  console.error('\nCHECKOUT REHEARSAL FAIL');
  console.error(formatRehearsalFail(code, message, tchLines));
  process.exit(1);
}

function selfTest() {
  const lines = Array.from({ length: 20 }, (_, i) => `[TCH] line ${i}`);
  const tail = tailTchLines(lines, 15);
  if (tail.length !== 15 || !tail[0].includes('line 5')) {
    console.error('FAIL: tailTchLines');
    process.exit(1);
  }
  const msg = formatRehearsalFail(BLOCKED_REASON.REVIEW_TIMEOUT, 'timed out', lines);
  if (!msg.includes('blockedReason: review_timeout') || !msg.includes('line 19')) {
    console.error('FAIL: formatRehearsalFail');
    process.exit(1);
  }
  console.log('rehearsal-errors.mjs: PASS');
}

const isMain = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('rehearsal-errors.mjs');
if (isMain) {
  selfTest();
}
