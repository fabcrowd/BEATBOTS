/**
 * Pure helpers for Target checkout reliability (cart empty, high volume).
 * Loaded in content.js and tested via Node (scripts/checkout-reliability-test.mjs).
 */
(function (root) {
  const HIGH_VOLUME_NEEDLES = [
    'high volume',
    'unusually high traffic',
    'experiencing issues',
    'try again later',
    'something went wrong',
    "we're sorry",
    'temporarily unavailable',
    'please try again',
    "couldn't load",
    "can't load",
    'unable to load',
    'cart is unavailable',
    'too many requests',
  ];

  const EMPTY_CART_RE = /your cart is empty|cart is empty|no items in your cart|looks like your cart is empty/i;

  function hasHighVolumeBlock(bodyText) {
    const text = String(bodyText || '').toLowerCase();
    return HIGH_VOLUME_NEEDLES.some((needle) => text.includes(needle));
  }

  function isCartEmptyText(bodyText) {
    return EMPTY_CART_RE.test(String(bodyText || ''));
  }

  function shouldRetryFromProductAfterCartFailure(reason) {
    return /cart empty|not confirmed/i.test(String(reason || ''));
  }

  root.TCH_CHECKOUT_RELIABILITY = {
    HIGH_VOLUME_NEEDLES,
    EMPTY_CART_RE,
    hasHighVolumeBlock,
    isCartEmptyText,
    shouldRetryFromProductAfterCartFailure,
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
