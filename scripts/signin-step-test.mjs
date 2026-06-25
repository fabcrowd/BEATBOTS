#!/usr/bin/env node
/**
 * Node tests for target-checkout-helper/core/signinStep.js (no browser).
 */

import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const signinPath = path.join(__dirname, '../target-checkout-helper/core/signinStep.js');
const code = fs.readFileSync(signinPath, 'utf8');

function loadSigninStep() {
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.TCH_SIGNIN_STEP;
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  }
}

const S = loadSigninStep();

assert(S.classifyPathAsSignin('/login'), '/login is signin');
assert(S.classifyPathAsSignin('/account/login'), '/account/login is signin');
assert(S.classifyPathAsSignin('/signin'), '/signin is signin');
assert(!S.classifyPathAsSignin('/checkout'), '/checkout is not signin path');

assert(S.matchesGuestCheckoutText('Continue as Guest'), 'guest text case-insensitive');
assert(S.matchesGuestCheckoutText('  Checkout   as   guest  '), 'guest text normalizes whitespace');
assert(!S.matchesGuestCheckoutText('Sign in'), 'sign in is not guest');

assert(S.shouldAttemptGuest({ autoSignIn: false, hasCredentials: false, alreadyTried: false }), 'guest when no auto signin');
assert(!S.shouldAttemptGuest({ autoSignIn: true, hasCredentials: true, alreadyTried: false }), 'skip guest when auto signin');
assert(!S.shouldAttemptGuest({ autoSignIn: false, hasCredentials: false, alreadyTried: true }), 'skip when already tried');

assert(S.formatLoginStatusLabel('checking') === 'Checking…', 'checking label');
assert(S.formatLoginStatusLabel('ok') === 'Yes', 'ok label');
assert(S.formatLoginStatusLabel('fail') === 'Not logged in', 'fail label');

assert(Array.isArray(S.GUEST_BUTTON_NEEDLES) && S.GUEST_BUTTON_NEEDLES.length >= 4, 'needles exported');

if (process.exitCode === 1) {
  console.error('\nSign-in step tests failed.');
  process.exit(1);
}
console.log('All sign-in step tests passed.');
