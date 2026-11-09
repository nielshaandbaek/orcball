import type { ReactNode } from 'react'
import { useMatch } from '../store'

/**
 * A button that, when it isn't allowed, is greyed out with the reason as its
 * tooltip instead of a line of text under it (the bar stays one size). Touch
 * screens have no tooltips, so tapping it greyed out puts the reason in the
 * message line instead.
 */
export function ReasonButton({
  reason,
  onClick,
  className,
  id,
  title,
  children,
}: {
  /** Why it isn't allowed, or null when it is. */
  reason: string | null | undefined
  onClick: () => void
  className?: string
  id?: string
  /** The tooltip when it is allowed. */
  title?: string
  children: ReactNode
}) {
  const off = reason != null
  return (
    <button
      type="button"
      id={id}
      className={`${className ?? ''}${off ? ' off' : ''}`.trim() || undefined}
      aria-disabled={off || undefined}
      title={off ? reason : title}
      data-reason={off ? reason : undefined}
      onClick={() => (off ? useMatch.setState({ message: reason }) : onClick())}
    >
      {children}
    </button>
  )
}
