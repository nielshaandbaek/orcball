import type { RollPreview } from '@orcball/engine'

/** "Dodge 6+ · 1 extra tackle zone −1 · 40%" */
export function rollSummary(p: RollPreview): string {
  const mods = p.modifiers.map((m) => `${m.name} ${m.value > 0 ? '+' : '−'}${Math.abs(m.value)}`)
  return [`${p.test} ${p.target}+`, ...mods, `${Math.round(p.chance * 100)}%`].join(' · ')
}
