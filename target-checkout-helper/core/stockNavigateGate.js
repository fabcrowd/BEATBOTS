// N-of-M stock confirmation before monitor navigation (Phase 2 flicker hardening).

const STOCK_CONFIRM_DEFAULT = { required: 2, window: 3, maxBuffer: 5 };

function pushStockPollSample(buffer, entry, maxLen) {
  const cap = Math.max(2, Number(maxLen) || STOCK_CONFIRM_DEFAULT.maxBuffer);
  const b = Array.isArray(buffer) ? buffer.slice() : [];
  let stock = false;
  let qty = 0;
  if (entry != null) {
    if (typeof entry === 'boolean') stock = entry === true;
    else if (typeof entry === 'object') {
      stock = entry.stock === true;
      qty = Number(entry.qty) || 0;
    }
  }
  b.push({ stock, qty, at: Date.now() });
  if (b.length > cap) b.splice(0, b.length - cap);
  return b;
}

function stockConfirmedForNavigate(buffer, opts) {
  const required = Math.max(1, Number(opts?.required) || STOCK_CONFIRM_DEFAULT.required);
  const windowSize = Math.max(required, Number(opts?.window) || STOCK_CONFIRM_DEFAULT.window);
  const slice = (Array.isArray(buffer) ? buffer : []).slice(-windowSize);
  if (slice.length < required) return false;
  const hits = slice.filter((s) => s && s.stock === true).length;
  return hits >= required;
}

/** IN_STOCK with ATP qty 0 across the full window — status/quantity mismatch flicker */
function isAtpStatusFlicker(buffer, opts) {
  const windowSize = Math.max(2, Number(opts?.window) || STOCK_CONFIRM_DEFAULT.window);
  const slice = (Array.isArray(buffer) ? buffer : []).slice(-windowSize);
  if (slice.length < windowSize) return false;
  return slice.every((s) => s && s.stock === true && (Number(s.qty) || 0) <= 0);
}

function tcinsNeedingSingleFallback(tcins, batchMap) {
  const list = Array.isArray(tcins) ? tcins : [];
  const map = batchMap && typeof batchMap === 'object' ? batchMap : {};
  return list.filter((t) => map[t] === undefined);
}
