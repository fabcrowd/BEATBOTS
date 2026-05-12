import React, { useEffect, useState, useCallback } from 'react'
import { useStore } from '../store'
import { bridge } from '../bridge'
import { AppSettings } from '../../shared/types'
import PageHeader from '../components/PageHeader'
import Button from '../components/Button'
import { Input, Select, Toggle } from '../components/Input'

const DEFAULTS: AppSettings = {
  discordWebhook: '',
  webhookSendFailures: false,
  defaultRetryAttempts: 3,
  defaultRetryDelayMs: 1000,
  cookieTtlMinutes: 5,
  cookieRemovalOrder: 'lifo',
  ntpServer: 'https://lm-clock.vercel.app/api/time',
  ntpOffsetMs: 0,
  checkoutSound: true,
  extensionWsPort: 9235,
}

export default function Settings() {
  const { settings, setSettings, addToast } = useStore()
  const [form, setForm] = useState<AppSettings>(settings ?? DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [ntpStatus, setNtpStatus] = useState<string>('')
  const [discordTesting, setDiscordTesting] = useState(false)
  const [wsStatus, setWsStatus] = useState<{ port: number; connected: number } | null>(null)
  const [importExportBusy, setImportExportBusy] = useState(false)

  useEffect(() => {
    bridge.invoke('ws:status').then((s: any) => setWsStatus(s)).catch(() => {})
    const interval = setInterval(() => {
      bridge.invoke('ws:status').then((s: any) => setWsStatus(s)).catch(() => {})
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (settings) setForm(settings)
  }, [settings])

  const save = async () => {
    setSaving(true)
    try {
      await bridge.invoke('settings:save', form)
      setSettings(form)
      addToast('Settings saved', 'success')
    } catch (e: any) {
      addToast(`Save failed: ${e.message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const syncNtp = async () => {
    setNtpStatus('Syncing...')
    try {
      const res = await bridge.invoke('ntp:offset')
      setNtpStatus(`Synced! Offset: ${res.offsetMs > 0 ? '+' : ''}${res.offsetMs}ms`)
      setForm((f) => ({ ...f, ntpOffsetMs: res.offsetMs }))
    } catch (e: any) {
      setNtpStatus(`Error: ${e.message}`)
    }
  }

  const testDiscord = async () => {
    setDiscordTesting(true)
    const res = await bridge.invoke('discord:test')
    setDiscordTesting(false)
    addToast(res.ok ? 'Discord webhook OK!' : `Discord error: ${res.error}`, res.ok ? 'success' : 'error')
  }

  const f = (key: keyof AppSettings) => ({
    value: String(form[key] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((s) => ({ ...s, [key]: e.target.value })),
  })

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Settings"
        subtitle="Global app configuration"
        action={<Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Settings'}</Button>}
      />

      <div className="flex-1 overflow-auto p-6 space-y-8 max-w-2xl">

        {/* Discord */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Discord Notifications</h2>
          <Input label="Webhook URL" placeholder="https://discord.com/api/webhooks/..." {...f('discordWebhook')} />
          <Toggle
            label="Send Failure Notifications"
            checked={form.webhookSendFailures}
            onChange={(v) => setForm((s) => ({ ...s, webhookSendFailures: v }))}
            description="Also notify on Shape blocks and errors"
          />
          <Button size="sm" variant="secondary" onClick={testDiscord} disabled={discordTesting}>
            {discordTesting ? 'Testing...' : 'Test Webhook'}
          </Button>
        </section>

        {/* Cookie Pool */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Cookie Pool</h2>
          <Input
            label="Cookie TTL (minutes)"
            type="number"
            min={1}
            value={String(form.cookieTtlMinutes)}
            onChange={(e) => setForm((s) => ({ ...s, cookieTtlMinutes: Number(e.target.value) }))}
          />
          <Select
            label="Removal Order"
            value={form.cookieRemovalOrder}
            onChange={(e) => setForm((s) => ({ ...s, cookieRemovalOrder: e.target.value as any }))}
            options={[
              { value: 'lifo', label: 'LIFO (newest first, recommended)' },
              { value: 'fifo', label: 'FIFO (oldest first)' },
            ]}
          />
        </section>

        {/* Checkout Defaults */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Checkout Defaults</h2>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Default Retry Attempts"
              type="number"
              min={0}
              value={String(form.defaultRetryAttempts)}
              onChange={(e) => setForm((s) => ({ ...s, defaultRetryAttempts: Number(e.target.value) }))}
            />
            <Input
              label="Default Retry Delay (ms)"
              type="number"
              min={0}
              value={String(form.defaultRetryDelayMs)}
              onChange={(e) => setForm((s) => ({ ...s, defaultRetryDelayMs: Number(e.target.value) }))}
            />
          </div>
          <Toggle
            label="Checkout Sound"
            checked={form.checkoutSound}
            onChange={(v) => setForm((s) => ({ ...s, checkoutSound: v }))}
            description="Play a sound on successful checkout"
          />
        </section>

        {/* NTP */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Clock Sync (NTP)</h2>
          <Input label="NTP Server URL" {...f('ntpServer')} />
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={syncNtp}>Sync Now</Button>
            {ntpStatus && <span className="text-xs text-zinc-400 font-mono">{ntpStatus}</span>}
            {form.ntpOffsetMs !== 0 && (
              <span className="text-xs text-zinc-500 font-mono">
                Stored offset: {form.ntpOffsetMs > 0 ? '+' : ''}{form.ntpOffsetMs}ms
              </span>
            )}
          </div>
        </section>

        {/* Extension Bridge */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Extension Bridge</h2>
          <p className="text-xs text-zinc-500">
            The Chrome extension connects to this app via WebSocket to share harvested cookies.
            Install the updated extension from the <code className="text-zinc-400">target-checkout-helper/</code> directory.
          </p>
          <Input
            label="WebSocket Port (configured)"
            type="number"
            value={String(form.extensionWsPort)}
            onChange={(e) => setForm((s) => ({ ...s, extensionWsPort: Number(e.target.value) }))}
          />
          {wsStatus && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-border/30 text-xs">
              <span className={`w-2 h-2 rounded-full ${wsStatus.connected > 0 ? 'bg-green-400' : 'bg-zinc-600'}`} />
              <span className="text-zinc-300 font-mono">
                Live port: <span className="text-zinc-100 font-bold">{wsStatus.port}</span>
              </span>
              <span className="text-zinc-500">·</span>
              <span className="text-zinc-400">
                {wsStatus.connected === 0
                  ? 'No extensions connected'
                  : `${wsStatus.connected} extension${wsStatus.connected > 1 ? 's' : ''} connected`}
              </span>
            </div>
          )}
          {wsStatus && wsStatus.port !== form.extensionWsPort && (
            <div className="text-xs text-yellow-400 flex items-center gap-1">
              ⚠ App auto-stepped to port {wsStatus.port} (configured port was in use). Update extension to match.
            </div>
          )}
        </section>

        {/* Data Backup */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Data Backup</h2>
          <p className="text-xs text-zinc-500">
            Export all profiles, accounts, tasks, proxies, and settings to a JSON file.
            Import restores everything from a previous backup.
          </p>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={importExportBusy}
              onClick={async () => {
                setImportExportBusy(true)
                const res = await bridge.invoke('data:export') as { ok: boolean; filePath?: string; reason?: string; error?: string }
                setImportExportBusy(false)
                if (res.ok) addToast(`Exported to ${res.filePath}`, 'success')
                else if (res.reason !== 'cancelled') addToast(`Export failed: ${res.error}`, 'error')
              }}
            >
              Export Backup
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={importExportBusy}
              onClick={async () => {
                setImportExportBusy(true)
                const res = await bridge.invoke('data:import') as { ok: boolean; reason?: string; error?: string }
                setImportExportBusy(false)
                if (res.ok) addToast('Data imported. Restart the app to reload.', 'success')
                else if (res.reason !== 'cancelled') addToast(`Import failed: ${res.error}`, 'error')
              }}
            >
              Import Backup
            </Button>
          </div>
        </section>

      </div>
    </div>
  )
}
