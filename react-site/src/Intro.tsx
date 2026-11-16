import { useEffect, useState } from 'react'
import Aurora from '@/components/Aurora/Aurora'
import BlurText from '@/components/BlurText/BlurText'
import Magnet from '@/components/Magnet/Magnet'
import SplitText from '@/components/SplitText/SplitText'
import { IDLE_SVG } from './game/character'
import { ME, PLACES } from './game/data'

const PROMPT =
  "I'm visiting Himanshu's little world for the first time. Show me the ten apps he built, let me walk into each one, and stamp my passport on the way...."

/** Types the prompt out like a traveller writing a note. */
function useTyped(text: string, startDelay = 900, step = 22) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setN(text.length)
      return
    }
    let i = 0
    let timer = 0
    const start = window.setTimeout(() => {
      timer = window.setInterval(() => {
        i += 1
        setN(i)
        if (i >= text.length) clearInterval(timer)
      }, step)
    }, startDelay)
    return () => {
      clearTimeout(start)
      clearInterval(timer)
    }
  }, [text, startDelay, step])
  return text.slice(0, n)
}

export default function Intro({ onStart, onRead, hasSave }: { onStart: () => void; onRead: () => void; hasSave: boolean }) {
  const typed = useTyped(PROMPT)

  return (
    <section className="relative min-h-svh w-full overflow-hidden bg-[#FAF3E8] text-[#1a1a1a]">
      {/* Living background: the map itself, slowly drifting, under a soft aurora */}
      <img src={`${import.meta.env.BASE_URL}world.svg`} alt="" className="lw-drift pointer-events-none absolute left-1/2 top-[88%] z-0 w-[max(120vw,1500px)] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-90" />
      <div className="pointer-events-none absolute inset-0 z-0 opacity-45">
        <Aurora colorStops={['#F4B9A7', '#F4D58D', '#A9C2D6']} lightMode amplitude={1.1} speed={0.6} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-[687px]" style={{ background: 'linear-gradient(180deg, #FAF3E8 0%, #FAF3E8 62%, #FAF3E800 100%)' }} />

      <div className="relative z-[2] mx-auto max-w-[1360px]">
        <nav className="flex items-center justify-between px-6 pb-4 pt-5 md:px-20 md:pt-6">
          <span className="font-display select-none text-[30px] leading-none md:text-[38px]">himanshu</span>
          <div className="absolute left-1/2 flex -translate-x-1/2 gap-8 max-md:hidden">
            <button className="lw-navlink" onClick={onStart}>The map</button>
            <button className="lw-navlink" onClick={onRead}>The apps</button>
            <a className="lw-navlink" href={`mailto:${ME.email}`}>Write to me</a>
          </div>
          <div className="flex items-center gap-6">
            <button className="lw-navlink max-md:hidden" onClick={onRead}>Just read</button>
            <button className="lw-pill-dark" onClick={onStart}>Play</button>
          </div>
        </nav>

        <div className="flex flex-col items-center px-6 pb-24 pt-8 text-center md:pt-12">
          <svg viewBox="-16 -40 32 44" className="lw-bob mb-1 h-20 w-16" aria-hidden>
            <g dangerouslySetInnerHTML={{ __html: IDLE_SVG }} />
          </svg>
          <p className="mb-3 text-[12px] font-medium uppercase tracking-[0.28em] text-[#767676]">A playable portfolio · {ME.city}</p>
          <SplitText text="Where will you wander first?" tag="h1" trigger="load" className="mb-5 max-w-[820px] text-[clamp(40px,6vw,68px)] font-medium leading-[1.05] tracking-[-0.04em]" />
          <BlurText text={ME.intro} className="mb-10 max-w-[560px] justify-center text-lg font-medium leading-relaxed text-[#767676] md:text-xl" delay={35} />

          <div className="lw-glass relative min-h-[208px] w-[701px] overflow-hidden text-left max-md:w-[calc(100vw-48px)]">
            <p className="lw-caret min-h-[110px] px-[29px] pt-[26px] text-[17px] font-medium leading-relaxed text-[#905831] md:text-xl">{typed}</p>
            <div className="flex items-center justify-between gap-3 px-[21px] pb-[21px] max-sm:justify-end">
              <div className="flex gap-1.5 text-xl max-sm:hidden" aria-hidden>
                {PLACES.slice(0, 6).map((p, i) => (
                  <span key={p.id} className="lw-float inline-block" style={{ animationDelay: `${i * 0.18}s` }}>{p.emoji}</span>
                ))}
              </div>
              <Magnet padding={40} magnetStrength={3}>
                <button onClick={onStart} className="lw-pill-dark !px-7 !py-4 !text-base">
                  {hasSave ? 'Continue the journey' : 'Start the journey'}
                </button>
              </Magnet>
            </div>
          </div>

          <button onClick={onRead} className="lw-navlink mt-6 underline underline-offset-4">In a hurry? Read it on one page</button>
          <p className="mt-3 text-[12px] tracking-wide text-[#767676]">10 places · 10 apps I built · collect stamps, watch the day turn to night</p>
        </div>
      </div>
    </section>
  )
}
