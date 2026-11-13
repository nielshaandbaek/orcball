import { expect, type Page, test } from '@playwright/test'
import { action, centre, expectLog, hex, inLog, setUp, startWithElvesKicking, tapPlayer, token } from './helpers'

// A handful of end-to-end flows, deterministic through the fixed seed. The
// rules themselves are tested in the engine; these check the UI drives them.

const BLITZER = 'home-blitzer-1'
const BLACK_ORC = 'home-black-orc-1'
const ELF = 'away-lineman-1'

test('start a match and set up both teams', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [
    ['Lineman 1', 12, 5],
    ['Catcher 1', 14, 3],
  ])
  await expect(page.locator('.setup h2')).toHaveText('Orcs set up (receiving)')
  // The engine's reason shows for a hex in the wrong half.
  await page.locator('[data-bench]', { hasText: 'Blitzer 1' }).click()
  // The bench lies over the Elves' half (#128): Peek to tap a hex under it.
  await page.locator('[data-peek]').click()
  await hex(page, 12, 7).click()
  await expect(page.locator('.message')).toHaveText('Set up in your own half')
  await hex(page, 7, 5).click()
  await setUp(page, [['Black Orc 1', 8, 3]])
  await expect(page.locator('[data-when]')).toContainText('Kick-off')
  await expect(token(page, ELF)).toBeVisible()
  await expect(token(page, BLITZER)).toBeVisible()
})

test('setup starts with the first bench player selected, and moves on after each placement (#151)', async ({ page }) => {
  await startWithElvesKicking(page)
  const selected = page.locator('[data-bench].selected')
  const first = await page.locator('[data-bench]').first().getAttribute('data-bench')
  await expect(selected).toHaveAttribute('data-bench', first!)
  // Taps on the pitch alone place the bench in order.
  await hex(page, 12, 5).click()
  await expect(token(page, first!)).toBeVisible()
  const second = await page.locator('[data-bench]').first().getAttribute('data-bench')
  await expect(selected).toHaveAttribute('data-bench', second!)
  await hex(page, 12, 3).click()
  await expect(token(page, second!)).toBeVisible()
  // Picking another by hand still works; then it's back to the first on the bench.
  const last = await page.locator('[data-bench]').last().getAttribute('data-bench')
  await page.locator(`[data-bench="${last}"]`).click()
  await hex(page, 12, 7).click()
  await expect(token(page, last!)).toBeVisible()
  const third = await page.locator('[data-bench]').first().getAttribute('data-bench')
  await expect(selected).toHaveAttribute('data-bench', third!)
})

test('move a player', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 16, 9]])
  await setUp(page, [['Blitzer 1', 9, 5]])
  await hex(page, 1, 1).click()
  // Touchback, in the centre too (#137): the Orcs give the ball to the Blitzer.
  await expect(page.locator('[data-centre-banner]')).toContainText('TouchbackOrcs give the ball to a player')
  await tapPlayer(page, BLITZER)
  await expect(page.locator('.play h2')).toHaveText('Orcs’ go')

  const before = await centre(page, BLITZER)
  await tapPlayer(page, BLITZER)
  await action(page, 'Move').click()
  await hex(page, 12, 5).click()
  await expect(page.locator('.card.active')).toContainText('MA used 3 of 6')
  expect(await centre(page, BLITZER)).not.toBe(before)
  // Marked as done once the activation ends, not while it's under way.
  await expect(token(page, BLITZER)).not.toHaveClass(/\bdone\b/)
  await page.locator('.play').getByRole('button', { name: 'End activation' }).click()
  await expect(token(page, BLITZER)).toHaveClass(/\bdone\b/)
})

test('a tapped move is walked a hex at a time, and the board waits for it (#112)', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 16, 9]])
  await setUp(page, [['Blitzer 1', 9, 5]])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLITZER)
  await tapPlayer(page, BLITZER)
  await action(page, 'Move').click()

  // Every place the Blitzer is drawn at, as the board redraws him.
  await page.evaluate((id) => {
    const circle = document.querySelector(`[data-player="${id}"] circle`)!
    const seen: string[] = []
    ;(window as unknown as { seen: string[] }).seen = seen
    new MutationObserver(() => seen.push(`${circle.getAttribute('cx')},${circle.getAttribute('cy')}`)).observe(circle, { attributes: true })
  }, BLITZER)
  await hex(page, 12, 5).click()
  // A tap while he's walking does nothing: he's still going to (12, 5), not (10, 4).
  await expect(page.locator('.board-frame.walking')).toHaveCount(1)
  await hex(page, 10, 4).click()
  await expect(page.locator('.board-frame.walking')).toHaveCount(0)
  await expect(page.locator('.card.active')).toContainText('MA used 3 of 6')
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen)
  expect(new Set(seen).size).toBe(3)
  expect(await centre(page, BLITZER)).toBe(seen.at(-1))
})

