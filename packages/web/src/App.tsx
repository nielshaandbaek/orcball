import { MatchScreen } from './components/MatchScreen'
import { StartScreen } from './components/StartScreen'
import { useMatch } from './store'

export function App() {
  const screen = useMatch((s) => s.screen)
  return screen === 'start' ? <StartScreen /> : <MatchScreen />
}
