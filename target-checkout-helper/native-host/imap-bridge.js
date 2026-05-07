#!/usr/bin/env node
'use strict';

/**
 * Chrome native messaging host: reads Walmart (or generic) 6-digit codes from IMAP INBOX.
 * Protocol: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
 *
 * Install: npm install (in this folder), run install-native-host.bat/.sh, add extension ID to manifest JSON.
 */

let ImapFlow;
try {
  ({ ImapFlow } = require('imapflow'));
} catch (e) {
  console.error('[imap-bridge] Run npm install in native-host/ (imapflow required)');
  process.exit(1);
}

function sendMessage(msg) {
  const buf = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

const CODE_RE = /\b(\d{6})\b/g;

function extractSixDigitCodes(text) {
  const out = [];
  if (!text) return out;
  let m;
  while ((m = CODE_RE.exec(text)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function looksLikeWalmartVerification(subject, body) {
  const s = `${subject || ''} ${body || ''}`.toLowerCase();
  return (
    s.includes('walmart') ||
    s.includes('verification') ||
    s.includes('security code') ||
    s.includes('sign-in')
  );
}

function subjectText(env) {
  if (!env || !env.subject) return '';
  const s = env.subject;
  if (typeof s === 'string') return s;
  if (Array.isArray(s)) return s.map((p) => (p && p.value) || '').join('');
  return String(s);
}

async function readImapCode(opts) {
  const host = String(opts.host || '').trim();
  const user = String(opts.user || '').trim();
  const password = String(opts.password || '');
  const port = Number(opts.port) || 993;
  const timeoutMs = Math.min(Number(opts.timeoutMs) || 90000, 180000);

  if (!host || !user || !password) {
    return { ok: false, error: 'host, user, and password are required' };
  }

  const client = new ImapFlow({
    host,
    port,
    secure: port === 993 || port === 465,
    auth: { user, pass: password },
    logger: false,
    socketTimeout: timeoutMs,
    greetingTimeout: Math.min(15000, timeoutMs),
  });

  const deadline = Date.now() + timeoutMs;
  let lastErr = null;

  try {
    await client.connect();

    while (Date.now() < deadline) {
      let lock;
      try {
        lock = await client.getMailboxLock('INBOX');
        const st = await client.status('INBOX', { messages: true });
        const total = st.messages || 0;
        const fromSeq = Math.max(1, total - 35);
        const seq = total > 0 ? `${fromSeq}:${total}` : '1:1';

        /** @type {any[]} */
        const batch = [];
        if (total > 0) {
          for await (const msg of client.fetch({ seq }, { envelope: true, source: true, uid: true })) {
            batch.push(msg);
          }
        }

        for (let i = batch.length - 1; i >= 0; i--) {
          const msg = batch[i];
          const subj = subjectText(msg.envelope);
          const raw = msg.source ? msg.source.toString('utf8') : '';
          const body = raw.replace(/^[\s\S]*?\r?\n\r?\n/, '') || raw;

          if (!looksLikeWalmartVerification(subj, body)) continue;

          const codes = extractSixDigitCodes(body).concat(extractSixDigitCodes(subj));
          if (codes.length) {
            return { ok: true, code: codes[codes.length - 1] };
          }
        }
      } catch (e) {
        lastErr = e;
      } finally {
        if (lock) lock.release();
      }

      await new Promise((r) => setTimeout(r, 2500));
    }

    return {
      ok: false,
      error: lastErr ? String(lastErr.message || lastErr) : 'No 6-digit code found in recent mail',
    };
  } finally {
    try {
      await client.logout();
    } catch (_) {}
  }
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'invalid message' };
  if (msg.cmd === 'ping') return { ok: true, pong: true };
  if (msg.cmd === 'readCode') return await readImapCode(msg);
  return { ok: false, error: 'unknown cmd: ' + String(msg.cmd) };
}

let inputBuf = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  inputBuf = Buffer.concat([inputBuf, chunk]);
  while (inputBuf.length >= 4) {
    const len = inputBuf.readUInt32LE(0);
    if (len > 64 * 1024 * 1024) {
      sendMessage({ ok: false, error: 'message too large' });
      process.exit(1);
    }
    if (inputBuf.length < 4 + len) break;
    const jsonStr = inputBuf.slice(4, 4 + len).toString('utf8');
    inputBuf = inputBuf.slice(4 + len);
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      sendMessage({ ok: false, error: 'invalid JSON' });
      continue;
    }
    handleMessage(parsed)
      .then(sendMessage)
      .catch((err) => sendMessage({ ok: false, error: String(err && err.message ? err.message : err) }));
  }
});

process.stdin.on('end', () => process.exit(0));
