import { useState } from 'react'
import ClickSpark from '@/components/ClickSpark/ClickSpark'
import Game from './game/Game'
import Intro from './Intro'
import ReadMode from './ReadMode'

type Screen = 'intro' | 'game' | 'read'

function hasSave() {
  try {
    const raw = localStorage.getItem('little-world-progress-v1')
    return !!raw && (JSON.parse(raw).visited?.length ?? 0) > 0
  } catch {
    return false
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => (location.hash === '#read' ? 'read' : location.hash === '#play' ? 'game' : 'intro'))
  const go = (s: Screen) => {
    history.replaceState(null, '', s === 'read' ? '#read' : s === 'game' ? '#play' : '#')
    setScreen(s)
  }

  return (
    <ClickSpark sparkColor="#C97F6E" sparkCount={10} sparkRadius={22}>
      {screen === 'intro' && <Intro onStart={() => go('game')} onRead={() => go('read')} hasSave={hasSave()} />}
      {screen === 'game' && <Game onReadMode={() => go('read')} />}
      {screen === 'read' && <ReadMode onPlay={() => go('game')} />}
    </ClickSpark>
  )
}
