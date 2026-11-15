import Aurora from '@/components/Aurora/Aurora'
import BlurText from '@/components/BlurText/BlurText'
import ClickSpark from '@/components/ClickSpark/ClickSpark'
import Dock from '@/components/Dock/Dock'
import FadeContent from '@/components/FadeContent/FadeContent'
import GradientText from '@/components/GradientText/GradientText'
import Magnet from '@/components/Magnet/Magnet'
import ShinyText from '@/components/ShinyText/ShinyText'
import SplitText from '@/components/SplitText/SplitText'
import SpotlightCard from '@/components/SpotlightCard/SpotlightCard'

export default function App() {
  return (
    <ClickSpark sparkColor="#fff">
      <main className="relative min-h-screen overflow-hidden bg-neutral-950 text-neutral-100">
        <div className="absolute inset-0 opacity-70">
          <Aurora colorStops={['#5227FF', '#7cff67', '#5227FF']} />
        </div>

        <section className="relative z-10 mx-auto flex max-w-4xl flex-col items-center gap-8 px-4 py-24 text-center">
          <SplitText
            text="Hello, traveller"
            tag="h1"
            className="text-5xl font-semibold sm:text-6xl"
            trigger="load"
          />
          <BlurText
            text="React Bits is installed. Click anywhere for sparks."
            className="justify-center text-lg text-neutral-300"
          />
          <GradientText className="text-2xl font-medium">Small, quiet apps</GradientText>
          <ShinyText text="Text · Backgrounds · Components · Animations" className="text-sm" />

          <FadeContent className="grid w-full gap-4 sm:grid-cols-2">
            <SpotlightCard className="rounded-2xl border border-neutral-800 bg-neutral-900/80 p-6 text-left">
              <h2 className="mb-2 text-xl font-medium">SpotlightCard</h2>
              <p className="text-neutral-400">Move your pointer over this card.</p>
            </SpotlightCard>
            <Magnet>
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/80 p-6 text-left">
                <h2 className="mb-2 text-xl font-medium">Magnet</h2>
                <p className="text-neutral-400">This card follows your pointer.</p>
              </div>
            </Magnet>
          </FadeContent>
        </section>

        <Dock
          items={[
            { icon: '🏡', label: 'Home' },
            { icon: '🧺', label: 'Garden' },
            { icon: '⛽', label: 'Receipts' },
            { icon: '✉️', label: 'Letter' },
          ]}
        />
      </main>
    </ClickSpark>
  )
}
