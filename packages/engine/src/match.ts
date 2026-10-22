import { loadRuleConfig, type Roster, type RuleConfig, ruleConfigHash } from './config'
import { rollDie, seededRng } from './rng'
import { type GameState, otherTeam, type Player, TEAMS, type TeamId, type TeamState } from './state'

const TEAM_LABELS: Record<TeamId, string> = { home: 'Home', away: 'Away' }

/**
 * Start a match: home uses the first roster, away the second. Each team gets
 * every player its roster fields, all off the pitch. The coin is tossed with
 * the seeded RNG, and the match opens with the winner's choice to kick or
 * receive. Refuses an invalid config or a roster that can't field a full team.
 */
export function createMatch(config: RuleConfig, rosters: [Roster, Roster], seed: number): GameState {
  // Validate again here: the config may have come from an edited file.
  const valid = loadRuleConfig(config)

  const players: Record<string, Player> = {}
  const teams = {} as Record<TeamId, TeamState>
  TEAMS.forEach((team, i) => {
    const roster = rosters[i]!
    let fielded = 0
    for (const [positionId, position] of Object.entries(roster.positions)) {
      for (let n = 1; n <= position.max; n++) {
        const id = `${team}-${positionId}-${n}`
        players[id] = {
          id,
          team,
          position: positionId,
          ma: position.ma,
          st: position.st,
          ag: position.ag,
          to: position.to,
          skills: [...position.skills],
          hex: null,
          status: 'standing',
          activatedThisRound: false,
          winded: false,
        }
        fielded++
      }
    }
    if (fielded < valid.match.playersOnPitch) {
      throw new Error(`createMatch: ${roster.name} fields ${fielded} players but a team needs ${valid.match.playersOnPitch}`)
    }
    teams[team] = {
      name: roster.name,
      score: 0,
      momentum: valid.momentum.perHalf,
      momentumUsedThisRound: false,
      usedThisRound: { blitz: 0, pass: 0, handOff: 0, foul: 0 },
    }
  })

  const toss = rollDie(seededRng(seed), 2)
  const winner: TeamId = toss.value === 1 ? 'home' : 'away'

  return {
    configId: valid.id,
    configHash: ruleConfigHash(valid),
    config: valid,
    rng: toss.rng,
    phase: 'Setup',
    half: 1,
    round: 0,
    turnOwner: winner,
    kickingTeam: winner,
    openingKicker: null,
    firstGo: otherTeam(winner),
    lastGoWasWait: false,
    activation: null,
    doubleActivation: null,
    teams,
    players,
    ball: { hex: null, carrier: null },
    pending: {
      kind: 'setup.coinToss',
      team: winner,
      prompt: `${TEAM_LABELS[winner]} (${teams[winner].name}) won the toss. Kick off or receive?`,
      choices: [
        { id: 'kick', label: 'Kick off' },
        { id: 'receive', label: 'Receive' },
      ],
      data: null,
    },
  }
}
