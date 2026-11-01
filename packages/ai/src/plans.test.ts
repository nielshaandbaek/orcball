import { apply, createMatch, distance, endZoneOf, type GameState, legalCommands, rollDie, type RngState, rulesV12, seededRng } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { generatePlans, nextStep, startCursor } from './plans'
import { Search } from './search'
import { elves, h, orcs, scene } from './test-helpers'
import { type AiView, simulate, simulateOutcome, viewOf } from './view'

const BLITZER = 'home-blitzer-1' // MA 6
const THROWER = 'home-thrower-1'
const ELF = 'away-lineman-1'
const ELF_CATCHER = 'away-catcher-1'

const plansOf = (state: GameState, playerId: string) => generatePlans(viewOf(state)).filter((p) => p.playerId === playerId)

describe('generatePlans', () => {
  it('gives a carrier next to the end zone a plan that scores', () => {
    // Home scores in the right end zone: column 18 of a long row.
    const state = scene({ [BLITZER]: { col: 17, row: 5 }, [ELF]: { col: 3, row: 3 } }, { carrier: BLITZER })
    const scoring = plansOf(state, BLITZER).filter((p) => p.path.length > 0 && endZoneOf(p.path.at(-1)!) === 'right')
    expect(scoring.length).toBeGreaterThan(0)
  })

  it('gives a Blitzer near the carrier a Blitz on him', () => {
    const state = scene({ [BLITZER]: { col: 8, row: 5 }, [ELF_CATCHER]: { col: 11, row: 5 } }, { carrier: ELF_CATCHER })
    const blitzes = plansOf(state, BLITZER).filter((p) => p.action === 'blitz' && p.final?.type === 'block' && p.final.targetId === ELF_CATCHER)
    expect(blitzes.length).toBeGreaterThan(0)
    // The approach ends next to the carrier.
    expect(distance(blitzes[0]!.path.at(-1)!, h(11, 5))).toBe(1)
  })

  it('gives a thrower with an open team-mate a pass to him', () => {
    const state = scene({ [THROWER]: { col: 5, row: 5 }, [BLITZER]: { col: 10, row: 5 }, [ELF]: { col: 15, row: 2 } }, { carrier: THROWER })
    const passes = plansOf(state, THROWER).filter((p) => p.final?.type === 'pass')
    expect(passes.map((p) => p.final)).toContainEqual({ type: 'pass', target: h(10, 5) })
  })

  it('gives a stunned player only his turn face up', () => {
    const state = scene({ [BLITZER]: { col: 8, row: 5, status: 'stunned' }, [ELF]: { col: 12, row: 5 } })
    expect(plansOf(state, BLITZER).map((p) => p.label)).toEqual([`${BLITZER} turns face up`])
  })

  it('mid-activation, offers only the active player, and stopping', () => {
    const state = apply(scene({ [BLITZER]: { col: 8, row: 5 }, [THROWER]: { col: 5, row: 5 }, [ELF]: { col: 14, row: 5 } }), {
      type: 'activate',
      playerId: BLITZER,
      action: 'move',
    }).state
    const plans = generatePlans(viewOf(state))
    expect(new Set(plans.map((p) => p.playerId))).toEqual(new Set([BLITZER]))
    expect(plans[0]!.label).toBe(`${BLITZER} ends the activation`)
    expect(plans.every((p) => !p.activate)).toBe(true)
  })
})

describe('carrying out a plan', () => {
  it('stops when a Dodge on the way fails', () => {
    // v12: the Blitzer starts marked by the Elf, so his first step out is a Dodge.
    const state = scene({ [BLITZER]: { col: 6, row: 5 }, [ELF]: { col: 7, row: 5 } })
    state.teams.home.momentum = 0
    const plan = plansOf(state, BLITZER).find((p) => p.action === 'move' && p.path.length >= 3 && p.path[0]!.q < 6)!
    expect(plan).toBeDefined()
    let view: AiView = viewOf(state)
    let step = nextStep(view, plan, startCursor(plan))!
    expect(step.command).toEqual({ type: 'activate', playerId: BLITZER, action: 'move' })
    view = simulate(view, step.command, { seed: 1 }).view
    step = nextStep(view, plan, step.cursor)!
    expect(step.command).toMatchObject({ type: 'move', dodge: true })
    const failed = simulateOutcome(view, step.command, 'failure', 1)!.view
    expect(failed.players[BLITZER]!.status).not.toBe('standing')
    expect(nextStep(failed, plan, step.cursor)).toBeNull()
  })
})

/** Positions from random play, at the start of a go or mid-activation, with nothing pending. */
function randomPositions(seed: number, every: number): AiView[] {
  let state: GameState = createMatch(rulesV12, [orcs, elves], seed)
  let rng: RngState = seededRng(seed)
  const views: AiView[] = []
  for (let n = 0; state.phase !== 'FullTime' && n < 5000; n++) {
    const legal = legalCommands(state)
    let command = legal[0]!
    if (state.phase === 'Setup' && !state.pending) {
      const placed = Object.values(state.players).filter((p) => p.team === state.turnOwner && p.hex).length
      const places = legal.filter((c) => c.type === 'place' && !state.players[c.playerId]!.hex)
      const end = legal.find((c) => c.type === 'endSetup')
      if (end && (placed >= 7 || places.length === 0)) command = end
      else if (places.length > 0) {
        const roll = rollDie(rng, Math.max(2, places.length))
        rng = roll.rng
        command = places[(roll.value - 1) % places.length]!
      }
    } else {
      const roll = rollDie(rng, Math.max(2, legal.length))
      rng = roll.rng
      command = legal[(roll.value - 1) % legal.length]!
      if (!state.pending && (state.phase === 'Round' || state.phase === 'Activation') && n % every === 0) views.push(viewOf(state))
    }
    state = apply(state, command).state
  }
  return views
}

describe('plans in random positions', () => {
  // Every plan is walked along its all-success line: each command must be legal
  // when it's reached (simulate would throw otherwise), and the plan must run
  // to its end unless the activation ends on its own (a touchdown).
  const positions = [11, 12].flatMap((seed) => randomPositions(seed, 9))

  it('only ever sends legal commands, and runs to the end when every roll succeeds', () => {
    expect(positions.length).toBeGreaterThan(20)
    const search = new Search('home')
    const stuck: string[] = []
    let walked = 0
    for (const view of positions) {
      const plans = generatePlans(view)
      // Every fifth plan keeps the test quick; the move plans dominate the list.
      for (const plan of plans.filter((_, i) => i % 5 === 0)) {
        walked++
        let current = view
        let cursor = startCursor(plan)
        let ended = false
        for (let guard = 0; guard < 60; guard++) {
          if (current.pending) {
            const { choice } = search.decide(current, 1)
            current = search.outcomes(current, { type: 'decide', choice })[0]!.view
            continue
          }
          const step = nextStep(current, plan, cursor)
          if (!step) {
            ended = cursor.finalDone && cursor.steps === plan.path.length
            break
          }
          // The success branch comes first.
          current = search.outcomes(current, step.command)[0]!.view
          cursor = step.cursor
          if (step.command.type === 'endActivation') {
            ended = true
            break
          }
        }
        const scored = current.teams.home.score + current.teams.away.score > view.teams.home.score + view.teams.away.score
        if (!ended && !scored && current.activation?.playerId === plan.playerId) stuck.push(`${plan.label} ${JSON.stringify(plan.final)}`)
      }
    }
    expect(walked).toBeGreaterThan(100)
    expect(stuck).toEqual([])
  })
})

