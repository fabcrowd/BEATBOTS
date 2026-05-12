// ─── Profiles ────────────────────────────────────────────────────────────────

export interface Profile {
  id: number
  name: string
  email: string
  firstName: string
  lastName: string
  address1: string
  address2: string
  city: string
  state: string
  zip: string
  phone: string
  cardNumber: string
  expMonth: string
  expYear: string
  cvv: string
  billingZip: string
  jigIndex: number
  createdAt: string
  updatedAt: string
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

export interface Account {
  id: number
  name: string
  email: string
  password: string
  accessToken: string
  loginMethod: 'token' | 'request'
  status: 'idle' | 'logging_in' | 'logged_in' | 'error'
  lastLoginAt: string | null
  imapProfileId: number | null
  createdAt: string
  updatedAt: string
}

// ─── IMAP ─────────────────────────────────────────────────────────────────────

export interface ImapProfile {
  id: number
  name: string
  host: string
  port: number
  user: string
  password: string
  createdAt: string
}

// ─── Proxies ──────────────────────────────────────────────────────────────────

export type ProxyType = 'isp' | 'residential' | 'datacenter'

export interface ProxyList {
  id: number
  name: string
  type: ProxyType
  proxies: string[]  // ip:port:user:pass or protocol://ip:port
  createdAt: string
  updatedAt: string
}

// ─── Products / SKUs ─────────────────────────────────────────────────────────

export interface MonitorProduct {
  id: number
  groupId: number
  tcin: string
  name: string
  qty: number
  createdAt: string
}

export interface ProductGroup {
  id: number
  name: string
  retailer: 'target' | 'walmart'
  createdAt: string
  products?: MonitorProduct[]
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export type TaskMode = 'monitor' | 'checkout' | 'login' | 'reset'
export type TaskStatus =
  | 'idle'
  | 'starting'
  | 'waiting_cookie'
  | 'waiting_stock'
  | 'logging_in'
  | 'monitoring'
  | 'atc'
  | 'checkout'
  | 'success'
  | 'error'
  | 'stopped'

export interface Task {
  id: number
  name: string
  mode: TaskMode
  retailer: 'target' | 'walmart'
  profileId: number | null
  accountId: number | null
  proxyListId: number | null
  productGroupId: number | null
  status: TaskStatus
  statusText: string
  successCount: number
  retryCount: number
  errorText: string | null
  lastOrderId: string | null
  lastOrderTotal: number | null
  settings: TaskSettings
  createdAt: string
  updatedAt: string
}

export interface TaskSettings {
  useSavedPayment: boolean
  autoPlaceOrder: boolean
  useGuestCheckout: boolean
  preferPickup: boolean
  endlessMode: boolean
  endlessLimit: number
  highStockOnly: boolean
  highStockThreshold: number
  maxPrice: number | null
  checkoutDelayMs: number
  retryMaxAttempts: number
  retryDelayMs: number
  addExtraProduct: boolean
  extraProductTcin: string
  checkoutSound: boolean
  dropExpectedAt: string | null
  monitorCooldownMs: number
}

// ─── Task Run Log ──────────────────────────────────────────────────────────────

export type TaskRunOutcome = 'success' | 'error' | 'stopped' | 'shape_block'

export interface TaskRunLog {
  id: number
  taskId: number
  taskName: string
  outcome: TaskRunOutcome
  tcin: string
  orderId: string | null
  orderTotal: number | null
  durationMs: number | null
  errorText: string | null
  accountEmail: string | null
  proxy: string | null
  ts: string
}

// ─── Cookie Pool ──────────────────────────────────────────────────────────────

export type CookieKind = 'login' | 'atc'

export interface HarvestedCookie {
  id: string
  kind: CookieKind
  cookies: Record<string, string>
  shapeHeaders: Record<string, string>
  ts: number
  expiresAt: number
  harvesterId: string | null
  proxyUsed: string | null
}

export interface CookiePoolStatus {
  loginCount: number
  atcCount: number
  totalCount: number
  lastHarvestAt: number | null
  generationRate: number  // cookies/minute
}

// ─── Harvesters ──────────────────────────────────────────────────────────────

export type HarvesterStatus = 'idle' | 'starting' | 'running' | 'error' | 'stopped'

export interface HarvesterConfig {
  id: string
  name: string
  kind: CookieKind
  targetUrl: string
  intervalMs: number
  maxPoolSize: number
  proxyListId: number | null
  proxyEntry: string | null
  visible: boolean
  autoStart: boolean
  status: HarvesterStatus
  statusText: string
  harvestedCount: number
  createdAt: string
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface AppSettings {
  discordWebhook: string
  webhookSendFailures: boolean
  defaultRetryAttempts: number
  defaultRetryDelayMs: number
  cookieTtlMinutes: number
  cookieRemovalOrder: 'lifo' | 'fifo'
  ntpServer: string
  ntpOffsetMs: number
  checkoutSound: boolean
  extensionWsPort: number
}

// ─── Monitor ─────────────────────────────────────────────────────────────────

export interface MonitorState {
  active: boolean
  dropExpectedAt: string | null
  refreshIntervalMs: number
  lastPollAt: number | null
  lastStockAt: number | null
}

// ─── IPC channel names ────────────────────────────────────────────────────────

export const IPC = {
  // Profiles
  PROFILES_GET_ALL:   'profiles:getAll',
  PROFILES_SAVE:      'profiles:save',
  PROFILES_DELETE:    'profiles:delete',

  // Accounts
  ACCOUNTS_GET_ALL:   'accounts:getAll',
  ACCOUNTS_SAVE:      'accounts:save',
  ACCOUNTS_DELETE:    'accounts:delete',
  ACCOUNTS_LOGIN:     'accounts:login',

  // Proxies
  PROXIES_GET_ALL:    'proxies:getAll',
  PROXIES_SAVE:       'proxies:save',
  PROXIES_DELETE:     'proxies:delete',
  PROXIES_TEST:       'proxies:test',

  // Products / Groups
  GROUPS_GET_ALL:     'groups:getAll',
  GROUPS_SAVE:        'groups:save',
  GROUPS_DELETE:      'groups:delete',
  PRODUCTS_SAVE:      'products:save',
  PRODUCTS_DELETE:    'products:delete',

  // Tasks
  TASKS_GET_ALL:      'tasks:getAll',
  TASKS_SAVE:         'tasks:save',
  TASKS_DELETE:       'tasks:delete',
  TASKS_START:        'tasks:start',
  TASKS_STOP:         'tasks:stop',
  TASKS_START_ALL:    'tasks:startAll',
  TASKS_STOP_ALL:     'tasks:stopAll',
  TASKS_DUPLICATE:    'tasks:duplicate',
  TASKS_GET_LOGS:     'tasks:getLogs',

  // Cookie pool
  POOL_STATUS:        'pool:status',
  POOL_CLEAR:         'pool:clear',

  // Harvesters
  HARVESTERS_GET_ALL: 'harvesters:getAll',
  HARVESTERS_SAVE:    'harvesters:save',
  HARVESTERS_DELETE:  'harvesters:delete',
  HARVESTERS_START:   'harvesters:start',
  HARVESTERS_STOP:    'harvesters:stop',

  // Settings
  SETTINGS_GET:       'settings:get',
  SETTINGS_SAVE:      'settings:save',

  // Monitor
  MONITOR_START:      'monitor:start',
  MONITOR_STOP:       'monitor:stop',
  MONITOR_STATUS:     'monitor:status',

  // Discord test
  DISCORD_TEST:       'discord:test',

  // NTP
  NTP_OFFSET:         'ntp:offset',

  // WS bridge status
  WS_STATUS:          'ws:status',

  // Data backup
  DATA_EXPORT:        'data:export',
  DATA_IMPORT:        'data:import',

  // App updates
  UPDATE_CHECK:       'update:check',

  // Push events (main → renderer)
  PUSH_TASK_UPDATE:   'push:taskUpdate',
  PUSH_POOL_UPDATE:   'push:poolUpdate',
  PUSH_HARVESTER_UPDATE: 'push:harvesterUpdate',
  PUSH_TOAST:         'push:toast',
} as const
