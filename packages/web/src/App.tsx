import { useEffect } from 'react'
import { MatchScreen } from './components/MatchScreen'
import { StartScreen } from './components/StartScreen'
import { useMatch } from './store'

export function App() {
  const screen = useMatch((s) => s.screen)
  const restore = useMatch((s) => s.restore)

  // Pick up the match in progress, if a reload interrupted one.
  useEffect(() => {
    void restore()
  }, [restore])

  if (screen === 'loading') return <p className="loading">Loading…</p>
  return screen === 'start' ? <StartScreen /> : <MatchScreen />
}
