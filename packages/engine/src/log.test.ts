import { describe, expect, it } from 'vitest'
import { rulesV10 } from './config'
import { engine } from './default-engine'
import { fromColRow, toColRow } from './hex'
import { exportMatch, importMatch, type MatchFile, MatchFileError, newMatchFile, record, replay, undo, undoBlocked } from './log'
import { createMatch } from './match'
import type { Command, GameState } from './state'

const { orcs, elves } = rulesV10.rosters as Record<'orcs' | 'elves', (typeof rulesV10.rosters)[string]>
const SEED = 7

function start(): { file: MatchFile; state: GameState } {
  return { file: newMatchFile(rulesV10, [orcs, elves], SEED), state: createMatch(rulesV10, [orcs, elves], SEED) }
}

function play(log: { file: MatchFile; state: GameState }, ...commands: Command[]) {
  let { file, state } = log
  for (const command of commands) ({ file, state } = record(file, state, command, 1_000 + file.entries.length))
  return { file, state }
}

/**
 * A deterministic but busy match: set up three players a side near the
 * halfway line, then pick spread-out legal commands, so moves, blocks, Dodges
 * and rolls all turn up.
 */
function pickCommand(state: GameState, i: number): Command | undefined {
  const legal = engine.legalCommands(state).filter((c) => c.type !== 'unplace')
  if (state.phase === 'Setup' && !state.pending) {
    const team = state.turnOwner
    const placed = Object.values(state.players).filter((p) => p.team === team && p.hex).length
    if (placed >= 3) return legal.find((c) => c.type === 'endSetup')
    // Set up close to the halfway line, so the teams run into each other.
    const places = legal.filter((c) => c.type === 'place' && !state.players[c.playerId]!.hex)
    const fromHalfway = (c: Command) => (c.type === 'place' ? Math.abs(toColRow(c.hex).col - 9.5) : 99)
    return places.sort((a, b) => fromHalfway(a) - fromHalfway(b))[0]
  }
  return legal[(i * 7919) % legal.length]
}

function busyMatch(n: number) {
  let log = start()
  for (let i = 0; i < n; i++) {
    const command = pickCommand(log.state, i)
    if (!command) break
    log = play(log, command)
  }
  return log
}

const place = (playerId: string, col: number, row: number): Command => ({ type: 'place', playerId, hex: fromColRow({ col, row }) })
const tossAnswer = (state: GameState): Command => ({ type: 'decide', choice: state.pending!.team === 'away' ? 'kick' : 'receive' })

describe('match files', () => {
  it('hold the seed, the config id and hash, the rosters and every command with its events and time', () => {
    const log = play(start(), tossAnswer(start().state))
    expect(log.file).toMatchObject({
      format: 'orcball-match/1',
      seed: SEED,
      configId: 'rules-v10',
      configHash: log.state.configHash,
      rosters: [orcs, elves],
    })
    expect(log.file.entries).toEqual([
      { command: tossAnswer(start().state), events: [expect.objectContaining({ type: 'coinTossChoice' })], at: 1_000 },
    ])
  })

  it('refuse to record an illegal command', () => {
    expect(() => play(start(), { type: 'wait' })).toThrow(/Illegal command/)
  })
})

