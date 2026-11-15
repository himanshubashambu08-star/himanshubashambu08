import Aurora from '@/components/Aurora/Aurora'
import BlurText from '@/components/BlurText/BlurText'
import Magnet from '@/components/Magnet/Magnet'
import ShinyText from '@/components/ShinyText/ShinyText'
import SplitText from '@/components/SplitText/SplitText'
import { IDLE_SVG } from './game/character'
import { ME, PLACES } from './game/data'

export default function Intro({ onStart, onRead, hasSave }: { onStart: () => void; onRead: () => void; hasSave: boolean }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#FAF3E8] px-4 py-16 text-center text-[#5E544B]">
      <div className="absolute inset-0 opacity-60">
        <Aurora colorStops={['#F4B9A7', '#F4D58D', '#A9C2D6']} lightMode amplitude={1.1} speed={0.6} />
      </div>
      <img src={`${import.meta.env.BASE_URL}world.svg`} alt="" className="lw-drift pointer-events-none absolute left-1/2 top-1/2 w-[160vmax] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-[0.16] blur-[1px]" />

      <div className="relative z-10 flex max-w-3xl flex-col items-center">
        <svg viewBox="-16 -40 32 44" className="lw-bob mb-2 h-24 w-20" aria-hidden>
          <g dangerouslySetInnerHTML={{ __html: IDLE_SVG }} />
        </svg>
        <ShinyText text={`A PLAYABLE PORTFOLIO · ${ME.city.toUpperCase()}`} className="text-[12px] tracking-[0.28em]" color="#9A8D80" shineColor="#5E544B" />
        <SplitText text="Himanshu's Little World" tag="h1" trigger="load" className="mt-3 font-serif text-[44px] italic leading-[1.05] sm:text-7xl" />
        <BlurText text={ME.intro} className="mt-5 max-w-xl justify-center font-serif text-lg italic leading-relaxed text-[#6B635B]" delay={40} />

        <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
          <Magnet padding={50} magnetStrength={3}>
            <button onClick={onStart} className="lw-start">
              ▶ {hasSave ? 'Continue the journey' : 'Start the journey'}
            </button>
          </Magnet>
          <button onClick={onRead} className="lw-cta lw-cta-ghost">Just read it (no game)</button>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-2 text-2xl">
          {PLACES.map((p, i) => (
            <span key={p.id} title={p.place} className="lw-float inline-block" style={{ animationDelay: `${i * 0.18}s` }}>
              {p.emoji}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[12px] tracking-wide text-[#9A8D80]">10 places · 10 apps I built · walk in, collect stamps, watch the day turn to night</p>
      </div>
    </main>
  )
}