test('hovering a reachable hex shows the path; a click walks it (#113)', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 16, 9]])
  await setUp(page, [['Blitzer 1', 9, 5]])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLITZER)
  await tapPlayer(page, BLITZER)
  await action(page, 'Move').click()

  const path = page.locator('.board .path')
  await hex(page, 12, 5).hover()
  await expect(path).toHaveAttribute('data-path', '9,5 10,5 11,5 12,5')
  await expect(path.locator('.path-step')).toHaveCount(3)
  // Off the pitch, or onto a hex he can't reach, and it's gone.
  await page.mouse.move(0, 0)
  await expect(path).toHaveCount(0)
  await hex(page, 18, 1).hover()
  await expect(path).toHaveCount(0)

  await hex(page, 12, 5).hover()
  await hex(page, 12, 5).click()
  await expect(page.locator('.board-frame.walking')).toHaveCount(0)
  await expect(page.locator('.card.active')).toContainText('MA used 3 of 6')
  await expect(path).toHaveCount(0)
})

test('rules v16: Cancel a Move before doing anything, then Block instead (#121, #103)', async ({ page }) => {
  await startWithElvesKicking(page, 'rules-v16')
  await setUp(page, [['Catcher 1', 10, 5]])
  await setUp(page, [['Black Orc 1', 9, 5]])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLACK_ORC)
  await tapPlayer(page, BLACK_ORC)
  await action(page, 'Move').click()
  const actions = page.locator('.play .actions')

  // Nothing done yet: End activation is greyed out, with the reason as its tooltip, and Cancel is offered.
  const end = actions.getByRole('button', { name: 'End activation' })
  await expect(end).toHaveAttribute('aria-disabled', 'true')
  await expect(end).toHaveAttribute('title', 'The player hasn’t done anything yet: act, or Cancel')
  // Tapped anyway (a touch screen has no tooltips), it says why in the message line.
  await end.click({ force: true }) // Playwright holds back from aria-disabled buttons; browsers do send the click
  await expect(page.locator('.message')).toHaveText('The player hasn’t done anything yet: act, or Cancel')
  await actions.getByRole('button', { name: 'Cancel' }).click()
  await expectLog(page, "Orcs Black Orc 1's activation is cancelled")

  // He's still the Orcs' to activate, and can Block instead.
  await expect(page.locator('.play h2')).toHaveText('Orcs’ go')
  await action(page, 'Block').click()
  await tapPlayer(page, 'away-catcher-1')
  await expect(page.locator('.board-prompt')).toContainText('Your total 4 against 2')
})

test('block', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 10, 5]])
  await setUp(page, [['Black Orc 1', 9, 5]])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLACK_ORC)
  await tapPlayer(page, BLACK_ORC)
  await action(page, 'Block').click()
  // A Block doesn't move him: no path and no reach shading on the board (#113).
  await hex(page, 7, 5).hover()
  await expect(page.locator('.board .path')).toHaveCount(0)
  await expect(page.locator('.board .reach')).toHaveCount(0)
  await tapPlayer(page, ELF)
  const prompt = page.locator('.board-prompt')
  await expect(prompt).toContainText('Your total 4 against 3. Shove or Tackle?')
  await prompt.getByRole('button', { name: /Shove/ }).click()
  // Push straight back, then stay put.
  await hex(page, 11, 5).click()
  await prompt.getByRole('button', { name: 'Stay' }).click()

  await expectLog(page, 'Orcs Black Orc 1 blocks Elves Lineman 1: 4 against 3')
  await expectLog(page, 'Elves Lineman 1 is pushed to (11, 5)')
  await expect(page.locator('.play h2')).toHaveText('Elves’ go')
})

