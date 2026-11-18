import type { AiLevel } from '@orcball/ai'
import type { TeamId } from '@orcball/engine'
import { useRef, useState } from 'react'
import { CONFIG_LABELS, CONFIGS, LEVEL_LABELS, useMatch } from '../store'
import { FullscreenButton } from './FullscreenButton'

type Opponent = 'human' | AiLevel
type ComputerSide = 'random' | TeamId

export function StartScreen() {
  const start = useMatch((s) => s.start)
  const importJson = useMatch((s) => s.importJson)
  // Why a replay couldn't be loaded: shown under its button.
  const message = useMatch((s) => s.message)
  const picker = useRef<HTMLInputElement>(null)
  const [configId, setConfigId] = useState(CONFIGS[0]!.id)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000))
  const [opponent, setOpponent] = useState<Opponent>('human')
  const [side, setSide] = useState<ComputerSide>('random')

  return (
    <main className="start">
      <div className="start-head">
        <h1>OrcBall</h1>
        <FullscreenButton />
      </div>
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
      {/* A match file from Export match or the long runs, to step through (#188). */}
      <div className="start-replay">
        <button type="button" id="load-replay" onClick={() => picker.current?.click()}>
          Load replay
        </button>
        <input
          ref={picker}
          id="replay-file"
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const chosen = e.target.files?.[0]
            if (chosen) importJson(await chosen.text())
            e.target.value = ''
          }}
        />
        {message && (
          <p className="message" role="status">
            {message}
          </p>
        )}
      </div>
    </main>
  )
}
