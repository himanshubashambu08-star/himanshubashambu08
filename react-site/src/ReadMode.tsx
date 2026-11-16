import FadeContent from '@/components/FadeContent/FadeContent'
import SpotlightCard from '@/components/SpotlightCard/SpotlightCard'
import Bento from './Bento'
import { Beyond, Contact } from './game/Game'
import { BACKPACK, PLACES, SCROLLS } from './game/data'

/** Everything in the game, on one plain scrolling page. */
export default function ReadMode({ onPlay }: { onPlay: () => void }) {
  return (
    <main className="min-h-screen bg-[#EEECE8] text-[#1E1C1A]">
      <div className="px-4 pt-8 sm:px-8 sm:pt-14">
        <div className="mx-auto mb-8 flex max-w-[1290px] flex-wrap items-center justify-between gap-3">
          <span className="font-display text-[28px] leading-none">himanshu</span>
          <button onClick={onPlay} className="lw-pill-dark">▶ Play the map instead</button>
        </div>
        <Bento />
      </div>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:py-16">
        <h2 className="mb-4 font-serif text-3xl italic">The places, one by one</h2>
        <FadeContent className="grid gap-4 sm:grid-cols-2" stagger={0.06}>
          {PLACES.map(p => (
            <SpotlightCard key={p.id} spotlightColor={`${p.color}88`} className="!rounded-2xl !border !border-[#E8DCCB] !bg-white/60 !p-5">
              <div className="text-3xl">{p.emoji}</div>
              <h3 className="mt-2 font-serif text-xl italic">{p.place}</h3>
              <div className="text-[13px]"><b>{p.app}</b> <span className="text-[#8C7F73]">· {p.tagline}</span></div>
              <p className="mt-2 text-[14.5px] leading-relaxed">{p.story}</p>
              <p className="mt-2 font-serif text-[15px] italic text-[#8A6F5A]">Why it exists: {p.why}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {p.tech.map(t => <span key={t} className="lw-slot">{t}</span>)}
              </div>
              {p.link && <a className="mt-3 inline-block text-[14px] underline" href={p.link.href} target="_blank" rel="noreferrer">{p.link.label} →</a>}
            </SpotlightCard>
          ))}
        </FadeContent>

        <h2 className="mb-4 mt-14 font-serif text-3xl italic">The traveller who built it</h2>
        <div className="space-y-3 font-serif text-lg italic leading-relaxed">
          {SCROLLS.map(s => <p key={s.id}>{s.text}</p>)}
        </div>

        <h2 className="mb-4 mt-14 font-serif text-3xl italic">In my backpack</h2>
        <div className="space-y-4">
          {BACKPACK.map(g => (
            <div key={g.title}>
              <div className="mb-1.5 font-serif text-[15px] italic text-[#8A6F5A]">{g.title}</div>
              <div className="flex flex-wrap gap-2">{g.items.map(i => <span key={i} className="lw-slot">{i}</span>)}</div>
            </div>
          ))}
        </div>

        <h2 className="mb-4 mt-14 font-serif text-3xl italic">Beyond the edge of the map</h2>
        <Beyond />

        <div className="mt-16 rounded-3xl border border-[#E8DCCB] bg-white/50 p-8">
          <Contact />
        </div>
      </div>
    </main>
  )
}