test('score a touchdown', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 16, 9]])
  await setUp(page, [['Blitzer 1', 9, 5]])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLITZER)

  // Round 1: the Blitzer runs 8 hexes with the ball (Sprinting), then both sides Wait.
  await tapPlayer(page, BLITZER)
  await action(page, 'Move').click()
  await hex(page, 17, 5).click()
  await expect(page.locator('.card.active')).toContainText('MA used 8 of 6')
  await page.locator('.play').getByRole('button', { name: 'End activation' }).click()
  await page.getByRole('button', { name: 'Wait', exact: true }).click()
  await expect(page.locator('[data-when]')).toContainText('Round 2')

  // Round 2: the Elves Wait; the Blitzer steps into the end zone.
  await page.getByRole('button', { name: 'Wait', exact: true }).click()
  await tapPlayer(page, BLITZER)
  await action(page, 'Move').click()
  await hex(page, 18, 5).click()

  await expect(page.locator('[data-score]')).toHaveText('1 – 0')
  await expectLog(page, 'TOUCHDOWN for Orcs! (Orcs Blitzer 1)')
  await expect(page.locator('.setup h2')).toHaveText('Orcs set up (kicking)')
})

test('blitz, then keep moving', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 11, 5]])
  await setUp(page, [['Blitzer 1', 9, 5]])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLITZER)

  // Both teams can Blitz; declaring it greys the Orcs' badge at once, not the Elves' (#143).
  const badge = (team: string) => page.locator(`.blitz-badge.${team}`)
  await expect(badge('home')).toHaveAttribute('data-blitz', 'left')
  await expect(badge('away')).toHaveAttribute('data-blitz', 'left')
  await tapPlayer(page, BLITZER)
  await action(page, 'Blitz').click()
  await expect(badge('home')).toHaveAttribute('data-blitz', 'used')
  await expect(badge('home')).toHaveAttribute('title', 'Orcs have Blitzed this round')
  await expect(badge('away')).toHaveAttribute('data-blitz', 'left')
  await hex(page, 10, 5).click()
  await tapPlayer(page, ELF)
  const prompt = page.locator('.board-prompt')
  await prompt.getByRole('button', { name: /Shove/ }).click()
  await hex(page, 12, 5).click()
  await prompt.getByRole('button', { name: 'Follow up' }).click()
  await expect(page.locator('.card.active')).toContainText('MA used 2 of 6')

  // Back two hexes, Disengaging from the Elf: 3 more MA.
  await hex(page, 9, 5).click()
  await expect(page.locator('.card.active')).toContainText('MA used 5 of 6')
  await expectLog(page, 'Elves Lineman 1 is pushed to (12, 5)')
})

test('rules v12: an Elf Lineman Braces against the Blitzer', async ({ page }) => {
  await startWithElvesKicking(page, 'rules-v12')
  await setUp(page, [['Lineman 1', 10, 5]])
  await setUp(page, [['Blitzer 1', 9, 5]])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLITZER)
  await tapPlayer(page, BLITZER)
  await action(page, 'Block').click()
  await tapPlayer(page, ELF)
  const prompt = page.locator('.board-prompt')
  await expect(prompt).toContainText('Brace?')
  await prompt.getByRole('button', { name: 'Brace (+1)' }).click()
  // 3 against 4: no Shove; the Blitzer's Block cancels the −1, so the Tackle is 50%.
  await expect(prompt).toContainText('Your total 3 against 4: too weak to Shove. Tackle?')
  await expect(prompt.getByRole('button')).toHaveText(['Tackle (50%)'])
  await expectLog(page, 'Elves Lineman 1 braces')
})

test.describe('rules v11', () => {
  // The Blitzer starts next to an Elf Lineman, ST 3 each: it may Strength Disengage.
  async function marked(page: Page) {
    await startWithElvesKicking(page, 'rules-v11')
    await setUp(page, [['Lineman 1', 10, 5]])
    await setUp(page, [['Blitzer 1', 9, 5]])
    await hex(page, 1, 1).click()
    await tapPlayer(page, BLITZER)
    await expect(page.locator('[data-when]')).toContainText('Rules v11')
    // The Orcs received, so they have the initiative in round 1.
    await expect(page.locator('.scorebar .round')).toHaveClass(/\bhome\b/)
    await inLog(page, (lines) => expect(lines.locator('li.round-start')).toHaveText('Round 1: Orcs go first'))
    await tapPlayer(page, BLITZER)
    await action(page, 'Move').click()
  }

  test('Strength Disengage one hex, with no roll', async ({ page }) => {
    await marked(page)
    await hex(page, 8, 5).click()
    await expect(page.locator('.board-prompt:not(.player-prompt)')).toHaveCount(0)
    await expectLog(page, 'Orcs Blitzer 1 disengages to (8, 5)')
    await expect(page.locator('.card.active')).toContainText('MA used 1 of 6')
    // A Disengage ends his movement: nothing is left to do on the board, so his controls open by themselves.
    await expect(page.locator('[data-player-prompt="activation"]').getByRole('button', { name: 'End activation' })).toBeVisible()
  })

  test('going further means a Dodge, with the Disengage as the way to stop', async ({ page }) => {
    await marked(page)
    await hex(page, 6, 5).click()
    const prompt = page.locator('.board-prompt')
    await expect(prompt.getByRole('button', { name: /^Dodge \(\d+%\)$/ })).toBeVisible()
    // While the roll waits, the rest of the path is shown, its first step marked as a Dodge (#113).
    const path = page.locator('.board .path')
    await expect(path).toHaveAttribute('data-path', /^9,5 .*6,5$/)
    await expect(path.locator('.path-step').first()).toHaveClass(/\bdodge\b/)
    await prompt.getByRole('button', { name: 'Stop here' }).click()
    await expectLog(page, 'Orcs Blitzer 1 disengages to')
    await expect(page.locator('.card.active')).toContainText('MA used 1 of 6')
  })
})

