import { useMatch } from '../store'
import { useVisibleCentre } from './CentreBanner'

/**
 * The new round's number over the board for a moment, in the colour of the
 * team with the initiative (#81), so a round change isn't missed. It ignores
 * taps, so the board stays usable, and clears itself when its fade ends.
 */
export function RoundBanner() {
  const banner = useMatch((s) => s.banner)
  const game = useMatch((s) => s.game)
  const clear = useMatch((s) => s.clearBanner)
  // In the middle of what can be seen, even zoomed in (#126).
  const { left, top } = useVisibleCentre()
  if (!banner || !game) return null
  return (
    <div
      key={banner.id}
      className={`round-banner ${banner.team}`}
      style={{ left: `${left}px`, top: `${top}px` }}
      role="status"
      data-round-banner
      onAnimationEnd={() => clear(banner.id)}
    >
      {/* A match of one run of rounds (v20, #135) has no halves to name. */}
      <div className="title">{banner.round === 1 && game.config.match.halves > 1 ? `Half ${banner.half} · Round 1` : `Round ${banner.round}`}</div>
      <div className="sub">{game.teams[banner.team].name} go first</div>
    </div>
  )
}
