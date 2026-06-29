// core/hosts.js — Retailer detection + cookie domain lists (shared: content + service worker).
// Loaded before content.js in manifest; importScripts from background.js.

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

  /** @type {typeof TARGET} */
  var WALMART = {
    id: 'walmart',
    label: 'Walmart',
    hostSuffixes: ['walmart.com'],
    cookieDomains: ['walmart.com'],
  };

  /** @type {typeof TARGET} */
  var SAMSCLUB = {
    id: 'samsclub',
    label: "Sam's Club",
    hostSuffixes: ['samsclub.com'],
    cookieDomains: ['samsclub.com'],
  };

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
   * @returns {'target'|'walmart'|'samsclub'|null}
   */
  function detectRetailer(url) {
    var host = hostnameFromUrl(url);
    if (!host) return null;
    if (matchesRetailer(host, TARGET)) return 'target';
    if (WALMART && matchesRetailer(host, WALMART)) return 'walmart';
    if (SAMSCLUB && matchesRetailer(host, SAMSCLUB)) return 'samsclub';
    return null;
  }

  /**
   * Cookie API domain filters for a retailer id.
   * @param {'target'|'walmart'|'samsclub'} retailerId
   * @returns {string[]}
   */
  function cookieDomainsFor(retailerId) {
    if (retailerId === 'target') return TARGET.cookieDomains.slice();
    if (retailerId === 'walmart' && WALMART) return WALMART.cookieDomains.slice();
    if (retailerId === 'samsclub' && SAMSCLUB) return SAMSCLUB.cookieDomains.slice();
    return [];
  }

  root.TCH_HOSTS = {
    TARGET: TARGET,
    WALMART: WALMART,
    SAMSCLUB: SAMSCLUB,
    detectRetailer: detectRetailer,
    cookieDomainsFor: cookieDomainsFor,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
