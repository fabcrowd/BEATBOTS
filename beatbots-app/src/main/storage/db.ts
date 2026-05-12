// Storage layer: simple JSON file per entity type, persisted to userData.
// No native dependencies — works on any platform without build tools.

import fs from 'fs'
import path from 'path'
import { app } from 'electron'

let dataDir = ''
const cache: Record<string, any[]> = {}
const settingsCache: Record<string, string> = {}

export function initDb(): void {
  dataDir = path.join(app.getPath('userData'), 'beatbots-data')
  fs.mkdirSync(dataDir, { recursive: true })
  console.log('[DB] JSON store at', dataDir)
}

// ─── Generic CRUD ─────────────────────────────────────────────────────────────

function storeFile(name: string): string {
  return path.join(dataDir, `${name}.json`)
}

function loadStore(name: string): any[] {
  if (cache[name]) return cache[name]
  try {
    const raw = fs.readFileSync(storeFile(name), 'utf-8')
    cache[name] = JSON.parse(raw)
  } catch {
    cache[name] = []
  }
  return cache[name]
}

function saveStore(name: string): void {
  fs.writeFileSync(storeFile(name), JSON.stringify(cache[name], null, 2), 'utf-8')
}

let idSeq = Date.now()

export function getAll<T extends { id: any }>(storeName: string): T[] {
  const items = loadStore(storeName) as T[]
  return [...items].reverse()  // newest first
}

export function getById<T extends { id: any }>(storeName: string, id: any): T | null {
  const items = loadStore(storeName) as T[]
  return items.find((i) => i.id === id) ?? null
}

export function getWhere<T extends { id: any }>(storeName: string, predicate: (item: T) => boolean): T[] {
  const items = loadStore(storeName) as T[]
  return items.filter(predicate)
}

export function upsert<T extends { id?: any; createdAt?: string; updatedAt?: string }>(
  storeName: string,
  item: T
): T & { id: any } {
  const items = loadStore(storeName) as T[]
  const now = new Date().toISOString()

  if (!item.id) {
    const newItem = { ...item, id: ++idSeq, createdAt: now, updatedAt: now }
    items.push(newItem)
    cache[storeName] = items
    saveStore(storeName)
    return newItem as T & { id: any }
  }

  const idx = items.findIndex((i: any) => i.id === item.id)
  if (idx === -1) {
    const newItem = { ...item, createdAt: now, updatedAt: now }
    items.push(newItem)
    cache[storeName] = items
    saveStore(storeName)
    return newItem as T & { id: any }
  }

  const updated = { ...items[idx], ...item, updatedAt: now }
  items[idx] = updated
  cache[storeName] = items
  saveStore(storeName)
  return updated as T & { id: any }
}

export function remove(storeName: string, id: any): void {
  const items = loadStore(storeName)
  cache[storeName] = items.filter((i: any) => i.id !== id)
  saveStore(storeName)
}

export function removeWhere(storeName: string, predicate: (item: any) => boolean): void {
  const items = loadStore(storeName)
  cache[storeName] = items.filter((i: any) => !predicate(i))
  saveStore(storeName)
}

// ─── Export / Import ──────────────────────────────────────────────────────────

const EXPORTABLE_STORES = ['profiles', 'accounts', 'proxy_lists', 'product_groups', 'monitor_products', 'harvesters', 'tasks', 'imap_profiles']

export function exportAllData(): Record<string, any> {
  const snapshot: Record<string, any> = {
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: (() => {
      try {
        const raw = fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf-8')
        return JSON.parse(raw)
      } catch { return {} }
    })(),
  }
  for (const store of EXPORTABLE_STORES) {
    snapshot[store] = loadStore(store)
  }
  return snapshot
}

export function importAllData(snapshot: Record<string, any>): void {
  if (snapshot.settings) {
    Object.assign(settingsCache, snapshot.settings)
    saveSettings()
  }
  for (const store of EXPORTABLE_STORES) {
    if (Array.isArray(snapshot[store])) {
      cache[store] = snapshot[store]
      saveStore(store)
    }
  }
}

export function getDataDir(): string {
  return dataDir
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function loadSettings(): void {
  if (Object.keys(settingsCache).length > 0) return
  try {
    const raw = fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf-8')
    Object.assign(settingsCache, JSON.parse(raw))
  } catch {
    // defaults will be returned by getSetting
  }
}

function saveSettings(): void {
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify(settingsCache, null, 2), 'utf-8')
}

export function getSetting(key: string, fallback: string): string {
  loadSettings()
  return settingsCache[key] ?? fallback
}

export function setSetting(key: string, value: string): void {
  loadSettings()
  settingsCache[key] = value
  saveSettings()
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export function close(): void {
  // All saves happen synchronously — nothing to flush
}
