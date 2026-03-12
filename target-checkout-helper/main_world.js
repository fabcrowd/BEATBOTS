// main_world.js — runs in the page's MAIN world (see manifest.json).
// Has full access to window.__CONFIG__ which is inaccessible from the
// isolated-world content script. Writes API keys into DOM dataset
// attributes that content.js can then read and forward to the background SW.

(function () {
  var INT = 250, MAX = 10000, elapsed = 0;

  function attempt() {
    var svc = window.__CONFIG__ && window.__CONFIG__.services;
    var key = svc
      ? ((svc.auth && svc.auth.apiKey) || (svc.apiPlatform && svc.apiPlatform.apiKey) || '')
      : '';
    var base = (svc && svc.redsky && svc.redsky.baseUrl) || 'https://redsky.target.com';
    // Carts service uses a different API key for cart mutations.
    var cartsKey = (svc && svc.carts && svc.carts.apiKey) || '';
    var cartsBase = (svc && svc.carts && svc.carts.baseUrl) || 'https://carts.target.com';

    if (key) {
      document.documentElement.dataset.tchKey      = key;
      document.documentElement.dataset.tchRedsky   = base;
      document.documentElement.dataset.tchCartsKey = cartsKey;
      document.documentElement.dataset.tchCartsBase = cartsBase;
      // Signal the isolated-world content script.
      document.documentElement.dispatchEvent(new CustomEvent('__tch_api_key__'));
    } else if (elapsed < MAX) {
      elapsed += INT;
      setTimeout(attempt, INT);
    }
  }

  attempt();
}());
