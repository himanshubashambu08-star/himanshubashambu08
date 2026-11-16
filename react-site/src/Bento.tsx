import { useEffect, useRef, useState } from 'react'
import { IDLE_SVG } from './game/character'
import { BACKPACK, BEYOND, ME, PLACES } from './game/data'

// Everything here is taken from the profile README; nothing is invented.
const ROAD = [
  { title: 'Bookkeeper', note: 'six years' },
  { title: 'Books kept tidy', note: '50+ clients' },
  { title: 'Learned to build', note: 'slowly, then every day' },
  { title: 'Little helpers for small businesses', note: 'now' },
  { title: 'Ten apps on the map', note: 'and counting' },
]

function Chip({ icon, children }: { icon: string; children: string }) {
  return (
    <span className="lw-chip">
      <span aria-hidden>{icon}</span>
      {children}
    </span>
  )
}

/** Auto-advancing spotlight over the ten apps, with a sliding segmented control. */
function Built() {
  const [i, setI] = useState(0)
  const hold = useRef(0)
  useEffect(() => {
    const t = setInterval(() => {
      if (Date.now() < hold.current) return
      setI(v => (v + 1) % PLACES.length)
    }, 2400)
    return () => clearInterval(t)
  }, [])
  const p = PLACES[i]
  return (
    <div className="flex h-full flex-col p-5">
      <Chip icon="🧭">What I've built</Chip>
      <div key={p.id} className="lw-swap mt-4 flex-1">
        <div className="flex items-center gap-3">
          <span className="text-4xl">{p.emoji}</span>
          <div>
            <div className="text-[26px] font-medium leading-tight tracking-[-0.02em]">{p.app}</div>
            <div className="text-[14px] text-[#77736E]">{p.place} · {p.tagline}</div>
          </div>
        </div>
        <p className="mt-3 text-[15px] leading-relaxed text-[#1E1C1A]">{p.why}</p>
      </div>
      <div className="mt-3 flex h-10 items-center gap-1 rounded-full bg-[#E9E6E1] p-1">
        {PLACES.map((x, k) => (
          <button
            key={x.id}
            aria-label={x.app}
            onClick={() => {
              hold.current = Date.now() + 6000
              setI(k)
            }}
            className={`h-full flex-1 rounded-full text-[12px] font-medium transition-all duration-[420ms] ${k === i ? 'bg-[#2A2624] text-white' : 'text-[#77736E] hover:text-[#1E1C1A]'}`}
          >
            {String(k + 1).padStart(2, '0')}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function Bento() {
  return (
    <div className="mx-auto max-w-[1290px]">
      {/* Intro */}
      <div className="flex flex-col gap-6 md:flex-row md:gap-10">
        <div className="lw-enter grid h-[145px] w-[145px] shrink-0 place-items-end overflow-hidden rounded-[11px] bg-[#EE6A1F]">
          <svg viewBox="-13 -40 26 38" className="h-[128px] w-full" aria-label="The traveller">
            <g dangerouslySetInnerHTML={{ __html: IDLE_SVG }} />
          </svg>
        </div>
        <div className="max-w-[900px]">
          <h1 className="lw-enter text-[30px] font-medium leading-[1.17] tracking-[-0.021em] md:text-[39.5px]" style={{ animationDelay: '80ms' }}>
            Hi I'm {ME.name} — I build small, quiet apps for small businesses.
            <span className="text-[#A7A39D]"> Previously a bookkeeper for six years.</span>
          </h1>
          <p className="lw-enter mt-4 max-w-[790px] text-[18px] leading-[1.5] text-[#77736E] md:text-[20.5px]" style={{ animationDelay: '160ms' }}>
            I watched good, hardworking people lose hours every week to the same small, boring tasks. So I learned to build things that quietly make the day lighter.
          </p>
          <div className="lw-enter mt-6 flex flex-wrap gap-3" style={{ animationDelay: '240ms' }}>
            <a href={`mailto:${ME.email}`} className="flex h-[53px] items-center gap-3 rounded-full border border-black/[0.07] bg-white/70 pl-3 pr-5 text-[15px] font-medium transition hover:bg-white">
              <span className="grid h-[29px] w-[29px] place-items-center rounded-full bg-[#EE6A1F] text-[13px] text-white">✉</span>
              Write me a letter
            </a>
            <span className="flex h-[53px] items-center gap-3 rounded-full border border-black/[0.07] bg-white/70 px-5 text-[15px] font-medium">
              <span className="lw-halo" />
              Happy to talk over chai
            </span>
          </div>
        </div>
      </div>

      {/* Bento grid */}
      <div className="mt-10 grid gap-[17px] md:grid-cols-12">
        <div className="lw-bento lw-enter h-[258px] md:col-span-4" style={{ animationDelay: '320ms' }}>
          <div className="absolute left-5 top-5 z-10"><Chip icon="🥾">The road so far</Chip></div>
          <div className="lw-mask-y absolute inset-x-0 bottom-0 top-12 overflow-hidden px-7">
            <ul className="lw-drift-up relative border-l-[1.5px] border-[#1E1C1A] pl-5">
              {[...ROAD, ...ROAD].map((r, k) => (
                <li key={k} className="relative pb-6">
                  <span className="absolute -left-[25.5px] top-1.5 h-[8.5px] w-[8.5px] rounded-full bg-[#1E1C1A]" />
                  <div className="text-[15.5px] font-medium">{r.title}</div>
                  <div className="text-[13.5px] text-[#A7A39D]">{r.note}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="lw-bento lw-enter min-h-[258px] md:col-span-5" style={{ animationDelay: '400ms' }}>
          <Built />
        </div>

        <div className="lw-bento lw-enter flex h-[258px] flex-col p-5 md:col-span-3" style={{ animationDelay: '480ms' }}>
          <Chip icon="💬">I speak</Chip>
          <div className="mt-auto space-y-1 text-[25.5px] font-medium leading-[1.35] tracking-[-0.01em]">
            <div>English</div>
            <div>हिंदी</div>
            <div>ਪੰਜਾਬੀ</div>
          </div>
        </div>

        <div className="lw-bento lw-enter h-[242px] md:col-span-4" style={{ animationDelay: '560ms' }}>
          <div className="absolute inset-[11px] overflow-hidden rounded-[9px] bg-[#FAF3E8]">
            <img src={`${import.meta.env.BASE_URL}world.svg`} alt="The map of the little world" className="h-full w-full object-cover opacity-80" />
            <div className="absolute inset-0 grid place-items-center text-[27px] font-medium text-[#77736E]">{ME.city}</div>
          </div>
          <div className="absolute bottom-5 left-5"><Chip icon="📍">Map</Chip></div>
        </div>

        <div className="lw-bento lw-enter flex h-[242px] flex-col p-5 md:col-span-3" style={{ animationDelay: '640ms' }}>
          <Chip icon="🛤️">Roads I'm still walking</Chip>
          <ul className="mt-auto space-y-2">
            {BEYOND.roads.map(r => (
              <li key={r.name} className="flex items-baseline gap-2 text-[15px]">
                <span>{r.emoji}</span>
                <span><b className="font-medium">{r.name}</b> <span className="text-[13px] text-[#77736E]">· {r.text}</span></span>
              </li>
            ))}
          </ul>
        </div>

        <div className="lw-bento lw-enter flex min-h-[242px] flex-col p-5 md:col-span-5" style={{ animationDelay: '720ms' }}>
          <Chip icon="🎒">In my backpack</Chip>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {BACKPACK.flatMap(g => g.items).map(it => (
              <span key={it} className="rounded-full border border-black/[0.07] bg-white/70 px-2.5 py-1 text-[12.5px] transition hover:-translate-y-0.5 hover:bg-[#EE6A1F] hover:text-white">{it}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