test('player icons can be switched off for initials, and the choice is remembered', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 12, 5]])
  await expect(token(page, ELF).locator('image')).toHaveCount(1)
  // In the header's menu (#128).
  await page.locator('#menu-button').click()
  await page.locator('#icons').click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(token(page, ELF).locator('image')).toHaveCount(0)
  await expect(token(page, ELF)).toContainText('L1')
  await page.reload()
  await expect(token(page, ELF)).toContainText('L1')
  await page.locator('#menu-button').click()
  await page.locator('#icons').click()
  await expect(token(page, ELF).locator('image')).toHaveCount(1)
})

test('a new round shows its number over the board for a moment, and not again on reload', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 16, 9]])
  await setUp(page, [['Blitzer 1', 9, 5]])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLITZER)
  const banner = page.locator('[data-round-banner]')
  await expect(banner).toContainText('Half 1 · Round 1')
  await expect(banner).toContainText('Orcs go first')
  await expect(banner).toHaveClass(/\bhome\b/)
  // It fades by itself, and the board stays usable meanwhile.
  await expect(banner).toHaveCount(0, { timeout: 4000 })

  // Both sides Wait: round 2, with the Elves going first.
  await page.getByRole('button', { name: 'Wait', exact: true }).click()
  await page.getByRole('button', { name: 'Wait', exact: true }).click()
  await expect(banner).toContainText('Round 2')
  await expect(banner).toHaveClass(/\baway\b/)

  // The saved match comes back on reload without the banner.
  await page.reload()
  await expect(page.locator('[data-when]')).toContainText('Round 2')
  await expect(banner).toHaveCount(0)
})

