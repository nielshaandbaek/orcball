import { useEffect, useState } from 'react'

/** The width above which the match fills the window, the board over a bar (#128). Matches styles.css. */
export const WIDE_QUERY = '(min-width: 901px)'

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
