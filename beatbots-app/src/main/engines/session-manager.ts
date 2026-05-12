// Session Manager — handles Target account authentication, token storage, and OTP
//
// Target auth flow:
//   1. POST /guests/v3/tokens  →  { access_token, token_type, expires_in }
//   2. If MFA required: Target emails a 6-digit OTP → read from IMAP → POST /guests/v3/tokens again with otp field
//   3. Token is a JWT, store in Account record, re-use for all API calls
//   4. On 401 from any cart/checkout endpoint: re-login

import { getById, getWhere, upsert } from '../storage/db'
import { Account, ImapProfile } from '../../shared/types'
import { EventEmitter } from 'events'
import { adjustedNow } from '../utils/drop-timing'

// ─── Constants ────────────────────────────────────────────────────────────────

const TARGET_API_BASE = 'https://api.target.com'

// API key extracted from Target pages via main_world.js. For direct API calls
// we need to supply one. This is the publicly-visible web API key from Target's JS bundle.
// It rotates occasionally; the Shape harvester / monitor engine capture the live one.
const DEFAULT_API_KEY = 'ff457966e64d5e877fdbad070f276d18ecec4a01'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionContext {
  accountId: number
  email: string
  accessToken: string
  tokenExpiresAt: number      // epoch ms
  visitorId: string
  apiKey: string
  proxy: string | null
}

interface LoginResult {
  ok: true
  token: string
  expiresIn: number
  requiresOtp?: boolean
  otpLoginId?: string        // Target returns this when MFA is triggered
}

interface LoginError {
  ok: false
  error: string
  code?: number
}

// ─── Visitor ID ───────────────────────────────────────────────────────────────

import crypto from 'crypto'

function generateVisitorId(): string {
  // Target uses a UUID-like visitorId stored in cookies
  return crypto.randomUUID().replace(/-/g, '').toUpperCase()
}

// ─── Token cache (in-memory) ──────────────────────────────────────────────────

const tokenCache = new Map<number, SessionContext>()

export function getCachedSession(accountId: number): SessionContext | null {
  const ctx = tokenCache.get(accountId)
  if (!ctx) return null
  // Treat token as expired 60s early to avoid edge cases
  if (ctx.tokenExpiresAt < adjustedNow() + 60_000) {
    tokenCache.delete(accountId)
    return null
  }
  return ctx
}

export function setCachedSession(ctx: SessionContext): void {
  tokenCache.set(ctx.accountId, ctx)
  // Persist token back to account record
  const account = getById<Account>('accounts', ctx.accountId)
  if (account) {
    upsert('accounts', {
      ...account,
      accessToken: ctx.accessToken,
      status: 'logged_in',
      lastLoginAt: new Date().toISOString(),
    })
  }
}

export function invalidateSession(accountId: number): void {
  tokenCache.delete(accountId)
}

// Guest session uses accountId = 0 as a sentinel
export const GUEST_ACCOUNT_ID = 0

export async function createGuestSession(apiKey = DEFAULT_API_KEY): Promise<SessionContext> {
  const cached = getCachedSession(GUEST_ACCOUNT_ID)
  if (cached) return cached

  const visitorId = generateVisitorId()

  const resp = await fetch(`${TARGET_API_BASE}/guests/v1/tokens`, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'x-application-name': 'web',
      'x-t-request-id': crypto.randomUUID(),
      'x-visitor-id': visitorId,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'origin': 'https://www.target.com',
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(10_000),
  })

  const data = await resp.json().catch(() => ({})) as any
  const token = data?.access_token || data?.token || ''
  const expiresIn = data?.expires_in ?? 3600

  if (!token) {
    throw new Error(`Guest token request failed: HTTP ${resp.status}`)
  }

  const ctx: SessionContext = {
    accountId: GUEST_ACCOUNT_ID,
    email: 'guest',
    accessToken: token,
    tokenExpiresAt: Date.now() + expiresIn * 1000,
    visitorId,
    apiKey,
    proxy: null,
  }
  setCachedSession(ctx)
  return ctx
}

// ─── Session Manager ──────────────────────────────────────────────────────────

export class SessionManager extends EventEmitter {
  private apiKey = DEFAULT_API_KEY
  private proxy: string | null = null

