/**
 * TCH Page Diagnostic — paste into Target.com console (login page or main page)
 * Prints all results to console AND shows a floating panel.
 */
(async function TCH_DIAG() {
  const isLoginPage = /login|signin|gsp\.target\.com/i.test(location.href);
  const TAG = '[TCH diag]';

  // ── Floating panel ──────────────────────────────────────────────────────────
  const existing = document.getElementById('__tch_diag__');
  if (existing) existing.remove();
  const panel = document.createElement('div');
  panel.id = '__tch_diag__';
  panel.style.cssText = `position:fixed;top:10px;right:10px;z-index:2147483647;width:380px;max-height:80vh;
    overflow-y:auto;background:#111;color:#e0e0e0;font:12px/1.5 monospace;
    border:1px solid #444;border-radius:6px;padding:12px;box-shadow:0 4px 20px rgba(0,0,0,.7);`;
  document.body.appendChild(panel);

  let html = '';
  const results = [];
  function log(label, value, status) {
    const color = status==='ok'?'#4caf50':status==='warn'?'#ff9800':status==='err'?'#f44336':'#9e9e9e';
    html += `<div><span style="color:${color};font-weight:bold">[${(status||'info').toUpperCase()}]</span> <b>${label}:</b> ${value}</div>`;
    panel.innerHTML = `<div style="color:#90caf9;font-weight:bold;margin-bottom:8px">▶ TCH Diagnostics ${new Date().toLocaleTimeString()}</div>` + html;
    // Also print to console so output is visible when pasted
    const fn = status==='err'?console.error:status==='warn'?console.warn:console.log;
    fn(`${TAG} [${(status||'info').toUpperCase()}] ${label}: ${value}`);
    results.push({label, value, status});
  }
  function section(title) {
    html += `<div style="color:#7986cb;margin:8px 0 2px;border-top:1px solid #333;padding-top:6px;font-weight:bold">${title}</div>`;
    panel.innerHTML = `<div style="color:#90caf9;font-weight:bold;margin-bottom:8px">▶ TCH Diagnostics ${new Date().toLocaleTimeString()}</div>` + html;
    console.group(`${TAG} ── ${title}`);
  }

  console.log(`${TAG} Starting. Page: ${location.href.substring(0,80)}`);
  console.log(`${TAG} Login page: ${isLoginPage}`);

  // ── 1. Page origin ──────────────────────────────────────────────────────────
  section('Page Context');
  log('Origin', location.origin, 'info');
  log('Path', location.pathname, 'info');
  log('Is login page', isLoginPage ? 'YES' : 'no', isLoginPage ? 'warn' : 'ok');
  console.groupEnd();

  // ── 2. API key in DOM ───────────────────────────────────────────────────────
  section('API Key');
  const tchKey = document.documentElement.dataset.tchKey;
  const tchRedsky = document.documentElement.dataset.tchRedsky;
  log('DOM tchKey', tchKey ? '✓ ' + tchKey.substring(0,10)+'…' : '✗ MISSING', tchKey ? 'ok' : 'err');
  log('DOM tchRedsky', tchRedsky ? '✓ ' + tchRedsky.substring(0,30) : '✗ MISSING', tchRedsky ? 'ok' : 'err');
  try {
    const cfgKey = window.__CONFIG__?.services?.auth?.apiKey || window.__CONFIG__?.services?.apiPlatform?.apiKey;
    log('window.__CONFIG__ key', cfgKey ? '✓ ' + cfgKey.substring(0,10)+'…' : '✗ not found', cfgKey ? 'ok' : 'warn');
  } catch { log('window.__CONFIG__', 'not accessible (SES lockdown)', 'warn'); }
  console.groupEnd();

  // ── 3. All cookies (names only) ─────────────────────────────────────────────
  section('Cookies');
  const cookies = document.cookie.split(';').map(c => c.trim()).filter(Boolean);
  log('Total visible cookies', cookies.length, cookies.length > 0 ? 'ok' : 'err');
  const allNames = cookies.map(c => c.split('=')[0]);
  console.log(`${TAG} All cookie names:`, allNames);
  log('All names', allNames.join(', ') || '(none)', cookies.length ? 'info' : 'err');

  // Auth-critical cookies
  const authKeys = ['accessToken','fiatToken','TealeafAkaSid','visitorId','sapphire','UserLocation','GuestLocation'];
  authKeys.forEach(k => {
    const found = cookies.find(c => c.startsWith(k+'='));
    log(k, found ? '✓ present' : '✗ MISSING', found ? 'ok' : 'warn');
  });

  // PX cookies
  const pxCookies = cookies.filter(c => /^_?px|^PX/i.test(c.split('=')[0]));
  log('PX cookies', pxCookies.length ? pxCookies.map(c=>c.split('=')[0]).join(', ') : 'none', pxCookies.length ? 'warn' : 'info');
  console.groupEnd();

  // ── 4. PerimeterX DOM state ─────────────────────────────────────────────────
  section('PerimeterX / Bot Detection');
  const pxFrame = document.querySelector('iframe[src*="px-cloud"],iframe[src*="human.security"],iframe[src*="px-captcha"],iframe[src*="2ssx"]');
  log('PX challenge iframe in DOM', pxFrame ? '⚠ PRESENT — '+pxFrame.src.substring(0,60) : 'not found', pxFrame ? 'err' : 'ok');
  try { log('window._pxAppId', window._pxAppId || 'not set (SES or not loaded)', 'info'); } catch { /* */ }
  // 2ssx is the PX sensor - check if it's still in the scripts
  const pxScript = [...document.querySelectorAll('script')].find(s => s.src && s.src.includes('2ssx'));
  log('2ssx sensor script tag', pxScript ? '⚠ present: '+pxScript.src.substring(0,60) : 'not in DOM', pxScript ? 'warn' : 'ok');
  console.groupEnd();

  // ── 5. Login form state ─────────────────────────────────────────────────────
  section('Login Form');
  const emailInput = document.querySelector('input[id="username"],input[autocomplete="username"],input[type="email"]');
  const passInput  = document.querySelector('input[id="password"],input[type="password"]');
  const submitBtn  = document.querySelector('[data-test="account-signin-button"],button[type="submit"]');
  log('Email input', emailInput ? '✓ (id='+emailInput.id+')' : '✗ not found', emailInput ? 'ok' : 'warn');
  log('Password input', passInput ? '✓ (id='+passInput.id+')' : '✗ not found', passInput ? 'ok' : 'warn');
  log('Submit button', submitBtn ? '✓ ('+submitBtn.textContent.trim().substring(0,20)+')' : '✗ not found', submitBtn ? 'ok' : 'warn');

  // Error / block messages
  const bodyText = document.body.innerText.toLowerCase();
  const blockTerms = ['we have detected','too many attempts','temporarily','robot','automated access','verify you are','account locked','suspended'];
  const foundBlocks = blockTerms.filter(t => bodyText.includes(t));
  log('Block/error text', foundBlocks.length ? '⚠ ' + foundBlocks.join(' | ') : 'none', foundBlocks.length ? 'err' : 'ok');

  // Any error elements
  const errEl = document.querySelector('[data-test="errorMessage"],[data-test="error"],[class*="errorMessage"],[id*="error-message"]');
  log('Error DOM element', errEl ? '⚠ "'+errEl.textContent.trim().substring(0,80)+'"' : 'none', errEl ? 'err' : 'ok');

  const allIframes = [...document.querySelectorAll('iframe')].map(f => f.src || '(no src)').filter(Boolean);
  log('All iframes', allIframes.length ? allIframes.map(s=>s.substring(0,50)).join(' | ') : 'none', 'info');
  console.groupEnd();

  // ── 6. Auth API test (skip on login page — CORS blocked there) ──────────────
  section('Auth API');
  if (isLoginPage) {
    log('Skipped', 'CORS blocks api.target.com calls from the login page — re-run this script from www.target.com main page to test auth', 'warn');
    console.log(`${TAG} To test auth status: navigate to https://www.target.com then re-paste this script`);
  } else {
    log('Testing…', 'fetching guest_accounts', 'info');
    try {
      const [addrRes, payRes] = await Promise.all([
        fetch('https://api.target.com/guest_accounts/v3/addresses', {credentials:'include'}),
        fetch('https://api.target.com/guest_accounts/v3/payment_cards', {credentials:'include'}),
      ]);
      log('addresses', addrRes.status+' '+addrRes.statusText, addrRes.status===200?'ok':addrRes.status===401?'err':'warn');
      log('payment_cards', payRes.status+' '+payRes.statusText, payRes.status===200?'ok':payRes.status===401?'err':'warn');
      log('Verdict', addrRes.status===401?'NOT LOGGED IN':addrRes.status===200?'LOGGED IN':'Partial/flagged ('+addrRes.status+')',
        addrRes.status===401?'err':addrRes.status===200?'ok':'warn');
      const body = await addrRes.text();
      if (body.includes('"message"')||body.includes('"error"')) log('API body snippet', body.substring(0,200), 'warn');
    } catch (e) {
      log('Auth API fetch failed', e.message, 'err');
    }
  }
  console.groupEnd();

  // ── 7. Navigation / DOM mutation watcher ───────────────────────────────────
  section('Login Submit Watcher');
  log('Status', 'ACTIVE — submit your login now, results update below', 'info');
  console.log(`${TAG} Watcher active (URL + DOM). Submit login now.`);
  const origUrl = location.href;
  let lastErrMsg = '';
  let watchDone = false;

  function stopWatch(obs, timer) { if (!watchDone) { watchDone = true; obs.disconnect(); clearTimeout(timer); } }

  const domObs = new MutationObserver(() => {
    if (watchDone) return;
    // URL changed (SPA navigation)
    if (location.href !== origUrl) {
      const dest = location.href;
      const isBad = /error|login|signin|block|captcha/i.test(dest);
      log('Navigated to', dest.substring(0,100), isBad ? 'err' : 'ok');
      console.log(`${TAG} Navigation: ${dest}`);
      stopWatch(domObs, watchTimer); return;
    }
    // Password field appeared (step 2 of two-step flow)
    const passField = document.querySelector('input[id="password"],input[type="password"]');
    if (passField) {
      log('Password field appeared', '✓ two-step SPA transition — step 2 loaded', 'ok');
      console.log(`${TAG} Password field appeared — step 2 loaded`);
      stopWatch(domObs, watchTimer); return;
    }
    // PX challenge iframe appeared
    const dynPx = document.querySelector('iframe[src*="px-cloud"],iframe[src*="human.security"],iframe[src*="2ssx"],iframe[src*="px-captcha"]');
    if (dynPx) {
      log('⚠ PX iframe appeared', dynPx.src.substring(0,80), 'err');
      console.error(`${TAG} PX CAPTCHA iframe appeared: ${dynPx.src}`);
      stopWatch(domObs, watchTimer); return;
    }
    // Error message appeared
    const errEl2 = document.querySelector('[data-test="errorMessage"],[data-test="error"]');
    if (errEl2 && errEl2.textContent.trim() && errEl2.textContent.trim() !== lastErrMsg) {
      lastErrMsg = errEl2.textContent.trim();
      log('Error after submit', lastErrMsg.substring(0,120), 'err');
      console.error(`${TAG} Error: ${lastErrMsg}`);
    }
  });
  domObs.observe(document.body, { childList: true, subtree: true, characterData: true });

  const watchTimer = setTimeout(() => {
    if (!watchDone) {
      watchDone = true;
      domObs.disconnect();
      log('Watcher timeout', 'No change in 30s — did you click Continue/Submit?', 'warn');
      console.warn(`${TAG} No DOM change after 30s`);
    }
  }, 30000);
  console.groupEnd();

  // ── Final summary to console ────────────────────────────────────────────────
  const errs  = results.filter(r => r.status === 'err').map(r => r.label);
  const warns = results.filter(r => r.status === 'warn').map(r => r.label);
  console.log(`${TAG} ── SUMMARY ──`);
  console.log(`${TAG} Errors  (${errs.length}):`, errs.join(', ') || 'none');
  console.log(`${TAG} Warnings(${warns.length}):`, warns.join(', ') || 'none');
  console.log(`${TAG} Panel is visible top-right. Submit login to watch.`);
})();
