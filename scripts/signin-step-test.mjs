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

assert(S.classifyWalmartLoginPath('/account/login'), 'walmart login path');
assert(!S.classifyWalmartLoginPath('/ip/123456'), 'walmart product not login');
assert(
  S.shouldRedirectToWalmartLogin({ useSavedSession: false, isLoggedIn: false, path: '/ip/1' }),
  'redirect when saved session off and logged out'
);
assert(
  !S.shouldRedirectToWalmartLogin({ useSavedSession: false, isLoggedIn: false, path: '/account/login' }),
  'no redirect when already on login'
);
assert(
  !S.shouldRedirectToWalmartLogin({ useSavedSession: true, isLoggedIn: false, path: '/ip/1' }),
  'no redirect when saved session on'
);
assert(typeof S.WALMART_LOGIN_WAIT_MESSAGE === 'string' && S.WALMART_LOGIN_WAIT_MESSAGE.length > 10, 'walmart message');

assert(Array.isArray(S.GUEST_BUTTON_NEEDLES) && S.GUEST_BUTTON_NEEDLES.length >= 4, 'needles exported');

assert(!S.isGenericContinueButtonText('Continue as guest'), 'guest is not generic continue');
assert(S.isGenericContinueButtonText('Continue'), 'plain continue matches');
assert(S.isGenericContinueButtonText('Save & continue'), 'save and continue matches');

assert(
  S.resolveCheckoutStep({ hasAuthGate: true, hasShippingFields: true, useSavedPayment: true, hasEnabledContinueButton: true }) === 'signin',
  'auth gate before shipping/saved'
);
assert(
  S.resolveCheckoutStep({ hasPlaceOrder: true, hasAuthGate: true }) === 'review',
  'review before signin'
);
assert(
  S.resolveCheckoutStep({ useSavedPayment: true, hasEnabledContinueButton: true }) === 'saved',
  'saved when continue present'
);
assert(
  S.resolveCheckoutStep({ hasPaymentShell: true }) === 'payment',
  'wallet-only payment shell routes to payment step'
);
assert(
  S.resolveCheckoutStep({ hasPaymentShell: true, hasAuthGate: true }) === 'signin',
  'auth gate before wallet payment shell'
);
assert(S.resolveCheckoutStep({}) === 'unknown', 'empty signals unknown');

assert(S.shouldAutoSignInOnCheckoutPending('unknown', true), 'auto signin on unknown with creds');
assert(S.shouldAutoSignInOnCheckoutPending('signin', true), 'auto signin on signin with creds');
assert(!S.shouldAutoSignInOnCheckoutPending('unknown', false), 'no auto signin without creds');
assert(!S.shouldAutoSignInOnCheckoutPending('shipping', true), 'no auto signin on shipping');

assert(S.shouldAttemptGuest({ autoSignIn: true, hasCredentials: false, alreadyTried: false }), 'guest when auto signin but incomplete creds');

assert(S.shouldRetryCheckoutPending({ step: 'signin', lastAttemptMs: 0, nowMs: 4000, retryCount: 0 }), 'retry signin after interval');
assert(!S.shouldRetryCheckoutPending({ step: 'signin', lastAttemptMs: 0, nowMs: 1000, retryCount: 0 }), 'no retry before interval');
assert(!S.shouldRetryCheckoutPending({ step: 'signin', lastAttemptMs: 0, nowMs: 5000, retryCount: 15 }), 'stop at max retries');
assert(!S.shouldRetryCheckoutPending({ step: 'shipping', lastAttemptMs: 0, nowMs: 5000, retryCount: 0 }), 'no retry on shipping');
assert(!S.shouldRetryCheckoutPending({ step: 'signin', lastAttemptMs: 0, nowMs: 5000, retryCount: 0, signInInFlight: true }), 'no retry while sign-in in flight');

if (process.exitCode === 1) {
  console.error('\nSign-in step tests failed.');
  process.exit(1);
}
console.log('All sign-in step tests passed.');
