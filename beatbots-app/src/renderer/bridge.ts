// Type-safe wrapper around the preload bridge (window.beatbots)
import type { IPC as IPCType } from '../shared/types'

type IPCKey = keyof typeof import('../shared/types').IPC

declare global {
  interface Window {
    beatbots: {
      invoke: (channel: string, ...args: any[]) => Promise<any>
      on: (channel: string, cb: (...args: any[]) => void) => () => void
      off: (channel: string, cb: (...args: any[]) => void) => void
      IPC: typeof import('../shared/types').IPC
    }
  }
}

export const bridge = {
  invoke: (channel: string, ...args: any[]) => window.beatbots.invoke(channel, ...args),
  on: (channel: string, cb: (...args: any[]) => void) => window.beatbots.on(channel, cb),
  off: (channel: string, cb: (...args: any[]) => void) => window.beatbots.off(channel, cb),
}

export const IPC = () => window.beatbots.IPC
