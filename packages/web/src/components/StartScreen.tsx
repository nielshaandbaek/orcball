import type { AiLevel } from '@orcball/ai'
import type { TeamId } from '@orcball/engine'
import { useState } from 'react'
import { CONFIG_LABELS, CONFIGS, LEVEL_LABELS, useMatch } from '../store'

type Opponent = 'human' | AiLevel
type ComputerSide = 'random' | TeamId

export function StartScreen() {
  const start = useMatch((s) => s.start)
  const [configId, setConfigId] = useState(CONFIGS[0]!.id)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000))
  const [opponent, setOpponent] = useState<Opponent>('human')
  const [side, setSide] = useState<ComputerSide>('random')

  return (
    <main className="start">
      <h1>OrcBall</h1>
      <p className="lede">Orcs at home, Elves away. Play hot-seat, or against the computer.</p>
      <form
        className="start-form"
        onSubmit={(e) => {
          e.preventDefault()
          const team: TeamId = side === 'random' ? (Math.random() < 0.5 ? 'home' : 'away') : side
          start(CONFIGS.find((c) => c.id === configId)!, seed, opponent === 'human' ? null : { team, level: opponent })
        }}
      >
        <label>
          Rules
          <select id="config" value={configId} onChange={(e) => setConfigId(e.target.value)}>
            {CONFIGS.map((c) => (
              <option key={c.id} value={c.id}>
                {CONFIG_LABELS[c.id] ?? c.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Opponent
          <select id="opponent" value={opponent} onChange={(e) => setOpponent(e.target.value as Opponent)}>
            <option value="human">Human (hot-seat)</option>
            {(Object.keys(LEVEL_LABELS) as AiLevel[]).map((level) => (
              <option key={level} value={level}>
                Computer: {LEVEL_LABELS[level]}
              </option>
            ))}
          </select>
        </label>
        {opponent !== 'human' && (
          <label>
            Computer plays
            <select id="computer-team" value={side} onChange={(e) => setSide(e.target.value as ComputerSide)}>
              <option value="random">Random team</option>
              <option value="home">Orcs (home)</option>
              <option value="away">Elves (away)</option>
            </select>
          </label>
        )}
        <label>
          Seed
          <input id="seed" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
        </label>
        <button type="submit" className="primary">
          Start match
        </button>
      </form>
    </main>
  )
}
