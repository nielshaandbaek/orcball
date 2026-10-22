import type { GameEvent } from '@orcball/engine'

// A first rough read on match length and dice from a batch of matches, in
// the PRD's terms: activations per match, rolls per activation, and the share
// of activations with no roll at all.

export type Report = {
  matches: number
  activations: { median: number; mean: number; min: number; max: number }
  rollsPerActivation: number
  zeroRollShare: number
  touchdownsPerMatch: number
}

export function summarise(matches: GameEvent[][]): Report {
  const perMatch: number[] = []
  let activations = 0
  let rolls = 0
  let zeroRoll = 0
  let touchdowns = 0
  for (const events of matches) {
    let count = 0
    let active = false
    let rollsThisActivation = 0
    for (const event of events) {
      if (event.type === 'activated') {
        count++
        active = true
        rollsThisActivation = 0
      } else if (event.type === 'rolled' && active) {
        rollsThisActivation++
        rolls++
      } else if (event.type === 'activationEnded' && active) {
        if (rollsThisActivation === 0) zeroRoll++
        active = false
      } else if (event.type === 'touchdown') {
        touchdowns++
      }
    }
    perMatch.push(count)
    activations += count
  }
  const sorted = [...perMatch].sort((a, b) => a - b)
  return {
    matches: matches.length,
    activations: {
      median: sorted[Math.floor(sorted.length / 2)] ?? 0,
      mean: activations / Math.max(matches.length, 1),
      min: sorted[0] ?? 0,
      max: sorted.at(-1) ?? 0,
    },
    rollsPerActivation: rolls / Math.max(activations, 1),
    zeroRollShare: zeroRoll / Math.max(activations, 1),
    touchdownsPerMatch: touchdowns / Math.max(matches.length, 1),
  }
}

export function formatReport(r: Report): string {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`
  return [
    `Random play: ${r.matches} matches`,
    `  activations per match: median ${r.activations.median}, mean ${r.activations.mean.toFixed(1)}, range ${r.activations.min}–${r.activations.max}`,
    `  rolls per activation:  ${r.rollsPerActivation.toFixed(2)}`,
    `  activations with no roll: ${pct(r.zeroRollShare)}`,
    `  touchdowns per match:  ${r.touchdownsPerMatch.toFixed(2)}`,
  ].join('\n')
}
