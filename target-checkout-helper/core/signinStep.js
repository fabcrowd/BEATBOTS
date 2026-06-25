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
   * @param {{ autoSignIn?: boolean, hasCredentials?: boolean, alreadyTried?: boolean }} opts
   * @returns {boolean}
   */
  function shouldAttemptGuest(opts) {
    opts = opts || {};
    if (opts.alreadyTried) return false;
    if (opts.autoSignIn && opts.hasCredentials) return false;
    return true;
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
    normalizeButtonText: normalizeButtonText,
    shouldAttemptGuest: shouldAttemptGuest,
    formatLoginStatusLabel: formatLoginStatusLabel,
    LOGIN_STATUS_LABELS: LOGIN_STATUS_LABELS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
