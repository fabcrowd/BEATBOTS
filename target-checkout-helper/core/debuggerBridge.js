// core/debuggerBridge.js — chrome.debugger attach/detach/click (service worker only).
// importScripts from background.js after core/hosts.js.

(function (root) {
  'use strict';

  var CDP_VERSION = '1.3';
  var attachedTabId = null;

  function getAdvanced() {
    return new Promise(function (resolve) {
      chrome.storage.local.get('advancedSettings', function (data) {
        resolve(data.advancedSettings || {});
      });
    });
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Generate a curved mouse path from (sx,sy) to (tx,ty) using a quadratic bezier.
  // Returns an array of {x, y} points.
  function buildMousePath(sx, sy, tx, ty) {
    var steps = randInt(8, 14);
    // Control point: offset perpendicular to the direct line
    var cx = (sx + tx) / 2 + randInt(-40, 40);
    var cy = (sy + ty) / 2 + randInt(-40, 40);
    var points = [];
    for (var i = 1; i <= steps; i++) {
      var t = i / steps;
      var u = 1 - t;
      // Quadratic bezier
      var x = Math.round(u * u * sx + 2 * u * t * cx + t * t * tx);
      var y = Math.round(u * u * sy + 2 * u * t * cy + t * t * ty);
      points.push({ x: x, y: y });
    }
    return points;
  }

  function sendCmd(tabId, method, params) {
    return new Promise(function (resolve, reject) {
      chrome.debugger.sendCommand({ tabId: tabId }, method, params || {}, function (result) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
  }

  // Simulate a human-ish mouse click at (x, y) on the given tab.
  root.tchDebuggerClick = function (tabId, x, y) {
    if (attachedTabId !== tabId) {
      return Promise.reject(new Error('debugger not attached to tab ' + tabId));
    }
    // Start from a random point near the top-left of the viewport
    var sx = randInt(20, 200);
    var sy = randInt(20, 200);
    var path = buildMousePath(sx, sy, x, y);

    var chain = Promise.resolve();
    // Move along path
    path.forEach(function (pt) {
      chain = chain.then(function () {
        return sendCmd(tabId, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: pt.x, y: pt.y,
        }).then(function () { return sleep(randInt(8, 18)); });
      });
    });
    // Press
    chain = chain.then(function () { return sleep(randInt(40, 90)); });
    chain = chain.then(function () {
      return sendCmd(tabId, 'Input.dispatchMouseEvent', {
        type: 'mousePressed', button: 'left', clickCount: 1, x: x, y: y,
      });
    });
    chain = chain.then(function () { return sleep(randInt(20, 60)); });
    // Release
    chain = chain.then(function () {
      return sendCmd(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased', button: 'left', clickCount: 1, x: x, y: y,
      });
    });
    return chain;
  };

  // Type a string into the focused element using key events.
  root.tchDebuggerType = function (tabId, text) {
    if (attachedTabId !== tabId) {
      return Promise.reject(new Error('debugger not attached to tab ' + tabId));
    }
    var chain = Promise.resolve();
    for (var i = 0; i < text.length; i++) {
      (function (ch) {
        chain = chain.then(function () {
          return sendCmd(tabId, 'Input.dispatchKeyEvent', {
            type: 'keyDown', text: ch,
          }).then(function () {
            return sendCmd(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', text: ch });
          }).then(function () {
            return sleep(randInt(30, 80));
          });
        });
      })(text[i]);
    }
    return chain;
  };

  // ── Attach / detach (existing API, unchanged) ────────────────────────────────

  root.tchDebuggerAttach = function (tabId, tabUrl) {
    return new Promise(function (resolve, reject) {
      if (typeof tabId !== 'number') {
        resolve({ ok: false, reason: 'bad_tab' });
        return;
      }
      getAdvanced().then(function (adv) {
        var allowAny = !!adv.allowDebuggerAnyTab;
        var retailer = null;
        if (typeof root.TCH_HOSTS !== 'undefined' && tabUrl) {
          retailer = root.TCH_HOSTS.detectRetailer(tabUrl);
        }
        if (!allowAny && retailer !== 'target') {
          resolve({ ok: false, reason: 'not_target', hint: 'Enable "Debugger on any tab" in Advanced (risky) or open a Target tab.' });
          return;
        }
        if (attachedTabId !== null && attachedTabId !== tabId) {
          root.tchDebuggerDetach().then(function () {
            return doAttach(tabId);
          }).then(resolve).catch(reject);
          return;
        }
        if (attachedTabId === tabId) {
          resolve({ ok: true, already: true, tabId: tabId });
          return;
        }
        doAttach(tabId).then(resolve).catch(reject);
      });
    });
  };

  // Auto-attach used internally by monitor (bypasses the Target-only policy check
  // since monitor tabs are always Target product pages).
  root.tchDebuggerAutoAttach = function (tabId) {
    if (attachedTabId === tabId) return Promise.resolve({ ok: true, already: true, tabId: tabId });
    if (attachedTabId !== null) {
      return root.tchDebuggerDetach().then(function () { return doAttach(tabId); });
    }
    return doAttach(tabId);
  };

  function doAttach(tabId) {
    return new Promise(function (resolve, reject) {
      chrome.debugger.attach({ tabId: tabId }, CDP_VERSION, function () {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        attachedTabId = tabId;
        chrome.debugger.sendCommand({ tabId: tabId }, 'Network.enable', {}, function () {
          if (chrome.runtime.lastError) {
            root.tchDebuggerDetach();
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve({ ok: true, tabId: tabId });
        });
      });
    });
  }

  root.tchDebuggerDetach = function () {
    return new Promise(function (resolve) {
      if (attachedTabId === null) {
        resolve({ ok: true, detached: false });
        return;
      }
      var id = attachedTabId;
      attachedTabId = null;
      chrome.debugger.detach({ tabId: id }, function () {
        resolve({ ok: true, detached: true });
      });
    });
  };

  root.tchDebuggerStatus = function () {
    return Promise.resolve({ ok: true, attached: attachedTabId !== null, tabId: attachedTabId });
  };

  chrome.debugger.onDetach.addListener(function () {
    attachedTabId = null;
  });

  chrome.tabs.onRemoved.addListener(function (tabId) {
    if (tabId === attachedTabId) attachedTabId = null;
  });

})(typeof globalThis !== 'undefined' ? globalThis : this);
