// Pure stock-flip detection + storage shaping (testable in Node via vm).

const STOCK_FLIP_DEBOUNCE_MS = 30 * 1000;
const STOCK_FLIP_MAX_TCINS = 20;

function stockEntryInStock(entry) {
  if (entry == null) return false;
  if (typeof entry === 'boolean') return entry === true;
  if (typeof entry === 'object' && 'stock' in entry) return entry.stock === true;
  return false;
}

function stockStatusLabel(inStock) {
  if (inStock === true) return 'IN_STOCK';
  if (inStock === false) return 'OOS';
  return 'UNKNOWN';
}

/** @returns {null | { from: string, to: string, at: string, qty: number }} */
function detectStockFlip(prevEntry, nextEntry, atIso) {
  const wasIn = stockEntryInStock(prevEntry);
  const nowIn = stockEntryInStock(nextEntry);
  if (wasIn || !nowIn) return null;

  const qty = typeof nextEntry === 'object' && nextEntry
    ? Number(nextEntry.qty) || 0
    : 0;

  return {
    from: stockStatusLabel(wasIn),
    to: 'IN_STOCK',
    at: atIso || new Date().toISOString(),
    qty,
  };
}

function shouldRecordStockFlip(existingFlip, newFlip, nowMs, debounceMs) {
  if (!newFlip) return false;
  if (!existingFlip) return true;
  const gap = nowMs - Date.parse(existingFlip.at || '');
  if (!Number.isFinite(gap)) return true;
  return gap >= (debounceMs ?? STOCK_FLIP_DEBOUNCE_MS);
}

function applyStockFlipRecord(flips, tcin, flip) {
  const next = { ...(flips || {}) };
  next[String(tcin)] = flip;
  const keys = Object.keys(next);
  if (keys.length <= STOCK_FLIP_MAX_TCINS) return next;

  keys.sort((a, b) => Date.parse(next[b]?.at || '') - Date.parse(next[a]?.at || ''));
  const trimmed = {};
  for (let i = 0; i < STOCK_FLIP_MAX_TCINS; i++) trimmed[keys[i]] = next[keys[i]];
  return trimmed;
}
