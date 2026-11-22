// PROTOTYPE (#253), throwaway: the floating bar that switches the match
// screen's layout. ?variant= in the URL; ← and → cycle. Dev builds only.
import { useEffect, useState } from 'react'

export const VARIANTS = [
  { key: 'A', name: 'Now' },
  { key: 'B', name: 'Team bar' },
  { key: 'C', name: 'Side columns' },
  { key: 'D', name: 'Turn strip' },
  { key: 'E', name: 'Team bar, one row' },
] as const
export type VariantKey = (typeof VARIANTS)[number]['key']

function read(): VariantKey {
  const v = new URLSearchParams(location.search).get('variant')?.toUpperCase()
  return VARIANTS.some((x) => x.key === v) ? (v as VariantKey) : 'A'
}

export function useVariant(): VariantKey {
  const [variant, setVariant] = useState<VariantKey>(read)
  useEffect(() => {
    const on = () => setVariant(read())
    window.addEventListener('p253-variant', on)
    window.addEventListener('popstate', on)
    return () => {
      window.removeEventListener('p253-variant', on)
      window.removeEventListener('popstate', on)
    }
  }, [])
  return variant
}

function go(step: number) {
  const i = VARIANTS.findIndex((x) => x.key === read())
  const next = VARIANTS[(i + step + VARIANTS.length) % VARIANTS.length]!.key
  const url = new URL(location.href)
  url.searchParams.set('variant', next)
  history.replaceState(null, '', url)
  window.dispatchEvent(new Event('p253-variant'))
}

export function Switcher() {
  const variant = useVariant()
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  if (!import.meta.env.DEV) return null
  const name = VARIANTS.find((x) => x.key === variant)!.name
  return (
    <div className="p253-switcher" role="toolbar" aria-label="Prototype layouts">
      <button type="button" onClick={() => go(-1)} aria-label="Previous layout">
        ←
      </button>
      <span>
        {variant} ({name})
      </span>
      <button type="button" onClick={() => go(1)} aria-label="Next layout">
        →
      </button>
    </div>
  )
}
