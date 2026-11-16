import { useEffect, useRef, useState } from 'react'
import { IDLE_SVG, WALK_SVG } from './character'
import { BOAT, BOAT_NEEDS, CHAI, MAP_H, MAP_W, PLACES, SCROLLS, START, type Pickup, type Place } from './data'

export type Near = { kind: 'place'; place: Place } | { kind: 'boat'; locked: boolean } | null

type Props = {
  visited: string[]
  picked: string[]
  paused: boolean
  onNear: (n: Near) => void
  onPickup: (p: Pickup) => void
  /** Bumped by the parent to request "interact with whatever is near". */
  interactTick: number
  onInteract: (n: Near) => void
}

const SPEED = 105
const TINTS = [
  { upTo: 1, color: 'rgba(255,196,170,0.13)' },
  { upTo: 5, color: 'rgba(255,255,255,0)' },
  { upTo: 7, color: 'rgba(255,168,92,0.24)' },
  { upTo: 9, color: 'rgba(124,92,168,0.45)' },
  { upTo: 10, color: 'rgba(34,44,92,0.66)' },
]

const ALL_PICKUPS = [...CHAI, ...SCROLLS]

export default function World({ visited, picked, paused, onNear, onPickup, interactTick, onInteract }: Props) {
  const viewRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<SVGGElement>(null)
  const flipRef = useRef<SVGGElement>(null)
  const walkRef = useRef<SVGGElement>(null)
  const idleRef = useRef<SVGGElement>(null)
  const arrowRef = useRef<SVGGElement>(null)
  const rippleRef = useRef<SVGGElement>(null)
  const miniDotRef = useRef<HTMLDivElement>(null)

  const pos = useRef({ ...START })
  const target = useRef<{ x: number; y: number } | null>(null)
  const keys = useRef(new Set<string>())
  const cam = useRef({ x: 0, y: 0, ready: false })
  const nearRef = useRef<Near>(null)
  const [zoom, setZoom] = useState(2)
  const zoomRef = useRef(2)

  // Latest props for the animation loop.
  const live = useRef({ visited, picked, paused, onNear, onPickup })
  live.current = { visited, picked, paused, onNear, onPickup }

  useEffect(() => {
    const fit = () => {
      const z = Math.max(1.5, Math.max(innerWidth / MAP_W, innerHeight / MAP_H) * 1.25)
      zoomRef.current = z
      setZoom(z)
    }
    fit()
    addEventListener('resize', fit)
    return () => removeEventListener('resize', fit)
  }, [])

  useEffect(() => {
    const MOVE = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd']
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (MOVE.includes(k)) {
        if (!live.current.paused) e.preventDefault()
        keys.current.add(k)
      }
    }
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase())
    const blur = () => keys.current.clear()
    addEventListener('keydown', down)
    addEventListener('keyup', up)
    addEventListener('blur', blur)
    return () => {
      removeEventListener('keydown', down)
      removeEventListener('keyup', up)
      removeEventListener('blur', blur)
    }
  }, [])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let facing = 1
    let wasMoving: boolean | null = null

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { visited, picked, paused, onNear, onPickup } = live.current
      const p = pos.current
      const z = zoomRef.current

      let dx = 0
      let dy = 0
      if (!paused) {
        const k = keys.current
        if (k.has('arrowleft') || k.has('a')) dx -= 1
        if (k.has('arrowright') || k.has('d')) dx += 1
        if (k.has('arrowup') || k.has('w')) dy -= 1
        if (k.has('arrowdown') || k.has('s')) dy += 1
        if (dx || dy) target.current = null
        else if (target.current) {
          const tx = target.current.x - p.x
          const ty = target.current.y - p.y
          const d = Math.hypot(tx, ty)
          if (d < 2.5) target.current = null
          else {
            dx = tx / d
            dy = ty / d
          }
        }
      }
      const len = Math.hypot(dx, dy)
      const moving = len > 0
      if (moving) {
        p.x = Math.min(MAP_W - 22, Math.max(22, p.x + (dx / len) * SPEED * dt))
        p.y = Math.min(MAP_H - 22, Math.max(118, p.y + (dy / len) * SPEED * dt))
        if (Math.abs(dx) > 0.15) facing = dx > 0 ? 1 : -1
      }

      playerRef.current?.setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`)
      flipRef.current?.setAttribute('transform', `scale(${facing} 1)`)
      if (moving !== wasMoving) {
        wasMoving = moving
        if (walkRef.current) walkRef.current.style.display = moving ? '' : 'none'
        if (idleRef.current) idleRef.current.style.display = moving ? 'none' : ''
      }
      if (rippleRef.current) {
        const t = target.current
        rippleRef.current.style.display = t ? '' : 'none'
        if (t) rippleRef.current.setAttribute('transform', `translate(${t.x} ${t.y})`)
      }

      // Camera follows the traveller, clamped to the edges of the map.
      const vw = viewRef.current?.clientWidth ?? innerWidth
      const vh = viewRef.current?.clientHeight ?? innerHeight
      const maxX = Math.max(0, MAP_W * z - vw)
      const maxY = Math.max(0, MAP_H * z - vh)
      const wantX = Math.min(maxX, Math.max(0, p.x * z - vw / 2))
      const wantY = Math.min(maxY, Math.max(0, p.y * z - vh * 0.52))
      const c = cam.current
      if (!c.ready) {
        c.x = wantX
        c.y = wantY
        c.ready = true
      } else {
        const ease = 1 - Math.pow(0.002, dt)
        c.x += (wantX - c.x) * ease
        c.y += (wantY - c.y) * ease
      }
      if (worldRef.current) worldRef.current.style.transform = `translate3d(${-c.x.toFixed(1)}px, ${-c.y.toFixed(1)}px, 0)`
      if (miniDotRef.current) {
        miniDotRef.current.style.left = `${(p.x / MAP_W) * 100}%`
        miniDotRef.current.style.top = `${(p.y / MAP_H) * 100}%`
      }

      // What is the traveller standing next to?
      let near: Near = null
      for (const pl of PLACES) {
        if (Math.hypot(pl.x - p.x, pl.y - p.y) < 38) {
          near = { kind: 'place', place: pl }
          break
        }
      }
      if (!near && Math.hypot(BOAT.x - p.x, BOAT.y - p.y) < 34) near = { kind: 'boat', locked: visited.length < BOAT_NEEDS }
      const a = nearRef.current
      const same =
        (a === null && near === null) ||
        (a?.kind === 'place' && near?.kind === 'place' && a.place.id === near.place.id) ||
        (a?.kind === 'boat' && near?.kind === 'boat' && a.locked === near.locked)
      if (!same) {
        nearRef.current = near
        onNear(near)
      }

      if (!paused) {
        for (const pk of ALL_PICKUPS) {
          if (!picked.includes(pk.id) && Math.hypot(pk.x - p.x, pk.y - p.y) < 16) onPickup(pk)
        }
      }

      // Quest arrow: points to the closest place not yet visited.
      if (arrowRef.current) {
        let best: Place | null = null
        let bestD = Infinity
        for (const pl of PLACES) {
          if (visited.includes(pl.id)) continue
          const d = Math.hypot(pl.x - p.x, pl.y - p.y)
          if (d < bestD) {
            bestD = d
            best = pl
          }
        }
        if (best && bestD > 55) {
          const ang = (Math.atan2(best.y - p.y, best.x - p.x) * 180) / Math.PI
          arrowRef.current.style.display = ''
          arrowRef.current.setAttribute('transform', `translate(${p.x.toFixed(2)} ${(p.y - 22).toFixed(2)}) rotate(${ang.toFixed(1)})`)
        } else arrowRef.current.style.display = 'none'
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    if (interactTick > 0) onInteract(nearRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactTick])

  const walkTo = (e: React.PointerEvent) => {
    if (paused || !worldRef.current) return
    const r = worldRef.current.getBoundingClientRect()
    const x = (e.clientX - r.left) / zoomRef.current
    const y = (e.clientY - r.top) / zoomRef.current
    // Tapping a building walks to its door.
    const hit = PLACES.find(pl => Math.abs(pl.cx - x) < 46 && Math.abs(pl.cy - y) < 44)
    target.current = hit ? { x: hit.x, y: hit.y } : { x, y: Math.max(118, y) }
  }

  const n = visited.length
  const tint = TINTS.find(t => n <= t.upTo)!.color
  const night = n >= 10
  const dusk = n >= 8

  return (
    <div ref={viewRef} className="absolute inset-0 overflow-hidden bg-[#D7E4EA]">
      <div
        ref={worldRef}
        onPointerDown={walkTo}
        className="absolute left-0 top-0 cursor-pointer will-change-transform"
        style={{ width: MAP_W * zoom, height: MAP_H * zoom }}
      >
        <img src={`${import.meta.env.BASE_URL}world.svg`} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none" />

        {/* Drifting clouds */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {[12, 38, 67].map((top, i) => (
            <div key={top} className="lw-cloud" style={{ top: `${top}%`, animationDuration: `${70 + i * 25}s`, animationDelay: `${-i * 30}s` }} />
          ))}
        </div>

        {/* Time of day: the sky moves from dawn to night as the passport fills. */}
        <div className="pointer-events-none absolute inset-0 transition-[background-color] duration-[2500ms]" style={{ backgroundColor: tint, mixBlendMode: 'multiply' }} />

        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="absolute inset-0 h-full w-full select-none" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
          <defs>
            <radialGradient id="lw-glow">
              <stop offset="0" stopColor="#FFF0C2" stopOpacity="1" />
              <stop offset=".6" stopColor="#FFF0C2" stopOpacity=".5" />
              <stop offset="1" stopColor="#FFF0C2" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="lw-beam" x1="0" x2="1">
              <stop offset="0" stopColor="#FFF1C9" stopOpacity=".85" />
              <stop offset="1" stopColor="#FFF1C9" stopOpacity="0" />
            </linearGradient>
          </defs>

          {night && (
            <g>
              {Array.from({ length: 46 }, (_, i) => (
                <circle key={i} cx={(i * 211.7) % MAP_W} cy={(i * 97.3) % MAP_H} r={i % 5 === 0 ? 1.5 : 0.9} fill="#FFF8DC" className="lw-twinkle" style={{ animationDelay: `${(i % 7) * 0.4}s` }} />
              ))}
            </g>
          )}

          {dusk && (
            <g transform="translate(895 266)">
              <g className="lw-sweep">
                <path d="M0 0 L-330 -70 L-330 70 Z" fill="url(#lw-beam)" transform="scale(-1 1)" opacity=".5" />
              </g>
            </g>
          )}

          {PLACES.map(pl => {
            const done = visited.includes(pl.id)
            return (
              <g key={pl.id}>
                {done && <ellipse cx={pl.cx} cy={pl.cy} rx="88" ry="54" fill="url(#lw-glow)" opacity={dusk ? 0.95 : 0.5} className="lw-breathe" />}
                {done ? (
                  <g transform={`translate(${pl.cx + 34} ${pl.cy - 44})`}>
                    <rect x="-.8" y="0" width="1.6" height="22" fill="#8C7F73" />
                    <path d="M.8 1 L17 6 L.8 12Z" fill={pl.color} stroke="#8C7F73" strokeWidth=".6" />
                    <text x="6" y="9" fontSize="6" textAnchor="middle" fill="#5E544B">✓</text>
                  </g>
                ) : (
                  <g transform={`translate(${pl.cx} ${pl.cy - 58})`}>
                    <g className="lw-bob">
                      <path d="M0 16 L-7 4 A9 9 0 1 1 7 4Z" fill="#E3A99A" stroke="#FAF3E8" strokeWidth="1.5" />
                      <text y="3" fontSize="10" fontWeight="bold" textAnchor="middle" fill="#FAF3E8">?</text>
                    </g>
                  </g>
                )}
              </g>
            )
          })}

          {/* The boat that sails beyond the edge of the map */}
          <g transform={`translate(${BOAT.x + 22} ${BOAT.y + 16})`}>
            <g className="lw-rock">
              <path d="M-16 0 Q0 9 16 0 L12 7 Q0 11 -12 7Z" fill="#B59A86" />
              <rect x="-.8" y="-24" width="1.6" height="24" fill="#8C7F73" />
              <path d="M1.5 -23 L15 -4 L1.5 -4Z" fill="#FAF3E8" stroke="#D9C8B4" />
              <path d="M-1.5 -19 L-11 -4 L-1.5 -4Z" fill="#E3A99A" opacity=".9" />
            </g>
            {n < BOAT_NEEDS && <text y="-30" fontSize="11" textAnchor="middle">🔒</text>}
            <text y="24" fontSize="10" fontStyle="italic" textAnchor="middle" fill="#5E544B" stroke="#FAF3E8" strokeWidth="4" paintOrder="stroke" strokeLinejoin="round">
              Beyond the map
            </text>
          </g>

          {ALL_PICKUPS.filter(pk => !picked.includes(pk.id)).map((pk, i) => (
            <g key={pk.id} transform={`translate(${pk.x} ${pk.y})`}>
              <ellipse cx="0" cy="2" rx="7" ry="2" fill="#8C7F73" opacity=".16" />
              <g className="lw-float" style={{ animationDelay: `${(i % 6) * 0.3}s` }}>
                {pk.kind === 'scroll' && <circle r="12" cy="-9" fill="url(#lw-glow)" />}
                <text y="-4" fontSize={pk.kind === 'chai' ? 13 : 15} textAnchor="middle">
                  {pk.kind === 'chai' ? '☕' : '📜'}
                </text>
              </g>
            </g>
          ))}

          <g ref={rippleRef} style={{ display: 'none' }}>
            <ellipse rx="7" ry="3" fill="none" stroke="#8A6F5A" strokeWidth="1.2" className="lw-ripple" />
            <ellipse rx="2" ry="1" fill="#8A6F5A" opacity=".6" />
          </g>

          <g ref={arrowRef} style={{ display: 'none' }}>
            <g className="lw-nudge">
              <path d="M30 0 L21 -5 L23 0 L21 5Z" fill="#8A6F5A" stroke="#FAF3E8" strokeWidth="1.2" strokeLinejoin="round" />
            </g>
          </g>

          <g ref={playerRef} transform={`translate(${START.x} ${START.y})`}>
            <ellipse cx="0" cy="0" rx="9" ry="2.6" fill="#5E544B" opacity=".2" />
            <g transform="scale(1.55)">
              <g ref={flipRef}>
                <g ref={walkRef} style={{ display: 'none' }} dangerouslySetInnerHTML={{ __html: WALK_SVG }} />
                <g ref={idleRef} dangerouslySetInnerHTML={{ __html: IDLE_SVG }} />
              </g>
            </g>
          </g>
        </svg>
      </div>

      {/* Minimap */}
      <div className="pointer-events-none absolute bottom-24 right-4 hidden w-44 overflow-hidden rounded-xl border-2 border-[#D9C8B4] bg-[#FAF3E8] shadow-lg md:block">
        <div className="relative">
          <img src={`${import.meta.env.BASE_URL}world.svg`} alt="" className="block w-full opacity-90" />
          {PLACES.map(pl => (
            <span
              key={pl.id}
              className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white"
              style={{ left: `${(pl.cx / MAP_W) * 100}%`, top: `${(pl.cy / MAP_H) * 100}%`, background: visited.includes(pl.id) ? '#7FA277' : '#E3A99A' }}
            />
          ))}
          <div ref={miniDotRef} className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#5E544B] shadow" />
        </div>
      </div>
    </div>
  )
}
