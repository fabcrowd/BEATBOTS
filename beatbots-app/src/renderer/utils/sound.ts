// Web Audio API checkout success sound — no audio files needed.
// Generates a two-tone chime resembling a "success" notification.

let audioCtx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext()
  return audioCtx
}

export function playCheckoutChime(): void {
  try {
    const ctx = getCtx()
    const now = ctx.currentTime

    const notes = [
      { freq: 880, start: 0,    dur: 0.18, gain: 0.4 },
      { freq: 1100, start: 0.15, dur: 0.18, gain: 0.35 },
      { freq: 1320, start: 0.30, dur: 0.35, gain: 0.3 },
    ]

    for (const note of notes) {
      const osc = ctx.createOscillator()
      const gainNode = ctx.createGain()

      osc.connect(gainNode)
      gainNode.connect(ctx.destination)

      osc.type = 'sine'
      osc.frequency.setValueAtTime(note.freq, now + note.start)

      gainNode.gain.setValueAtTime(0, now + note.start)
      gainNode.gain.linearRampToValueAtTime(note.gain, now + note.start + 0.02)
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + note.start + note.dur)

      osc.start(now + note.start)
      osc.stop(now + note.start + note.dur + 0.05)
    }
  } catch { /* audio context unavailable — ignore */ }
}

export function playErrorBeep(): void {
  try {
    const ctx = getCtx()
    const now = ctx.currentTime

    const osc = ctx.createOscillator()
    const gainNode = ctx.createGain()
    osc.connect(gainNode)
    gainNode.connect(ctx.destination)

    osc.type = 'square'
    osc.frequency.setValueAtTime(220, now)
    osc.frequency.setValueAtTime(180, now + 0.1)

    gainNode.gain.setValueAtTime(0.15, now)
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.25)

    osc.start(now)
    osc.stop(now + 0.3)
  } catch { /* ignore */ }
}