describe('replay', () => {
  it('rebuilds a state deep-equal to the live one', () => {
    const log = busyMatch(300)
    const events = log.file.entries.flatMap((e) => e.events)
    // A whole match, with blocks, armour rolls and plenty of D10 tests on the way.
    expect(log.state.phase).toBe('FullTime')
    expect(events.filter((e) => e.type === 'blockDeclared').length).toBeGreaterThan(0)
    expect(events.filter((e) => e.type === 'armourRolled').length).toBeGreaterThan(0)
    expect(events.filter((e) => e.type === 'rolled').length).toBeGreaterThan(5)
    expect(replay(log.file, rulesV10)).toEqual(log.state)
  })

  it('can stop at any step', () => {
    let log = start()
    const states = [log.state]
    for (let i = 0; i < 40; i++) {
      log = play(log, pickCommand(log.state, i)!)
      states.push(log.state)
    }
    states.forEach((state, step) => expect(replay(log.file, rulesV10, step)).toEqual(state))
  })

  it('works from an exported and re-imported file', () => {
    const log = busyMatch(150)
    const again = importMatch(exportMatch(log.file), rulesV10)
    expect(again).toEqual(log.file)
    expect(replay(again, rulesV10)).toEqual(log.state)
  })

  it('refuses a config that does not match the hash', () => {
    const other = { ...rulesV10, movement: { ...rulesV10.movement, sprintBonus: 3 } }
    expect(() => replay(busyMatch(5).file, other)).toThrow(MatchFileError)
  })
})

describe('undo', () => {
  // Coin toss answered, then away places a player: no dice used.
  const placed = () => {
    const first = play(start(), tossAnswer(start().state))
    return { before: first, after: play(first, place('away-lineman-1', 12, 5)) }
  }

  it('drops the last command and rebuilds the state without it', () => {
    const { before, after } = placed()
    const undone = undo(after.file, rulesV10)
    expect(undone.state).toEqual(before.state)
    expect(undone.file.entries.at(-1)).toMatchObject({ command: place('away-lineman-1', 12, 5), undone: true })
  })

  it('keeps the undone command in the export, and replay skips it', () => {
    const { before, after } = placed()
    const undone = undo(after.file, rulesV10)
    const exported = importMatch(exportMatch(undone.file), rulesV10)
    expect(exported.entries).toHaveLength(2)
    expect(exported.entries[1]!.undone).toBe(true)
    expect(replay(exported, rulesV10)).toEqual(before.state)
  })

  it('is refused once the command has used the dice', () => {
    // Set up both sides and kick: the kick rolls its direction and distance.
    let log = play(start(), tossAnswer(start().state))
    log = play(log, place('away-lineman-1', 12, 5), { type: 'endSetup' }, place('home-lineman-1', 5, 5), { type: 'endSetup' })
    log = play(log, { type: 'kick', hex: fromColRow({ col: 5, row: 5 }) })
    expect(undoBlocked(log.file, rulesV10)).toBe("Dice have been rolled, so this can't be undone")
    expect(() => undo(log.file, rulesV10)).toThrow("Dice have been rolled, so this can't be undone")
  })

  it('only goes back one action', () => {
    const { after } = placed()
    const once = undo(after.file, rulesV10)
    expect(undoBlocked(once.file, rulesV10)).toBe('Only the last action can be undone')
    // After a new action, that one can be undone.
    const next = play({ file: once.file, state: once.state }, place('away-lineman-1', 13, 5))
    expect(undoBlocked(next.file, rulesV10)).toBeNull()
  })

  it('has nothing to undo at the start', () => {
    expect(undoBlocked(start().file, rulesV10)).toBe('Nothing to undo yet')
  })
})

describe('import', () => {
  it('rejects a file played with a different config, saying so', () => {
    const other = { ...rulesV10, movement: { ...rulesV10.movement, sprintBonus: 3 } }
    const json = exportMatch(busyMatch(5).file)
    expect(() => importMatch(json, other)).toThrow(/played with rule config rules-v10 \(hash [0-9a-f]+\), but the loaded config is rules-v10 \(hash [0-9a-f]+\)/)
  })

  it('rejects files that are not match files', () => {
    expect(() => importMatch('not json', rulesV10)).toThrow('This file is not valid JSON, so it is not a match file')
    expect(() => importMatch('{"format":"something-else"}', rulesV10)).toThrow(/This is not an OrcBall match file \(format: /)
    const missing = JSON.parse(exportMatch(start().file))
    delete missing.seed
    expect(() => importMatch(JSON.stringify(missing), rulesV10)).toThrow(/\(seed: /)
  })
})
