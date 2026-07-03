#!/usr/bin/env node
/**
 * WM-3: Queue-it MAIN-world WebSocket sniff → TCH_QUEUE_PASSED on documentElement.
 * Offline vm sandbox — mirrors scripts/walmart-bot-test.mjs WebSocket section.
 *
 * Run: node scripts/browser-smoke/walmart-main-world-simulation.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '../../target-checkout-helper');
const MAIN_WORLD_CODE = fs.readFileSync(path.join(EXT, 'walmart-main-world.js'), 'utf8');

class FakeWS {
  constructor(url) {
    this.url = url;
    this._listeners = {};
  }
  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }
  _emit(type, data) {
    for (const fn of this._listeners[type] || []) fn(data);
  }
}
FakeWS.CONNECTING = 0;
FakeWS.OPEN = 1;
FakeWS.CLOSING = 2;
FakeWS.CLOSED = 3;
FakeWS.prototype.CONNECTING = 0;
FakeWS.prototype.OPEN = 1;

function loadPatchedWebSocket() {
  const capturedEvents = [];
  const docElListeners = new Map();

  const docEl = {
    dispatchEvent(e) {
      capturedEvents.push(e);
      const listeners = docElListeners.get(e.type) || [];
      for (const fn of listeners) fn(e);
      return true;
    },
    addEventListener(type, fn) {
      if (!docElListeners.has(type)) docElListeners.set(type, []);
      docElListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = docElListeners.get(type);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    },
  };

  const sandbox = {
    window: { WebSocket: FakeWS },
    document: { documentElement: docEl },
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
        this.bubbles = init?.bubbles;
        this.composed = init?.composed;
      }
    },
    console,
    JSON,
    String,
    RegExp,
  };
  sandbox.window.WebSocket = FakeWS;
  vm.createContext(sandbox);
  vm.runInContext(MAIN_WORLD_CODE, sandbox);

  return {
    PatchedWS: sandbox.window.WebSocket,
    docEl,
    capturedEvents,
  };
}

function runMainWorldWebSocketTests() {
  const { PatchedWS, capturedEvents } = loadPatchedWebSocket();

  capturedEvents.length = 0;
  const ws1 = new PatchedWS('wss://queue-it.walmart.com/ws');
  ws1._emit('message', { data: JSON.stringify({ type: 'queuePassed' }) });
  assert.equal(capturedEvents.length, 1, 'queuePassed fires TCH_QUEUE_PASSED');
  assert.equal(capturedEvents[0]?.type, 'TCH_QUEUE_PASSED', 'correct event type');
  assert.equal(capturedEvents[0]?.bubbles, true, 'event bubbles to content script');
  assert.equal(capturedEvents[0]?.composed, true, 'event crosses shadow boundaries');

  capturedEvents.length = 0;
  const ws2 = new PatchedWS('wss://queueit.example.com/ws');
  ws2._emit('message', { data: JSON.stringify({ type: 'QueuePassed' }) });
  assert.equal(capturedEvents.length, 1, 'QueuePassed (capitalized) fires event');

  capturedEvents.length = 0;
  const ws3 = new PatchedWS('wss://queue-it.walmart.com/ws');
  ws3._emit('message', { data: JSON.stringify({ position: 0 }) });
  assert.equal(capturedEvents.length, 1, 'position 0 fires event');

  capturedEvents.length = 0;
  const ws4 = new PatchedWS('wss://queue.it-service.com/ws');
  ws4._emit('message', { data: JSON.stringify({ queueState: 'passed' }) });
  assert.equal(capturedEvents.length, 1, 'queueState passed fires event');

  capturedEvents.length = 0;
  const ws5 = new PatchedWS('wss://www.walmart.com/api/cart');
  ws5._emit('message', { data: JSON.stringify({ type: 'queuePassed' }) });
  assert.equal(capturedEvents.length, 0, 'non-queue URL ignored');

  capturedEvents.length = 0;
  const ws6 = new PatchedWS('wss://queue-it.walmart.com/ws');
  ws6._emit('message', { data: new ArrayBuffer(8) });
  assert.equal(capturedEvents.length, 0, 'binary message silently ignored');

  capturedEvents.length = 0;
  const ws7 = new PatchedWS('wss://queue-it.walmart.com/ws');
  ws7._emit('message', { data: 'not-json{{{' });
  assert.equal(capturedEvents.length, 0, 'invalid JSON silently ignored');

  capturedEvents.length = 0;
  const ws8 = new PatchedWS('wss://queue-it.walmart.com/ws');
  ws8._emit('message', { data: JSON.stringify({ position: 5 }) });
  assert.equal(capturedEvents.length, 0, 'position > 0 does not fire');

  assert.equal(PatchedWS.CONNECTING, 0, 'CONNECTING constant preserved');
  assert.equal(PatchedWS.OPEN, 1, 'OPEN constant preserved');
  assert.equal(PatchedWS.CLOSING, 2, 'CLOSING constant preserved');
  assert.equal(PatchedWS.CLOSED, 3, 'CLOSED constant preserved');
}

function runDocumentElementListenerTests() {
  const { PatchedWS, docEl } = loadPatchedWebSocket();
  let queuePassedSignal = false;
  const onQueuePassed = () => {
    queuePassedSignal = true;
  };
  docEl.addEventListener('TCH_QUEUE_PASSED', onQueuePassed);

  const ws = new PatchedWS('wss://queue-it.walmart.com/ws');
  ws._emit('message', { data: JSON.stringify({ type: 'queuePassed', position: 0 }) });
  assert.equal(queuePassedSignal, true, 'documentElement listener receives TCH_QUEUE_PASSED');

  docEl.removeEventListener('TCH_QUEUE_PASSED', onQueuePassed);
}

function main() {
  runMainWorldWebSocketTests();
  runDocumentElementListenerTests();
  console.log(
    'walmart-main-world-simulation PASS (WM-3): Queue-it WebSocket → TCH_QUEUE_PASSED on documentElement'
  );
}

main();
