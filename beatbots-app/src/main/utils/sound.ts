// Checkout success sound — played in the renderer via IPC push.
// The renderer uses the Web Audio API to generate a pleasant success chime
// without requiring any audio file assets.

import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/types'

export function playCheckoutSound(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC.PUSH_TOAST, {
    message: '__play_sound__',
    kind: 'success',
    sound: 'checkout',
  })
}
