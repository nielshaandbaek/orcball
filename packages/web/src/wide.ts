import { useEffect, useState } from 'react'

/**
 * When the match fills the window, the board over a bar (#128): wider than
 * 900px, or a phone in landscape (#258), where everything has to fit on one
 * screen. Matches styles.css.
 */
export const WIDE_QUERY = '(min-width: 901px), (orientation: landscape) and (max-height: 500px)'

/** Whether the window is wide (the board over a bar), following resizes. */
export function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY)
    const onChange = () => setWide(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return wide
}
