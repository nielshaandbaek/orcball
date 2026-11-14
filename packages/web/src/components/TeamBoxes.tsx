import type { TeamId } from '@orcball/engine'
import { useMatch } from '../store'
import { teamBox } from '../teambox'

/**
 * Each team's round under the board, below the log (#178): its name, a dot
 * per player it still has to activate (the first a lightning bolt while it
 * can still Blitz, #172) and a double activation it has. The team whose go it
 * is in full colour, the other faded. Nothing outside a round.
 */
export function TeamBoxes() {
  const game = useMatch((s) => s.game)!
  if (!teamBox(game, 'home')) return null
  return (
    <div className="team-boxes">
      <Box team="home" />
      <Box team="away" />
    </div>
  )
}

function Box({ team }: { team: TeamId }) {
  const box = teamBox(useMatch((s) => s.game!), team)!
  return (
    <div className={`team-box ${team}${box.onGo ? ' on-go' : ''}`} role="group" aria-label={box.label} title={box.label} data-on-go={box.onGo} aria-current={box.onGo ? 'true' : undefined}>
      <span className="team-name">{box.name}</span>
      <span className="left-dots" data-left={box.left} data-blitz={box.blitz ? 'left' : 'used'}>
        {Array.from({ length: box.left }, (_, i) => (i === 0 && box.blitz ? <Bolt key={i} /> : <span key={i} className="dot" />))}
      </span>
      {box.double > 0 && (
        <span className="double" data-double={box.double}>
          double{box.double < 2 ? ' · 1 more' : ''}
        </span>
      )}
    </div>
  )
}

/** The Blitz as a lightning bolt the size of a dot, in the team's colour (#172). */
function Bolt() {
  return (
    <svg className="bolt" viewBox="0 0 10 14" aria-hidden="true">
      <path d="M6.2 0.6 L1.2 8 H4.6 L3.4 13.4 L8.8 5.6 H5.3 Z" />
    </svg>
  )
}
