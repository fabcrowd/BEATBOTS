// Shared RedSky product_fulfillment_v1 URL builder + fulfillment parser (background + content tests).

const REDSKY_SELLABLE_STATUSES = new Set([
  'IN_STOCK', 'LIMITED_STOCK', 'PRE_ORDER_SELLABLE',
  'BACKORDER_AVAILABLE', 'BACKORDERED', 'AVAILABLE',
]);
const REDSKY_BLOCKED_RE = /(OUT_OF_STOCK|UNSELLABLE|UNAVAILABLE|NOT_AVAILABLE|NO_INVENTORY|INVENTORY_UNAVAILABLE)/i;

function buildRedskyFulfillmentUrl(tcin, opts) {
  const t = String(tcin || '').trim();
  const apiKey = String(opts?.apiKey || '').trim();
  if (!t || !apiKey) return null;

  const base = String(opts?.redskyBase || 'https://redsky.target.com').replace(/\/$/, '');
  const path = 'redsky_aggregations/v1/web/product_fulfillment_v1';
  const params = new URLSearchParams();
  params.set('key', apiKey);
  params.set('tcin', t);

  const zip = String(opts?.zip || '').trim();
  if (/^\d{5}$/.test(zip)) params.set('zip', zip);

  const storeId = String(opts?.storeId || '').trim();
  if (storeId && /^\d+$/.test(storeId)) {
    params.set('store_id', storeId);
    params.set('pricing_store_id', storeId);
  }

  return `${base}/${path}?${params.toString()}`;
}

/** @returns {{ stock: boolean | null, qty: number, price: number | null }} */
function parseFulfillmentBlock(fulfillment) {
  if (!fulfillment || typeof fulfillment !== 'object') return { stock: null, qty: 0, price: null };
  const shipping = fulfillment.shipping_options || {};
  const status = String(shipping.availability_status || '').toUpperCase();
  const qty = Number(shipping.available_to_promise_quantity) || 0;
  const soldOut = fulfillment.sold_out === true;
  const oosAll = fulfillment.is_out_of_stock_in_all_store_locations === true;
  const sellable = qty > 0 || REDSKY_SELLABLE_STATUSES.has(status);
  const blocked = soldOut || REDSKY_BLOCKED_RE.test(status) || (oosAll && qty <= 0 && !sellable);
  if (sellable && !soldOut) return { stock: true, qty, price: null };
  if (blocked) return { stock: false, qty, price: null };
  return { stock: null, qty, price: null };
}
