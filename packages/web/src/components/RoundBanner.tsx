import { useMatch } from '../store'

/**
 * The new round's number over the board for a moment, in the colour of the
 * team with the initiative (#81), so a round change isn't missed. It ignores
 * taps, so the board stays usable, and clears itself when its fade ends.
 */
export function RoundBanner() {
  const banner = useMatch((s) => s.banner)
  const game = useMatch((s) => s.game)
  const clear = useMatch((s) => s.clearBanner)
  if (!banner || !game) return null
  return (
    <div key={banner.id} className={`round-banner ${banner.team}`} role="status" data-round-banner onAnimationEnd={() => clear(banner.id)}>
      <div className="title">{banner.round === 1 ? `Half ${banner.half} · Round 1` : `Round ${banner.round}`}</div>
      <div className="sub">{game.teams[banner.team].name} go first</div>
    </div>
  )
}
