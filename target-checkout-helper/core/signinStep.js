// core/signinStep.js — Target sign-in path + guest-checkout helpers (content + popup + Node tests).

(function (root) {
  'use strict';

  var GUEST_BUTTON_NEEDLES = [
    'continue as guest',
    'checkout as guest',
    'guest checkout',
    'continue as a guest',
  ];

  var LOGIN_STATUS_LABELS = {
    login: { ok: 'Yes', fail: 'Not logged in', unknown: 'Open a Target tab', checking: 'Checking…' },
  };

  var WALMART_LOGIN_WAIT_MESSAGE =
    'Walmart login — complete captcha if shown; 2FA can be filled from email when enabled.';

  function normalizeButtonText(text) {
    return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * @param {string} path - URL pathname
   * @returns {boolean}
   */
  function classifyPathAsSignin(path) {
    return /^\/(?:account\/)?(?:login|signin)/i.test(path || '');
  }

  /**
   * @param {string} path - URL pathname
   * @returns {boolean}
   */
  function classifyWalmartLoginPath(path) {
    return /^\/account\/login/i.test(path || '');
  }

  /**
   * @param {{ useSavedSession?: boolean, isLoggedIn?: boolean, path?: string }} opts
   * @returns {boolean}
   */
  function shouldRedirectToWalmartLogin(opts) {
    opts = opts || {};
    if (opts.useSavedSession !== false) return false;
    if (opts.isLoggedIn) return false;
    if (classifyWalmartLoginPath(opts.path)) return false;
    return true;
  }

  /**
   * @param {string} text
   * @returns {boolean}
   */
  function matchesGuestCheckoutText(text) {
    var norm = normalizeButtonText(text);
    for (var i = 0; i < GUEST_BUTTON_NEEDLES.length; i++) {
      if (norm.includes(GUEST_BUTTON_NEEDLES[i])) return true;
    }
    return false;
  }

  /**
   * Continue/save buttons on checkout — excludes guest-checkout labels.
   * @param {string} text
   * @returns {boolean}
   */
  function isGenericContinueButtonText(text) {
    var norm = normalizeButtonText(text);
    if (matchesGuestCheckoutText(text)) return false;
    if (/shopping|browsing|browse|exploring|reading/i.test(norm)) return false;
    var patterns = ['save & continue', 'save and continue', 'continue', 'next'];
    for (var i = 0; i < patterns.length; i++) {
      var p = patterns[i];
      if (norm === p || norm.indexOf(p) === 0) return true;
    }
    return false;
  }

  /**
   * Pure checkout step resolver (DOM signals collected by content.js).
   * @param {{
   *   hasPlaceOrder?: boolean,
   *   hasAuthGate?: boolean,
   *   hasCardNumber?: boolean,
   *   hasShippingFields?: boolean,
   *   useSavedPayment?: boolean,
   *   hasEnabledContinueButton?: boolean,
   * }} opts
   * @returns {'review'|'signin'|'payment'|'shipping'|'saved'|'unknown'}
   */
  function resolveCheckoutStep(opts) {
    opts = opts || {};
    if (opts.hasPlaceOrder) return 'review';
    if (opts.hasAuthGate) return 'signin';
    if (opts.hasCardNumber) return 'payment';
    if (opts.hasShippingFields) return 'shipping';
    if (opts.useSavedPayment && opts.hasEnabledContinueButton) return 'saved';
    return 'unknown';
  }

  /**
   * @param {'signin'|'unknown'|string} step
   * @param {boolean} hasCredentials
   * @returns {boolean}
   */
  function shouldAutoSignInOnCheckoutPending(step, hasCredentials) {
    if (!hasCredentials) return false;
    return step === 'signin' || step === 'unknown';
  }

  var AUTH_WARMUP_MAX_AGE_MS = 30 * 60 * 1000;

  /**
   * @param {number} [warmupAtMs]
   * @param {number} [nowMs]
   * @returns {boolean}
   */
  function isAuthWarmupRecent(warmupAtMs, nowMs) {
    if (!warmupAtMs || warmupAtMs <= 0) return false;
    var now = nowMs != null ? nowMs : Date.now();
    return now - warmupAtMs < AUTH_WARMUP_MAX_AGE_MS;
  }

  /**
   * Skip automated email entry at checkout when session was warmed or looks signed in.
   * @param {{
   *   looksLoggedIn?: boolean,
   *   warmupAtMs?: number,
   *   nowMs?: number,
   *   checkoutAuthError?: boolean,
   *   isCreateAccountModal?: boolean,
   *   isSignedInConfirm?: boolean,
   * }} opts
   * @returns {boolean}
   */
  function shouldSkipCheckoutEmailFlow(opts) {
    opts = opts || {};
    if (opts.checkoutAuthError) return true;
    var warm = !!opts.looksLoggedIn || isAuthWarmupRecent(opts.warmupAtMs, opts.nowMs);
    if (!warm) return false;
    return !!(opts.isCreateAccountModal || opts.isSignedInConfirm);
  }

  /**
   * @param {{
   *   looksLoggedIn?: boolean,
   *   warmupAtMs?: number,
   *   nowMs?: number,
   *   isSignedInConfirm?: boolean,
   * }} opts
   * @returns {boolean}
   */
  function shouldPreferSignedInContinue(opts) {
    opts = opts || {};
    if (opts.isSignedInConfirm) return true;
    if (opts.looksLoggedIn) return true;
    return isAuthWarmupRecent(opts.warmupAtMs, opts.nowMs);
  }

  /**
   * @param {{ autoSignIn?: boolean, hasCredentials?: boolean, alreadyTried?: boolean, useSavedPayment?: boolean }} opts
   * @returns {boolean}
   */
  function shouldAttemptGuest(opts) {
    opts = opts || {};
    if (opts.alreadyTried) return false;
    if (opts.useSavedPayment) return false;
    if (opts.autoSignIn && opts.hasCredentials) return false;
    return true;
  }

  /**
   * Throttled retry while checkout watcher stays on sign-in or loading shell.
   * @param {{
   *   step?: string,
   *   lastAttemptMs?: number,
   *   nowMs?: number,
   *   retryCount?: number,
   *   intervalMs?: number,
   *   maxRetries?: number,
   * }} opts
   * @returns {boolean}
   */
  function shouldRetryCheckoutPending(opts) {
    opts = opts || {};
    if (opts.signInInFlight) return false;
    var step = opts.step;
    if (step !== 'signin' && step !== 'unknown') return false;
    var maxRetries = opts.maxRetries != null ? opts.maxRetries : 15;
    var retryCount = opts.retryCount || 0;
    if (retryCount >= maxRetries) return false;
    var intervalMs = opts.intervalMs != null ? opts.intervalMs : 3000;
    var lastAttemptMs = opts.lastAttemptMs || 0;
    var nowMs = opts.nowMs != null ? opts.nowMs : Date.now();
    return nowMs - lastAttemptMs >= intervalMs;
  }

  /**
   * @param {'ok'|'fail'|'unknown'|'checking'} state
   * @param {string} [labelKey]
   * @returns {string}
   */
  function formatLoginStatusLabel(state, labelKey) {
    var key = labelKey || 'login';
    var map = LOGIN_STATUS_LABELS[key] || {};
    return map[state] != null ? map[state] : (state === 'checking' ? 'Checking…' : '—');
  }

  root.TCH_SIGNIN_STEP = {
    GUEST_BUTTON_NEEDLES: GUEST_BUTTON_NEEDLES,
    WALMART_LOGIN_WAIT_MESSAGE: WALMART_LOGIN_WAIT_MESSAGE,
    classifyPathAsSignin: classifyPathAsSignin,
    classifyWalmartLoginPath: classifyWalmartLoginPath,
    shouldRedirectToWalmartLogin: shouldRedirectToWalmartLogin,
    matchesGuestCheckoutText: matchesGuestCheckoutText,
    isGenericContinueButtonText: isGenericContinueButtonText,
    resolveCheckoutStep: resolveCheckoutStep,
    shouldAutoSignInOnCheckoutPending: shouldAutoSignInOnCheckoutPending,
    normalizeButtonText: normalizeButtonText,
    AUTH_WARMUP_MAX_AGE_MS: AUTH_WARMUP_MAX_AGE_MS,
    isAuthWarmupRecent: isAuthWarmupRecent,
    shouldSkipCheckoutEmailFlow: shouldSkipCheckoutEmailFlow,
    shouldPreferSignedInContinue: shouldPreferSignedInContinue,
    shouldAttemptGuest: shouldAttemptGuest,
    shouldRetryCheckoutPending: shouldRetryCheckoutPending,
    formatLoginStatusLabel: formatLoginStatusLabel,
    LOGIN_STATUS_LABELS: LOGIN_STATUS_LABELS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
