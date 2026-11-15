import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Dock from '@/components/Dock/Dock'
import GradientText from '@/components/GradientText/GradientText'
import Particles from '@/components/Particles/Particles'
import ShinyText from '@/components/ShinyText/ShinyText'
import Confetti from './Confetti'
import { BACKPACK, BEYOND, BOAT_NEEDS, CHAI, ME, PLACES, RANKS, SCROLLS, type Pickup, type Place } from './data'
import { play, setMuted } from './sound'
import { useProgress } from './useProgress'
import World, { type Near } from './World'

type Panel = null | 'passport' | 'backpack' | 'journal' | 'contact' | 'beyond' | 'finale' | 'help'
type Toast = { id: number; icon: string; title: string; text?: string }

const TIME_LABEL = (n: number) => (n <= 1 ? '🌅 Dawn' : n <= 5 ? '☀️ Day' : n <= 7 ? '🌇 Golden hour' : n <= 9 ? '🌆 Dusk' : '🌙 Night')

export default function Game({ onReadMode }: { onReadMode: () => void }) {
  const { p, visit, pick, patch, reset, chai, scrolls, xp, maxXp } = useProgress()
  const [near, setNear] = useState<Near>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [place, setPlace] = useState<{ place: Place; fresh: boolean } | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [interactTick, setInteractTick] = useState(0)
  const [muted, setMute] = useState(false)
  const [moved, setMoved] = useState(false)
  const toastId = useRef(0)

  const paused = panel !== null || place !== null
  const n = p.visited.length
  const done = n === PLACES.length

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++toastId.current
    setToasts(s => [...s.slice(-2), { ...t, id }])
    setTimeout(() => setToasts(s => s.filter(x => x.id !== id)), t.text ? 6500 : 2200)
  }, [])

  const onPickup = useCallback(
    (pk: Pickup) => {
      pick(pk.id)
      play(pk.kind)
      if (pk.kind === 'chai') toast({ icon: '☕', title: 'A cup of chai  +25 XP' })
      else toast({ icon: '📜', title: 'A page of the story  +50 XP', text: pk.text })
    },
    [pick, toast],
  )

  const onInteract = useCallback(
    (nr: Near) => {
      if (!nr) return
      if (nr.kind === 'place') {
        const fresh = !p.visited.includes(nr.place.id)
        setPlace({ place: nr.place, fresh })
        if (fresh) {
          visit(nr.place.id)
          play('stamp')
        } else play('open')
      } else if (!nr.locked) {
        patch({ beyond: true })
        play('scroll')
        setPanel('beyond')
      } else toast({ icon: '🔒', title: `The boat sails after ${BOAT_NEEDS} stamps` })
    },
    [p.visited, visit, patch, toast],
  )

  // Closing the tenth place for the first time opens the finale.
  const closePlace = () => {
    setPlace(null)
    if (done && !p.finaleSeen) {
      patch({ finaleSeen: true })
      play('finale')
      setPanel('finale')
    }
  }
  const closeRef = useRef(() => {})
  closeRef.current = () => {
    if (place) closePlace()
    else setPanel(null)
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (k === 'escape') closeRef.current()
      else if ((k === 'e' || k === 'enter' || k === ' ') && !paused) {
        if (k === ' ') e.preventDefault()
        setInteractTick(t => t + 1)
      } else if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) setMoved(true)
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [paused])


  const prompt =
    near?.kind === 'place'
      ? { text: `${p.visited.includes(near.place.id) ? 'Visit again' : 'Step inside'}: ${near.place.place}`, emoji: near.place.emoji }
      : near?.kind === 'boat'
        ? { text: near.locked ? `Boat locked: collect ${BOAT_NEEDS} stamps (${n}/${BOAT_NEEDS})` : 'Sail beyond the edge of the map', emoji: '⛵' }
        : null

  const icon = (e: string) => <span className="text-[22px] leading-none">{e}</span>

  return (
    <div className="fixed inset-0 overflow-hidden text-[#5E544B]" onPointerDown={() => setMoved(true)}>
      <World visited={p.visited} picked={p.picked} paused={paused} onNear={setNear} onPickup={onPickup} interactTick={interactTick} onInteract={onInteract} />

      {done && (
        <div className="pointer-events-none absolute inset-0 z-10 opacity-80">
          <Particles particleCount={90} particleColors={['#FFF1C9', '#F4D58D', '#FFE9A8']} particleBaseSize={70} speed={0.06} alphaParticles moveParticlesOnHover={false} />
        </div>
      )}

      {/* Top-left: level, rank, XP */}
      <div className="pointer-events-none absolute left-3 top-3 z-20 w-[min(300px,calc(100vw-24px))] sm:left-5 sm:top-5">
        <div className="lw-paper rounded-2xl px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-serif text-[13px] tracking-[0.18em]">⭐ LEVEL {n} / {PLACES.length}</span>
            <span className="text-[11px] text-[#8C7F73]">{TIME_LABEL(n)}</span>
          </div>
          <div className="mt-0.5 font-serif text-[15px] italic">{RANKS[n]}</div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#E8DCCB]">
            <div className="h-full rounded-full bg-gradient-to-r from-[#A6BF9E] via-[#F4D58D] to-[#E3A99A] transition-[width] duration-700" style={{ width: `${(xp / maxXp) * 100}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-[#8C7F73]">
            <span>{xp} / {maxXp} XP</span>
            <span>☕ {chai}/{CHAI.length} · 📜 {scrolls}/{SCROLLS.length}</span>
          </div>
        </div>
      </div>

      {/* Top-right: small controls */}
      <div className="absolute right-3 top-[112px] z-20 flex gap-2 sm:right-5 sm:top-5">
        <button className="lw-btn" title={muted ? 'Sound off' : 'Sound on'} onClick={() => { setMute(!muted); setMuted(!muted) }}>
          {muted ? '🔇' : '🔊'}
        </button>
        <button className="lw-btn" title="How to play" onClick={() => setPanel('help')}>?</button>
        <button className="lw-btn !w-auto px-3 text-[12px]" onClick={onReadMode}>Read mode</button>
      </div>

      {/* First-visit hint */}
      {!moved && !paused && (
        <div className="pointer-events-none absolute left-1/2 top-[24%] z-20 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 text-center">
          <div className="lw-paper lw-pop rounded-2xl px-5 py-3 text-[14px]">
            <b className="font-serif italic">Walk around.</b> Arrow keys / WASD, or tap where you want to go.
            <div className="mt-1 text-[12px] text-[#8C7F73]">Every building is an app. Step inside to stamp your passport.</div>
          </div>
        </div>
      )}

      {/* Interaction prompt */}
      {prompt && !paused && (
        <div className="absolute bottom-[92px] left-1/2 z-20 -translate-x-1/2">
          <button onClick={() => setInteractTick(t => t + 1)} className="lw-paper lw-pop flex items-center gap-2 whitespace-nowrap rounded-full px-5 py-2.5 text-[14px] font-medium shadow-lg transition hover:scale-105">
            <span className="text-lg">{prompt.emoji}</span>
            {prompt.text}
            <kbd className="ml-1 hidden rounded border border-[#D9C8B4] bg-white px-1.5 text-[11px] sm:inline">E</kbd>
          </button>
        </div>
      )}

      {/* Toasts */}
      <div className="pointer-events-none absolute left-1/2 top-24 z-30 flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map(t => (
          <div key={t.id} className="lw-paper lw-pop w-fit max-w-full rounded-2xl px-4 py-2.5 text-center shadow-lg">
            <div className="text-[13px] font-semibold">{t.icon} {t.title}</div>
            {t.text && <div className="mt-1 font-serif text-[15px] italic leading-snug">“{t.text}”</div>}
          </div>
        ))}
      </div>

      {/* Bottom dock */}
      <div className="absolute inset-x-0 bottom-0 z-20 h-24">
        <Dock
          theme="light"
          baseItemSize={46}
          magnification={1.45}
          showBadges
          badgeColor="#C97F6E"
          items={[
            { icon: icon('🛂'), label: 'Passport', badge: n || undefined, onClick: () => setPanel('passport') },
            { icon: icon('🎒'), label: 'Backpack', onClick: () => setPanel('backpack') },
            { icon: icon('📖'), label: 'Journal', badge: scrolls || undefined, onClick: () => setPanel('journal') },
            { icon: icon('✉️'), label: 'Write to me', onClick: () => setPanel('contact') },
            ...(p.beyond ? [{ icon: icon('🌙'), label: 'Beyond the map', onClick: () => setPanel('beyond') }] : []),
          ]}
        />
      </div>

      {place && <PlaceModal place={place.place} fresh={place.fresh} count={n} onClose={closePlace} />}

      {panel === 'passport' && (
        <Modal title="Traveller's passport" sub={`${n} of ${PLACES.length} stamps · ${RANKS[n]}`} onClose={() => setPanel(null)}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {PLACES.map((pl, i) => {
              const got = p.visited.includes(pl.id)
              return (
                <button
                  key={pl.id}
                  disabled={!got}
                  onClick={() => { setPanel(null); setPlace({ place: pl, fresh: false }) }}
                  className={`flex aspect-square flex-col items-center justify-center rounded-full border-2 border-dashed p-2 text-center transition ${got ? 'lw-stamped hover:scale-105' : 'border-[#D9C8B4] opacity-60'}`}
                  style={got ? { borderColor: pl.color, color: '#5E544B', rotate: `${((i * 37) % 13) - 6}deg`, background: `${pl.color}33` } : undefined}
                >
                  <span className="text-2xl">{got ? pl.emoji : '❔'}</span>
                  <span className="mt-1 font-serif text-[11px] italic leading-tight">{got ? pl.place : 'Not yet visited'}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-4 text-center text-[13px] text-[#8C7F73]">
            {done ? 'Every stamp collected. Thank you for wandering the whole world.' : 'Follow the little arrow beside the traveller to the next place.'}
          </p>
        </Modal>
      )}

      {panel === 'backpack' && (
        <Modal title="In my backpack" sub="The tools I carry" onClose={() => setPanel(null)}>
          <div className="space-y-4">
            {BACKPACK.map(group => (
              <div key={group.title}>
                <div className="mb-1.5 font-serif text-[14px] italic text-[#8A6F5A]">{group.title}</div>
                <div className="flex flex-wrap gap-2">
                  {group.items.map(it => (
                    <span key={it} className="lw-slot">{it}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {panel === 'journal' && (
        <Modal title="The traveller who built it" sub={`${scrolls} of ${SCROLLS.length} pages found on the map`} onClose={() => setPanel(null)}>
          <div className="space-y-3">
            {SCROLLS.map((s, i) => {
              const got = p.picked.includes(s.id)
              return (
                <div key={s.id} className={`rounded-xl border px-4 py-3 ${got ? 'border-[#E8DCCB] bg-white/60' : 'border-dashed border-[#D9C8B4] opacity-60'}`}>
                  <span className="mr-2 text-[11px] tracking-widest text-[#9A8D80]">PAGE {i + 1}</span>
                  {got ? <span className="font-serif text-[16px] italic leading-relaxed">{s.text}</span> : <span className="text-[13px]">📜 Still somewhere on the map…</span>}
                </div>
              )
            })}
          </div>
        </Modal>
      )}

      {panel === 'contact' && (
        <Modal title="Write me a letter" sub={`${ME.fullName} · ${ME.city}`} onClose={() => setPanel(null)}>
          <Contact />
        </Modal>
      )}

      {panel === 'beyond' && (
        <Modal title="Beyond the edge of the map" sub="Places the map doesn't show yet" onClose={() => setPanel(null)}>
          <Beyond />
        </Modal>
      )}

      {panel === 'help' && (
        <Modal title="How to play" sub="A portfolio you can walk through" onClose={() => setPanel(null)}>
          <ul className="space-y-2 text-[14px] leading-relaxed">
            <li>🚶 <b>Move</b> with arrow keys or WASD, or tap anywhere on the map.</li>
            <li>🏠 <b>Step inside</b> a building with <kbd className="rounded border px-1">E</kbd> or the button. Each one is an app Himanshu built.</li>
            <li>🛂 Each visit <b>stamps your passport</b>. The sky moves from dawn to night as it fills.</li>
            <li>☕ Collect <b>chai</b> and 📜 <b>story pages</b> along the way.</li>
            <li>⛵ The boat in the east sails after {BOAT_NEEDS} stamps.</li>
            <li>📄 In a hurry? <button className="underline" onClick={onReadMode}>Read mode</button> shows everything on one page.</li>
          </ul>
          <button className="mt-4 text-[12px] text-[#9A8D80] underline" onClick={() => { reset(); setPanel(null); location.reload() }}>
            Start over (clear my progress)
          </button>
        </Modal>
      )}

      {panel === 'finale' && (
        <>
          <Confetti />
          <Modal title="" onClose={() => setPanel(null)}>
            <div className="text-center">
              <div className="text-5xl">🌙</div>
              <GradientText colors={['#C97F6E', '#D9A84E', '#7FA277', '#C97F6E']} className="mt-2 font-serif text-3xl italic">
                You walked the whole little world
              </GradientText>
              <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed">
                Ten places, ten apps, one traveller. Night has fallen, the lighthouse is on, and you are now a <b>{RANKS[10]}</b>.
              </p>
              <p className="mt-1 text-[13px] text-[#8C7F73]">{xp} XP · ☕ {chai}/{CHAI.length} · 📜 {scrolls}/{SCROLLS.length}</p>
              <div className="mt-5"><Contact /></div>
            </div>
          </Modal>
        </>
      )}
    </div>
  )
}

function Modal({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="lw-fade fixed inset-0 z-50 flex items-end justify-center bg-[#3b332c]/45 p-3 backdrop-blur-[3px] sm:items-center" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="lw-paper lw-rise relative max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-3xl p-5 sm:p-7" role="dialog" aria-label={title}>
        <button onClick={onClose} className="lw-btn absolute right-3 top-3" aria-label="Close">✕</button>
        {title && <h2 className="pr-10 font-serif text-2xl italic">{title}</h2>}
        {sub && <p className="mb-4 mt-0.5 text-[12px] uppercase tracking-[0.16em] text-[#9A8D80]">{sub}</p>}
        {children}
      </div>
    </div>
  )
}

function PlaceModal({ place, fresh, count, onClose }: { place: Place; fresh: boolean; count: number; onClose: () => void }) {
  return (
    <div className="lw-fade fixed inset-0 z-50 flex items-end justify-center bg-[#3b332c]/45 p-3 backdrop-blur-[3px] sm:items-center" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="lw-paper lw-rise relative max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-3xl" role="dialog" aria-label={place.place}>
        <div className="relative overflow-hidden rounded-t-3xl px-6 pb-5 pt-7" style={{ background: `linear-gradient(135deg, ${place.color}66, ${place.color}22)` }}>
          <button onClick={onClose} className="lw-btn absolute right-3 top-3" aria-label="Close">✕</button>
          <div className="lw-bounce-in text-6xl">{place.emoji}</div>
          <h2 className="mt-2 font-serif text-[28px] italic leading-tight">{place.place}</h2>
          <div className="mt-1 text-[14px]">
            <b>{place.app}</b> <span className="text-[#8C7F73]">· {place.tagline}</span>
          </div>
          {fresh && (
            <div className="lw-stamp absolute right-14 top-10 rounded-lg border-[3px] border-[#C97F6E] px-3 py-1 text-center font-serif text-[#C97F6E]">
              <div className="text-[10px] tracking-[0.2em]">STAMPED</div>
              <div className="text-lg font-bold leading-none">{count}/10</div>
              <div className="text-[10px]">+100 XP</div>
            </div>
          )}
        </div>
        <div className="space-y-4 px-6 pb-6 pt-5">
          <p className="text-[15.5px] leading-relaxed">{place.story}</p>
          <div className="rounded-xl border border-[#E8DCCB] bg-white/60 px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[#9A8D80]">Why it exists</div>
            <div className="mt-0.5 font-serif text-[17px] italic">{place.why}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-[#9A8D80]">made with</span>
            {place.tech.map(t => (
              <span key={t} className="lw-slot">{t}</span>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 pt-1">
            {place.link && (
              <a href={place.link.href} target="_blank" rel="noreferrer" className="lw-cta">
                {place.link.label} →
              </a>
            )}
            <button onClick={onClose} className="lw-cta lw-cta-ghost">Back to the map</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Contact() {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className="max-w-md font-serif text-[17px] italic leading-relaxed">{ME.intro}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <a className="lw-cta" href={`mailto:${ME.email}`}>✉️ Write me a letter</a>
        <a className="lw-cta lw-cta-ghost" href={ME.instagram} target="_blank" rel="noreferrer">📷 Say hi on Instagram</a>
        <a className="lw-cta lw-cta-ghost" href={ME.github} target="_blank" rel="noreferrer">🐙 GitHub</a>
      </div>
      <ShinyText text="Always happy to talk about an idea over chai." className="text-[13px]" color="#9A8D80" shineColor="#5E544B" />
    </div>
  )
}

export function Beyond() {
  const row = (x: { emoji: string; name: string; text: string }) => (
    <li key={x.name} className="flex gap-3 rounded-xl border border-[#E8DCCB] bg-white/60 px-4 py-2.5">
      <span className="text-xl">{x.emoji}</span>
      <span>
        <b className="font-serif italic">{x.name}</b>
        <span className="block text-[13px] text-[#8C7F73]">{x.text}</span>
      </span>
    </li>
  )
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 font-serif text-[14px] italic text-[#8A6F5A]">Houses where I keep my portfolio</div>
        <ul className="space-y-2">{BEYOND.houses.map(row)}</ul>
      </div>
      <div>
        <div className="mb-2 font-serif text-[14px] italic text-[#8A6F5A]">Roads I'm still walking</div>
        <ul className="space-y-2">{BEYOND.roads.map(row)}</ul>
      </div>
    </div>
  )
}