  setApiKey(key: string): void {
    this.apiKey = key
  }

  setProxy(proxy: string | null): void {
    this.proxy = proxy
  }

  /** Get or create a valid session for an account */
  async getSession(accountId: number): Promise<SessionContext> {
    // 1. Check in-memory cache
    const cached = getCachedSession(accountId)
    if (cached) return cached

    // 2. Load account from DB
    const account = getById<Account>('accounts', accountId)
    if (!account) throw new Error(`Account ${accountId} not found`)

    // 3. Check if we have a stored access token that might still be valid
    if (account.accessToken) {
      const ctx: SessionContext = {
        accountId,
        email: account.email,
        accessToken: account.accessToken,
        tokenExpiresAt: adjustedNow() + 30 * 60 * 1000,  // assume 30m if we don't know
        visitorId: generateVisitorId(),
        apiKey: this.apiKey,
        proxy: this.proxy,
      }
      tokenCache.set(accountId, ctx)
      return ctx
    }

    // 4. Need to log in
    const result = await this.login(account)
    if (!result.ok) throw new Error(`Login failed for ${account.email}: ${result.error}`)

    const ctx: SessionContext = {
      accountId,
      email: account.email,
      accessToken: result.token,
      tokenExpiresAt: adjustedNow() + result.expiresIn * 1000,
      visitorId: generateVisitorId(),
      apiKey: this.apiKey,
      proxy: this.proxy,
    }
    setCachedSession(ctx)
    return ctx
  }

  /** Attempt login, handling OTP if needed */
  async login(account: Account): Promise<LoginResult | LoginError> {
    this.emit('status', { accountId: account.id, status: 'logging_in', text: 'Logging in...' })

    // Update account status in DB
    upsert('accounts', { ...account, status: 'logging_in' })

    try {
      // Step 1: initial login attempt
      const resp = await this.doLoginRequest(account.email, account.password)

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({})) as any
        const msg = body?.message || body?.error || `HTTP ${resp.status}`

        // 449 = MFA required by Target
        if (resp.status === 449) {
          const otpLoginId = body?.otp_id || body?.login_id || ''
          this.emit('status', { accountId: account.id, status: 'logging_in', text: 'OTP required...' })

          // Try to read OTP from IMAP
          const otp = await this.readOtpFromImap(account)
          if (!otp) {
            upsert('accounts', { ...account, status: 'error' })
            return { ok: false, error: 'OTP required but IMAP not configured or timed out' }
          }

          // Step 2: re-login with OTP
          const otpResp = await this.doLoginRequest(account.email, account.password, otp)
          if (!otpResp.ok) {
            upsert('accounts', { ...account, status: 'error' })
            return { ok: false, error: `OTP login failed: HTTP ${otpResp.status}` }
          }

          const otpData = await otpResp.json() as any
          const token = otpData?.access_token || otpData?.web?.access_token || ''
          const expiresIn = otpData?.expires_in || 3600
          if (!token) {
            upsert('accounts', { ...account, status: 'error' })
            return { ok: false, error: 'OTP login succeeded but no token in response' }
          }

          this.emit('status', { accountId: account.id, status: 'logged_in', text: 'Logged in (OTP)' })
          return { ok: true, token, expiresIn }
        }

        upsert('accounts', { ...account, status: 'error' })
        return { ok: false, error: msg, code: resp.status }
      }

      const data = await resp.json() as any
      const token = data?.access_token || data?.web?.access_token || ''
      const expiresIn = data?.expires_in || 3600

      if (!token) {
        upsert('accounts', { ...account, status: 'error' })
        return { ok: false, error: 'Login succeeded but no token in response' }
      }

