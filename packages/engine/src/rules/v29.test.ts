import { describe, expect, it } from 'vitest'
import { rulesV28, rulesV29 } from '../config'

// Rules v29: v28 with nimbler Dwarf Blockers, AG 7+ instead of 8+.

describe('rules v29 config', () => {
  it('is v28 with the Dwarf Blockers at AG 7+, and v28 is unchanged', () => {
    const { id: _a, rosters: r29, ...rest29 } = rulesV29
    const { id: _b, rosters: r28, ...rest28 } = rulesV28
    expect(rulesV29.id).toBe('rules-v29')
    expect(rest29).toEqual(rest28)
    const { dwarves: d29, ...others29 } = r29
    const { dwarves: d28, ...others28 } = r28
    expect(others29).toEqual(others28)
    expect(d28!.positions.blocker!.ag).toBe(8)
    expect(d29!.positions.blocker!.ag).toBe(7)
    expect({ ...d29!, positions: { ...d29!.positions, blocker: { ...d29!.positions.blocker!, ag: 8 } } }).toEqual(d28)
  })
})
