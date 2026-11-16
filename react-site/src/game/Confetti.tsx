import { useEffect, useRef } from 'react'

const COLORS = ['#E3A99A', '#F4D58D', '#A6BF9E', '#A9C2D6', '#C9B3DA', '#FFF1C9']

/** Full-screen celebration: firework bursts on a canvas. */
export default function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = ref.current!
    const g = c.getContext('2d')!
    let raf = 0
    let last = performance.now()
    let nextBurst = 0
    type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; r: number }
    let parts: P[] = []
    const size = () => {
      c.width = innerWidth * devicePixelRatio
      c.height = innerHeight * devicePixelRatio
    }
    size()
    addEventListener('resize', size)

    const burst = () => {
      const x = (0.15 + Math.random() * 0.7) * c.width
      const y = (0.12 + Math.random() * 0.4) * c.height
      const color = COLORS[Math.floor(Math.random() * COLORS.length)]
      const n = 70
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        const s = (120 + Math.random() * 260) * devicePixelRatio
        parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 1.1 + Math.random() * 0.8, color, r: (1.5 + Math.random() * 2.5) * devicePixelRatio })
      }
    }

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (now > nextBurst) {
        burst()
        nextBurst = now + 450 + Math.random() * 700
      }
      g.clearRect(0, 0, c.width, c.height)
      parts = parts.filter(p => p.life < p.max)
      for (const p of parts) {
        p.life += dt
        p.vx *= 0.985
        p.vy = p.vy * 0.985 + 140 * devicePixelRatio * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        g.globalAlpha = Math.max(0, 1 - p.life / p.max)
        g.fillStyle = p.color
        g.beginPath()
        g.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        g.fill()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      removeEventListener('resize', size)
    }
  }, [])

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[60] h-full w-full" />
}
