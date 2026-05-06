/**
 * TCH Background Diagnostic — paste into the Service Worker console
 * chrome://extensions → TCH → "Service Worker" → Console tab
 */
(async function TCH_BG_DIAG() {
  const sep = '─'.repeat(50);
  console.log('\n' + sep);
  console.log('  TCH Background Diagnostics — ' + new Date().toLocaleTimeString());
  console.log(sep);

  // ── 1. chrome.storage.local ─────────────────────────────────────────────────
  const local = await new Promise(r => chrome.storage.local.get(null, r));
  console.group('📦 Storage (local)');
  console.log('API Key:     ', local.bgApiKey ? '✓ ' + local.bgApiKey.substring(0,12) + '…' : '✗ MISSING');
  console.log('Redsky Base: ', local.bgRedskyBase || '✗ MISSING');
  console.log('Auto Sign-In:', local.autoSignIn);
  console.log('Target Email:', local.targetEmail || '✗ NOT SET');
  console.log('Monitor Active:', local.monitor?.active);
  if (local.monitor?.products?.length) {
    console.group('Monitor Products');
    (local.monitor.products || []).forEach(p => console.log(' •', p.name || p.url, 'qty:', p.qty));
    console.groupEnd();
  }
  console.log('Max Price Gate:', local.monitor?.targetMaxPrice ?? 'not set');
  console.log('High Stock Only:', local.monitor?.highStockOnly);
  console.log('Drop Expected At:', local.monitor?.dropExpectedAt || 'not set');
  console.log('Harvest Config:', JSON.stringify(local.harvestConfig || {}));
  console.groupEnd();

  // ── 2. chrome.storage.session (harvest pool) ────────────────────────────────
  const session = await new Promise(r => chrome.storage.session.get(null, r));
  const entries = session.tchHarvestEntries || [];
  console.group('🍪 Harvest Pool (' + entries.length + ' snapshots)');
  if (entries.length === 0) {
    console.warn('Pool is EMPTY — no saved cookie snapshots');
  } else {
    entries.forEach((e, i) => {
      const ageMin = Math.round((Date.now() - (e.capturedAt || 0)) / 60000);
      const expStr = e.expiresAt ? new Date(e.expiresAt).toLocaleTimeString() : 'no expiry';
      const expired = e.expiresAt && Date.now() > e.expiresAt;
      console.log(`[${i}] kind=${e.kind || '?'} | cookies=${e.cookies?.length || 0} | age=${ageMin}min | expires=${expStr}${expired ? ' ⚠ EXPIRED' : ''}`);
    });
  }
  console.groupEnd();

  // ── 3. Open Target tabs check ───────────────────────────────────────────────
  console.group('🗂 Target Tabs');
  const tabs = await new Promise(r => chrome.tabs.query({url: '*://*.target.com/*'}, r));
  if (tabs.length === 0) {
    console.warn('No Target tabs found — content script cannot extract API key');
  } else {
    tabs.forEach(t => console.log(' •', t.id, t.url?.substring(0, 80), t.status));
  }
  console.groupEnd();

  // ── 4. Request API key re-extraction from any open Target tab ───────────────
  console.group('🔑 API Key Re-request');
  if (!local.bgApiKey && tabs.length > 0) {
    console.log('API key missing — sending REQUEST_API_KEY to all Target tabs...');
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_API_KEY' });
        console.log('  → sent to tab', tab.id);
      } catch (e) {
        console.warn('  → failed for tab', tab.id, e.message);
      }
    }
  } else if (local.bgApiKey) {
    console.log('API key already cached — no re-request needed');
  } else {
    console.warn('No Target tabs to request key from');
  }
  console.groupEnd();

  // ── 5. Summary ──────────────────────────────────────────────────────────────
  console.log('\n' + sep);
  const issues = [];
  if (!local.bgApiKey) issues.push('❌ API key missing');
  if (!local.bgRedskyBase) issues.push('❌ Redsky base URL missing');
  if (!local.targetEmail) issues.push('❌ Target email not configured');
  if (entries.length === 0) issues.push('⚠ Harvest pool empty');
  if (!local.monitor?.active) issues.push('⚠ Monitor not active');

  if (issues.length === 0) {
    console.log('✅ All systems nominal');
  } else {
    console.log('Issues found:');
    issues.forEach(i => console.log(' ', i));
  }
  console.log(sep + '\n');
})();
