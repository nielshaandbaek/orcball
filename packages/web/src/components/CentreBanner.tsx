import { useEffect, useState } from 'react'
import { useMatch } from '../store'

/**
 * The middle of the part of the page that can be seen: with the page zoomed
 * in (pinched on a phone), that's not the middle of the board (#126).
 * In layout-viewport coordinates, for position: fixed.
 */
export function useVisibleCentre(): { left: number; top: number } {
  const measure = () => {
    const v = window.visualViewport
    return v ? { left: v.offsetLeft + v.width / 2, top: v.offsetTop + v.height / 2 } : { left: window.innerWidth / 2, top: window.innerHeight / 2 }
  }
  const [centre, setCentre] = useState(measure)
  useEffect(() => {
    const update = () => setCentre(measure())
    const v = window.visualViewport
    v?.addEventListener('resize', update)
    v?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      v?.removeEventListener('resize', update)
      v?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  return centre
}

/**
 * A big moment in the middle of the screen for a moment (#126): a
 * touchdown with the score, a touchback (#137), a casualty, an interception, a double activation gained, the
 * computer's Wait (held longer, #136). Like the round banner it ignores taps and clears itself;
 * all but the end of the match, which stays until tapped (#137).
 */
export function CentreBanner() {
  const notice = useMatch((s) => s.notice)
  const clear = useMatch((s) => s.clearNotice)
  const round = useMatch((s) => s.banner)
  const quit = useMatch((s) => s.quit)
  const { left, top } = useVisibleCentre()
  if (!notice) return null
  // Above the round banner when both show.
  const style = { left: `${left}px`, top: round ? `calc(${top}px - 5.5rem)` : `${top}px` }
  const team = notice.team ?? 'draw'
  if (notice.final) {
    // The end of the match (#137): stays until tapped, with a New match button.
    return (
      <div key={notice.id} className={`round-banner centre-banner final ${team}`} style={style} role="dialog" aria-label={notice.title} data-centre-banner="final">
        <button type="button" className="dismiss" onClick={() => clear(notice.id)} aria-label="Close">
          <div className="title">{notice.title}</div>
          <div className="sub">{notice.sub}</div>
          {notice.score && <div className="score">{notice.score}</div>}
        </button>
        <button type="button" className="primary" onClick={quit}>
          New match
        </button>
      </div>
    )
  }
  return (
    <div key={notice.id} className={`round-banner centre-banner ${team}${notice.long ? ' long' : ''}`} style={style} role="status" data-centre-banner onAnimationEnd={() => clear(notice.id)}>
      <div className="title">{notice.title}</div>
      <div className="sub">{notice.sub}</div>
      {notice.score && <div className="score">{notice.score}</div>}
    </div>
  )
}
