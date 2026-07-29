// core/monitorScope.js — retailer-scoped monitor poll helpers (popup + background + Node tests).

(function (root) {
  'use strict';

  /**
   * @param {*} value
   * @returns {boolean}
   */
  function isRetailerFilter(value) {
    if (value == null) return false;
    try {
      value.test('');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @param {RegExp|undefined|null} retailerFilter
   * @returns {'target'|'walmart'|'all'}
   */
  function resolvePollScope(retailerFilter) {
    if (!isRetailerFilter(retailerFilter)) return 'target';
    if (retailerFilter.test('https://www.walmart.com/ip/1')) return 'walmart';
    return 'target';
  }

  /**
   * @param {Array<{url?: string}>} products
   * @param {'target'|'walmart'|'all'|null|undefined} scope
   * @returns {Array<{url?: string}>}
   */
  function filterProductsByPollScope(products, scope) {
    const list = Array.isArray(products) ? products : [];
    if (scope === 'walmart') {
      return list.filter((p) => /walmart\.com/i.test(String(p?.url || '')));
    }
    if (scope === 'target') {
      return list.filter((p) => !/walmart\.com/i.test(String(p?.url || '')));
    }
    return list.slice();
  }

  root.TCH_MONITOR_SCOPE = {
    isRetailerFilter,
    resolvePollScope,
    filterProductsByPollScope,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
