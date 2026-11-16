// Tiny synthesised sound effects, no audio files.
let ctx: AudioContext | null = null
let muted = false

export function setMuted(m: boolean) {
  muted = m
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.06) {
  if (!ctx) return
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.value = freq
  const t = ctx.currentTime + start
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(ctx.destination)
  o.start(t)
  o.stop(t + dur + 0.02)
}

export function play(kind: 'chai' | 'scroll' | 'stamp' | 'open' | 'finale') {
  if (muted) return
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    return
  }
  if (kind === 'chai') { tone(880, 0, 0.12); tone(1320, 0.07, 0.16) }
  if (kind === 'scroll') { tone(523, 0, 0.18, 'triangle'); tone(659, 0.1, 0.18, 'triangle'); tone(784, 0.2, 0.3, 'triangle') }
  if (kind === 'open') tone(440, 0, 0.1, 'triangle', 0.04)
  if (kind === 'stamp') { tone(196, 0, 0.12, 'square', 0.05); tone(523, 0.1, 0.2); tone(784, 0.2, 0.2); tone(1047, 0.3, 0.4) }
  if (kind === 'finale') [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, i * 0.12, 0.5, 'triangle'))
}
