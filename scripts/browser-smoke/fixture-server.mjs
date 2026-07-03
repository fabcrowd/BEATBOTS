/**
 * Local HTTP server for FIX-2 fixture e2e — serves MOCK_URLS HTML on retailer hostnames
 * via Chrome --host-resolver-rules (127.0.0.1) + explicit port in test URLs.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK_URLS } from './test-scope.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Retailer hostname + path → fixture file (paths from fixtures' data-tch-path).
 * @type {Array<{ host: string, path: string, file: string, initLog: string, journey: string }>}
 */
export const FIXTURE_E2E_ROUTES = [
  {
    host: 'www.target.com',
    path: '/p/mock-product',
    file: MOCK_URLS.targetProduct,
    initLog: '[TCH] init',
    journey: 'TGT-1',
  },
  {
    host: 'www.target.com',
    path: '/checkout',
    file: MOCK_URLS.targetCheckoutReview,
    initLog: '[TCH] init',
    journey: 'TGT-4',
    invariants: ['tgt4-manual-review'],
  },
  {
    host: 'www.walmart.com',
    path: '/ip/mock-predrop/123',
    file: MOCK_URLS.walmartProductPreDrop,
    initLog: '[WMT] init',
    journey: 'WM-2',
    invariants: ['no-sacred-lock', 'nav-failed-releases-lock', 'wm2-repeated-nav-failed'],
  },
  {
    host: 'www.walmart.com',
    path: '/ip/mock-queue/456',
    file: MOCK_URLS.walmartProductQueue,
    initLog: '[WMT] init',
    journey: 'WM-4',
    invariants: ['sacred-lock', 'wm5-sacred-survives-nav-failed'],
  },
  {
    host: 'www.walmart.com',
    path: '/qp/waiting-room',
    file: MOCK_URLS.walmartQpRoom,
    initLog: '[WMT] init',
    journey: 'WM-4',
    invariants: ['no-sacred-lock', 'wm4-qp-no-producturl'],
  },
  {
    host: 'www.walmart.com',
    path: '/qp/waiting-room-monitored',
    file: MOCK_URLS.walmartQpRoom,
    initLog: '[WMT] init',
    journey: 'WM-4',
    invariants: ['sacred-lock-qp', 'wm5-sacred-survives-nav-failed'],
    sacredLockProductPath: '/ip/mock-qp-product/999',
  },
  {
    host: 'www.walmart.com',
    path: '/checkout',
    file: MOCK_URLS.walmartCheckoutQueue,
    initLog: '[WMT] init',
    journey: 'WM-6',
    invariants: ['sacred-lock-checkout'],
    sacredLockProductPath: '/ip/mock-wm6-checkout/789',
  },
  {
    host: 'www.walmart.com',
    path: '/ip/mock-px/555',
    file: MOCK_URLS.walmartProductPx,
    initLog: '[WMT] PX/loading page detected',
    journey: 'WM-6',
    invariants: ['no-sacred-lock', 'px-timeout-nav-failed'],
    sacredLockProductPath: '/ip/mock-px/555',
  },
  {
    host: 'www.walmart.com',
    path: '/ip/mock-px-captcha/556',
    file: MOCK_URLS.walmartProductPxCaptcha,
    initLog: '[WMT] PX/loading page detected',
    journey: 'WM-6',
    invariants: ['no-sacred-lock', 'px-timeout-nav-failed'],
    sacredLockProductPath: '/ip/mock-px-captcha/556',
  },
  {
    host: 'www.walmart.com',
    path: '/ip/mock-px-block/557',
    file: MOCK_URLS.walmartProductPxBlock,
    initLog: '[WMT] PX/loading page detected',
    journey: 'WM-6',
    invariants: ['no-sacred-lock', 'px-timeout-nav-failed'],
    sacredLockProductPath: '/ip/mock-px-block/557',
  },
  {
    host: 'www.walmart.com',
    path: '/ip/mock-px-override/558',
    file: MOCK_URLS.walmartProductPxOverride,
    initLog: '[WMT] PX/loading page detected',
    journey: 'WM-6',
    invariants: ['no-sacred-lock', 'px-timeout-nav-failed', 'px-timeout-ms-override'],
    sacredLockProductPath: '/ip/mock-px-override/558',
    pxTimeoutMs: 750,
  },
  {
    host: 'www.samsclub.com',
    path: '/p/mock-fcfs/789',
    file: MOCK_URLS.samsclubProductFcfs,
    initLog: '[TCH] init',
    journey: 'SC-3',
    invariants: ['no-sacred-lock', 'sc5-repeated-atc-success'],
    monitorProductPath: '/p/mock-fcfs/789',
    monitorQty: 5,
  },
  {
    host: 'www.samsclub.com',
    path: '/p/mock-fcfs-restock/790',
    file: MOCK_URLS.samsclubProductFcfsRestock,
    initLog: '[TCH] init',
    journey: 'SC-6',
    invariants: ['no-sacred-lock', 'nav-failed-releases-lock', 'sc6-repeated-nav-failed'],
  },
];

/** Hostnames mapped to 127.0.0.1 for Chrome host-resolver-rules. */
export const FIXTURE_HOSTS = [...new Set(FIXTURE_E2E_ROUTES.map((r) => r.host))];

/**
 * @param {{ routes?: typeof FIXTURE_E2E_ROUTES }} [options]
 * @returns {Promise<{ server: import('node:http').Server, port: number, close: () => Promise<void> }>}
 */
export function startFixtureServer(options = {}) {
  const routes = options.routes || FIXTURE_E2E_ROUTES;
  const routeKey = (host, pathname) => `${host.toLowerCase()}|${pathname}`;

  const lookup = new Map();
  for (const route of routes) {
    lookup.set(routeKey(route.host, route.path), route);
  }

  const server = createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0].toLowerCase();
    const pathname = (req.url || '/').split('?')[0];
    const route = lookup.get(routeKey(host, pathname));
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`fixture not found: ${host}${pathname}`);
      return;
    }
    const abs = join(__dirname, route.file);
    try {
      const body = readFileSync(abs, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(String(err));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        server,
        port,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

/** Chrome --host-resolver-rules value for FIXTURE_HOSTS → 127.0.0.1 */
export function hostResolverRules() {
  return FIXTURE_HOSTS.map((h) => `MAP ${h} 127.0.0.1`).join(', ');
}