test('the match log opens over the board and closes again (#127)', async ({ page }) => {
  await startWithElvesKicking(page, 'rules-v16')
  // Hidden by default: only the ticker with the newest line.
  await expect(page.locator('.log-lines')).toHaveCount(0)
  await expect(page.locator('[data-log-ticker]')).toHaveText('Elves won the toss and chose to kick off')
  await setUp(page, [['Lineman 1', 12, 5]])
  await expect(page.locator('[data-log-ticker]')).toHaveText('Elves have set up')

  // The header button, then the close button.
  await page.locator('#log-button').click()
  await expect(page.getByRole('dialog', { name: 'Match log' })).toBeVisible()
  await expect(page.locator('.log-lines li')).toHaveText(['Elves won the toss and chose to kick off', 'Elves have set up'])
  await page.locator('#log-close').click()
  await expect(page.locator('.log-lines')).toHaveCount(0)

  // The ticker, then Escape.
  await page.locator('[data-log-ticker]').click()
  await expect(page.getByRole('dialog', { name: 'Match log' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // A tap outside the panel.
  await page.locator('#log-button').click()
  await page.locator('[data-log-overlay]').click({ position: { x: 5, y: 5 } })
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('layout: a bigger board, the tools in a menu, Momentum in the header, dots for players left (#128)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await startWithElvesKicking(page, 'rules-v16')
  await setUp(page, [['Lineman 1', 13, 5]])
  await setUp(page, [['Blitzer 1', 9, 5], ['Black Orc 1', 9, 3]])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLITZER)
  await expect(page.locator('.play h2')).toHaveText('Orcs’ go')

  // The board fills the window: wider than the 912px beside the old side panel, and nothing scrolls.
  const board = (await page.locator('svg.board').boundingBox())!
  expect(board.width).toBeGreaterThan(1050)
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true)

  // Export, Import and icons are in the header's menu; Undo stays in the panel.
  await expect(page.locator('.panel #undo')).toBeVisible()
  await page.locator('#menu-button').click()
  await expect(page.getByRole('menuitem')).toHaveText(['Export match', 'Import match', 'Show initials'])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)

  // Momentum as tokens beside the score, and the players left as dots.
  await expect(page.locator('.momentum-tokens.home .token-coin')).toHaveCount(2)
  await expect(page.locator('.left-dots .dot')).toHaveCount(2)

  await page.getByRole('button', { name: 'Momentum: double activation' }).click()
  await expect(page.locator('.momentum-tokens.home .token-coin')).toHaveCount(1)
  await expect(page.locator('.momentum-tokens.away .token-coin')).toHaveCount(2)

  // The bar is one height whatever is in it, so the board doesn't change size: a player selected, then a Blitz.
  const size = async () => JSON.stringify(await page.locator('svg.board').boundingBox())
  const start = await size()
  await tapPlayer(page, BLITZER)
  await expect(page.locator('.play .card strong')).toHaveText('Blitzer 1')
  expect(await size()).toBe(start)
  await action(page, 'Blitz').click()
  await expect(page.locator('.card.active')).toBeVisible()
  expect(await size()).toBe(start)
  await hex(page, 11, 5).click()
  await hex(page, 11, 5).click()
  await expect(page.locator('.card.active')).toContainText('MA used 2 of 6')
  expect(await size()).toBe(start)

  // The pop-up lists every action, the ones not allowed greyed out with the reason as a tooltip.
  await page.locator('.play').getByRole('button', { name: 'End activation' }).click()
  await tapPlayer(page, BLACK_ORC) // the Orcs' second go of their double activation
  const blitz = action(page, 'Blitz')
  await expect(blitz).toHaveAttribute('aria-disabled', 'true')
  await expect(blitz).toHaveAttribute('title', 'Your team has already used its Blitz this round')
  await expect(action(page, 'Move')).not.toHaveAttribute('aria-disabled')
})

test('setup on a wide screen: the bench over the other half of the board, and Peek (#128)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await startWithElvesKicking(page)
  // The Elves set up on the right, so their bench lies over the left half, see-through.
  const overlay = page.locator('[data-setup-overlay]')
  await expect(overlay).toHaveClass(/over-left/)
  const board = (await page.locator('svg.board').boundingBox())!
  const box = (await overlay.boundingBox())!
  expect(box.x + box.width).toBeLessThan(board.x + board.width / 2)
  await expect(page.locator('.panel .setup')).toHaveCount(0)
  // Peek hides it for a moment.
  await page.locator('[data-peek]').click()
  await expect(overlay).toHaveClass(/peeking/)
  await expect(overlay).not.toHaveClass(/peeking/, { timeout: 4000 })
  // The Orcs' bench lies over the right half.
  await setUp(page, [['Lineman 1', 13, 5]])
  await expect(overlay).toHaveClass(/over-right/)
})

test('a kick-off drift and bounce show the ball in each hex, a step at a time, and in the log (#161)', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 16, 9]])
  await setUp(page, [['Blitzer 1', 9, 5]])
  // Record every hex the ball is drawn in, with the time.
  await page.evaluate(() => {
    const seen: [string, number][] = []
    ;(window as unknown as { ballSeen: typeof seen }).ballSeen = seen
    new MutationObserver(() => {
      const at = document.querySelector('[data-ball]')?.getAttribute('data-ball')
      if (at && seen.at(-1)?.[0] !== at) seen.push([at, performance.now()])
    }).observe(document.querySelector('svg.board')!, { subtree: true, attributes: true, childList: true })
  })
  // Seed 1: the kick at (4,5) drifts 3 hexes to (1,5) and bounces back to (2,5).
  await hex(page, 4, 5).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { ballSeen: [string, number][] }).ballSeen.map(([at]) => at))).toEqual(['4,5', '3,5', '2,5', '1,5', '2,5'])
  const times = await page.evaluate(() => (window as unknown as { ballSeen: [string, number][] }).ballSeen.map(([, t]) => t))
  for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThan(120)
  await page.getByRole('button', { name: 'Log' }).click()
  await expect(page.locator('.log-dialog')).toContainText('The ball drifts to (1, 5)')
  await expect(page.locator('.log-dialog')).toContainText('The ball bounces to (2, 5)')
})
