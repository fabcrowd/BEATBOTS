import { getSetting } from '../storage/db'

function getWebhook(): string {
  try {
    return getSetting('discordWebhook', '')
  } catch { return '' }
}

export async function sendDiscordEmbed(opts: {
  title: string
  description?: string
  color?: number
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  footer?: string
}): Promise<void> {
  const webhook = getWebhook()
  if (!webhook) return

  const payload = {
    embeds: [{
      title: opts.title,
      description: opts.description,
      color: opts.color ?? 0xef4444,
      fields: opts.fields ?? [],
      footer: opts.footer ? { text: opts.footer } : undefined,
      timestamp: new Date().toISOString(),
    }],
  }

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    console.warn('[Discord] webhook failed:', e)
  }
}

export async function notifyCheckoutSuccess(opts: {
  taskName: string
  accountEmail: string
  tcin: string
  productName?: string
  totalMs?: number
}): Promise<void> {
  await sendDiscordEmbed({
    title: '✅ Checkout Success',
    color: 0x22c55e,
    fields: [
      { name: 'Task',    value: opts.taskName,        inline: true },
      { name: 'Account', value: opts.accountEmail,    inline: true },
      { name: 'TCIN',    value: opts.tcin,            inline: true },
      ...(opts.productName ? [{ name: 'Product', value: opts.productName, inline: false }] : []),
      ...(opts.totalMs ? [{ name: 'Speed', value: `${(opts.totalMs / 1000).toFixed(2)}s`, inline: true }] : []),
    ],
    footer: 'BEATBOTS',
  })
}

export async function notifyShapeBlock(taskName: string): Promise<void> {
  await sendDiscordEmbed({
    title: '⚠️ Shape Block',
    color: 0xf59e0b,
    description: `Task "${taskName}" hit a Shape block. Cookie pool may be depleted.`,
    footer: 'BEATBOTS',
  })
}

export async function notifyStockDetected(tcin: string, productName?: string): Promise<void> {
  await sendDiscordEmbed({
    title: '📦 Stock Detected',
    color: 0x3b82f6,
    fields: [
      { name: 'TCIN',    value: tcin,                 inline: true },
      ...(productName ? [{ name: 'Product', value: productName, inline: true }] : []),
    ],
    footer: 'BEATBOTS',
  })
}
