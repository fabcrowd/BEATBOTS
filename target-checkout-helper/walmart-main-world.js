// walmart-main-world.js — MAIN world on walmart.com only.
// Sniffs Queue-it WebSocket frames so the isolated-world script can react faster than 1s DOM polling.

(function () {
  var OrigWS = window.WebSocket;
  function PatchedWS(url, protocols) {
    var ws = protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
    try {
      var u = String(url || '');
      if (/queue-?it|queueit|queue\.it/i.test(u)) {
        ws.addEventListener('message', function (e) {
          try {
            var raw = e.data;
            if (typeof raw !== 'string') return;
            var data = JSON.parse(raw);
            var t = data && (data.type || data.eventType || data.messageType);
            var pos = data && data.position;
            if (
              t === 'queuePassed' ||
              t === 'QueuePassed' ||
              pos === 0 ||
              (data && data.queueState === 'passed')
            ) {
              document.documentElement.dispatchEvent(
                new CustomEvent('TCH_QUEUE_PASSED', { bubbles: true, composed: true, detail: data })
              );
            }
          } catch (_) {}
        });
      }
    } catch (_) {}
    return ws;
  }
  PatchedWS.prototype = OrigWS.prototype;
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) {
    if (OrigWS[k] !== undefined) PatchedWS[k] = OrigWS[k];
  });
  window.WebSocket = PatchedWS;
})();