      this.emit('status', { accountId: account.id, status: 'logged_in', text: 'Logged in' })
      return { ok: true, token, expiresIn }

    } catch (e: any) {
      upsert('accounts', { ...account, status: 'error' })
      return { ok: false, error: e.message }
    }
  }

  private async doLoginRequest(email: string, password: string, otp?: string): Promise<Response> {
    const body: Record<string, any> = {
      username: email,
      password,
      keep_me_signed_in: true,
    }
    if (otp) body.otp = otp

    return fetch(`${TARGET_API_BASE}/guests/v3/tokens`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    })
  }

  private buildHeaders(): Record<string, string> {
    return {
      'accept': 'application/json',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'x-application-name': 'web',
      'x-t-request-id': crypto.randomUUID(),
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'origin': 'https://www.target.com',
      'referer': 'https://www.target.com/',
    }
  }

  /** Try to read a Target OTP code from the account's configured IMAP profile */
  async readOtpFromImap(account: Account, timeoutMs = 60_000): Promise<string | null> {
    if (!account.imapProfileId) return null

    const profile = getById<ImapProfile>('imap_profiles', account.imapProfileId)
    if (!profile) return null

    const deadline = Date.now() + timeoutMs
    const POLL_INTERVAL = 3000

    while (Date.now() < deadline) {
      try {
        const otp = await pollImapForOtp(profile, account.email)
        if (otp) return otp
      } catch (e) {
        console.warn('[SessionManager] IMAP poll error:', e)
      }
      await sleep(POLL_INTERVAL)
    }

    return null
  }
}

// ─── IMAP OTP Reader ──────────────────────────────────────────────────────────
// Polls inbox for Target's 6-digit verification code.
// Uses Node.js TLS socket for IMAP4rev1 — no imap npm package needed.

import tls from 'tls'

async function pollImapForOtp(profile: ImapProfile, targetEmail: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const socket = tls.connect({
        host: profile.host,
        port: profile.port,
        rejectUnauthorized: true,
      })

      let buffer = ''
      let cmdSeq = 1
      let done = false

      const send = (cmd: string) => {
        socket.write(`A${cmdSeq++} ${cmd}\r\n`)
      }

      const finish = (result: string | null) => {
        if (done) return
        done = true
        socket.destroy()
        resolve(result)
      }

      socket.setTimeout(15_000)
      socket.on('timeout', () => finish(null))
      socket.on('error', () => finish(null))

      socket.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split('\r\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          // Server greeting → login
          if (line.startsWith('* OK') && cmdSeq === 1) {
            send(`LOGIN "${imapEscape(profile.user)}" "${imapEscape(profile.password)}"`)
            continue
          }

          // Login OK → select INBOX
          if (line.match(/^A1 OK/i)) {
            send('SELECT INBOX')
            continue
          }

          // Select OK → search for recent Target emails
          if (line.match(/^A2 OK/i)) {
            // Search for unseen emails from Target in last 5 mins
            send('SEARCH UNSEEN FROM "target.com" SUBJECT "verification"')
            continue
          }

          // Search result
          if (line.startsWith('* SEARCH')) {
            const nums = line.slice(8).trim().split(' ').filter(Boolean)
            if (nums.length === 0) { finish(null); return }
            // Fetch the most recent one
            const latest = nums[nums.length - 1]
            send(`FETCH ${latest} (BODY.PEEK[TEXT])`)
            continue
          }

          // Fetch result — extract OTP from body
          if (line.match(/\* \d+ FETCH/)) {
            const otp = extractOtpFromEmailText(buffer + line)
            if (otp) { finish(otp); return }
            continue
          }

          // Logout on completion
          if (line.match(/^A4 OK/i) || line.match(/^A3 OK/i)) {
            finish(null)
          }
        }
      })

      socket.on('connect', () => {
        // Wait for greeting
      })
    } catch {
      resolve(null)
    }
  })
}

function extractOtpFromEmailText(text: string): string | null {
  // Strip HTML tags so we can match OTP inside email bodies
  const clean = text.replace(/<[^>]*>/g, ' ')
  const patterns = [
    /verification code[\s\w]*?[:\s]\s*(\d{6})/i,
    /security code[\s\w]*?[:\s]\s*(\d{6})/i,
    /enter this code[\s\w]*?[:\s]\s*(\d{6})/i,
    /your code[\s\w]*?[:\s]\s*(\d{6})/i,
    /(?:^|\s)(\d{6})(?:\s|$)/m,
  ]
  for (const re of patterns) {
    const m = clean.match(re)
    if (m) return m[1]
  }
  return null
}

function imapEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// Singleton
export const sessionManager = new SessionManager()
