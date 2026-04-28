// core/hosts.js — Retailer detection + cookie domain lists (shared: content + service worker).
// Loaded before content.js in manifest; importScripts from background.js.
// Walmart: reserved for future work (see tasks/todo.md).

(function (root) {
  'use strict';

  var TARGET = {
    id: 'target',
    label: 'Target',
    /** Hostnames (no port) that identify this retailer in the address bar */
    hostSuffixes: ['target.com'],
    /** Domains passed to chrome.cookies.getAll / snapshot filters */
    cookieDomains: ['target.com'],
  };

  /** @type {typeof TARGET | null} */
  var WALMART = null; // TODO: set to { id: 'walmart', label: 'Walmart', hostSuffixes: [...], cookieDomains: [...] }

  function hostnameFromUrl(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (e) {
      return '';
    }
  }

  function matchesRetailer(host, def) {
    if (!host || !def) return false;
    for (var i = 0; i < def.hostSuffixes.length; i++) {
      var suf = def.hostSuffixes[i].toLowerCase();
      if (host === suf || host.endsWith('.' + suf)) return true;
    }
    return false;
  }

  /**
   * @param {string} url
   * @returns {'target'|'walmart'|null}
   */
  function detectRetailer(url) {
    var host = hostnameFromUrl(url);
    if (!host) return null;
    if (matchesRetailer(host, TARGET)) return 'target';
    if (WALMART && matchesRetailer(host, WALMART)) return 'walmart';
    // Stub: recognize host for early-exit / TODO messaging (automation not shipped).
    if (host === 'walmart.com' || host.endsWith('.walmart.com')) return 'walmart';
    return null;
  }

  /**
   * Cookie API domain filters for a retailer id.
   * @param {'target'|'walmart'} retailerId
   * @returns {string[]}
   */
  function cookieDomainsFor(retailerId) {
    if (retailerId === 'target') return TARGET.cookieDomains.slice();
    if (retailerId === 'walmart' && WALMART) return WALMART.cookieDomains.slice();
    return [];
  }

  root.TCH_HOSTS = {
    TARGET: TARGET,
    detectRetailer: detectRetailer,
    cookieDomainsFor: cookieDomainsFor,
    /** Reserved — flip on when Walmart module lands */
    WALMART_ENABLED: false,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
