// core/debuggerBridge.js — chrome.debugger attach/detach (service worker only).
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

  /**
   * @param {number} tabId
   * @param {string} [tabUrl] optional for policy check
   */
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
          resolve({ ok: false, reason: 'not_target', hint: 'Enable “Debugger on any tab” in Advanced (risky) or open a Target tab.' });
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
    return Promise.resolve({ attached: attachedTabId !== null, tabId: attachedTabId });
  };

  chrome.debugger.onDetach.addListener(function () {
    attachedTabId = null;
  });

  chrome.tabs.onRemoved.addListener(function (tabId) {
    if (tabId === attachedTabId) attachedTabId = null;
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
