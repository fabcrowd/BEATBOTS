/**
 * Pure helpers for Target checkout reliability (cart empty, high volume, API bypass).
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
    'page not working',
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

  /** Parse GET /web_checkouts/v1/cart JSON (pure). */
  function parseCartProbePayload(data) {
    const cart = data?.cart || data || {};
    const items = cart?.cart_items || data?.cart_items || [];
    const cartId = cart?.cart_id || data?.cart_id || '';
    const itemCount = Array.isArray(items) ? items.length : 0;
    return {
      hasItems: itemCount > 0,
      cartId: String(cartId || ''),
      itemCount,
    };
  }

  /** Backoff before cart page reload during high-volume (ms). */
  function cartApiReloadDelayMs(reloadCount) {
    const n = Math.max(0, Number(reloadCount) || 0);
    return Math.min(4000 + n * 4000, 16000);
  }

  root.TCH_CHECKOUT_RELIABILITY = {
    HIGH_VOLUME_NEEDLES,
    EMPTY_CART_RE,
    hasHighVolumeBlock,
    isCartEmptyText,
    shouldRetryFromProductAfterCartFailure,
    parseCartProbePayload,
    cartApiReloadDelayMs,
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
