import { useState } from 'react'
import { CONFIGS, useMatch } from '../store'

export function StartScreen() {
  const start = useMatch((s) => s.start)
  const [configId, setConfigId] = useState(CONFIGS[0]!.id)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000))

  return (
    <main className="start">
      <h1>OrcBall</h1>
      <p className="lede">Hot-seat prototype. Orcs at home, Elves away.</p>
      <form
        className="start-form"
        onSubmit={(e) => {
          e.preventDefault()
          start(CONFIGS.find((c) => c.id === configId)!, seed)
        }}
      >
        <label>
          Rules
          <select id="config" value={configId} onChange={(e) => setConfigId(e.target.value)}>
            {CONFIGS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
              </option>
            ))}
          </select>
        </label>
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
