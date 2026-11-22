import type { TeamId } from '@orcball/engine'
import { ROUND_ACTIONS, teamBox } from '../teambox'
import { useMatch } from '../store'

/**
 * A team's block in the score bar (#253): its name, its Momentum, and in a
 * round the players it still has to activate (a dot each, the first a
 * lightning bolt while it can still Blitz, #172), its once-a-round actions
 * (crossed out once used) and a double activation. The team whose go it is
 * lights up; the other is faded. The away team's block mirrors the home one.
 */
export function TeamBlock({ team }: { team: TeamId }) {
  const game = useMatch((s) => s.game)!
  const computer = useMatch((s) => s.computer)
  const { name, momentum, momentumUsedThisRound } = game.teams[team]
  const box = teamBox(game, team)
  const momentumLabel = `${name} Momentum: ${momentum}${momentumUsedThisRound ? ' (used this round)' : ''}`
  return (
    <div
      className={`team-box ${team}${box?.onGo ? ' on-go' : ''}`}
      role="group"
      aria-label={box?.label ?? name}
      title={box?.label ?? name}
      data-on-go={box?.onGo ?? false}
      aria-current={box?.onGo ? 'true' : undefined}
    >
      <div className="team-head">
        {box?.onGo && <span className="go-mark">▶ Go</span>}
        <span className="team-name">{name}</span>
        {computer?.team === team && <span className="computer-tag">computer</span>}
        <span className={`momentum${momentumUsedThisRound ? ' used' : ''}`} role="img" aria-label={momentumLabel} title={momentumLabel} data-momentum={momentum}>
          <span className="token-coin" /> {momentum}
        </span>
        {box && box.double > 0 && (
          <span className="double" data-double={box.double}>
            double{box.double < 2 ? ' · 1 more' : ''}
          </span>
        )}
      </div>
      {box && (
        <div className="team-round">
          <span className="left-dots" data-left={box.left} data-blitz={box.blitz ? 'left' : 'used'}>
            {Array.from({ length: box.left }, (_, i) => (i === 0 && box.blitz ? <Bolt key={i} /> : <span key={i} className="dot" />))}
          </span>
          <span className="left-count">{box.left} left</span>
          <span className="round-actions">
            {ROUND_ACTIONS.map(({ key, label }) => (
              <span key={key} className={`round-action${box.free[key] ? '' : ' used'}`} data-action={key} data-free={box.free[key]} title={`${label} ${box.free[key] ? 'free this round' : 'used this round'}`}>
                {label}
              </span>
            ))}
          </span>
        </div>
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
