import { expect, type Page, test } from '@playwright/test'
import { centre, expectLog, hex, inLog, setUp, startWithElvesKicking, tapPlayer, token } from './helpers'

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
  await hex(page, 12, 7).click()
  await expect(page.locator('.message')).toHaveText('Set up in your own half')
  await hex(page, 7, 5).click()
  await setUp(page, [['Black Orc 1', 8, 3]])
  await expect(page.locator('[data-when]')).toContainText('Kick-off')
  await expect(token(page, ELF)).toBeVisible()
  await expect(token(page, BLITZER)).toBeVisible()
})

test('move a player', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 16, 9]])
  await setUp(page, [['Blitzer 1', 9, 5]])
  await hex(page, 1, 1).click()
  // Touchback: the Orcs give the ball to the Blitzer.
  await tapPlayer(page, BLITZER)
  await expect(page.locator('.play h2')).toHaveText('Orcs’ go')

  const before = await centre(page, BLITZER)
  await tapPlayer(page, BLITZER)
  await page.locator('.play .actions').getByRole('button', { name: 'Move', exact: true }).click()
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
  await page.locator('.play .actions').getByRole('button', { name: 'Move', exact: true }).click()

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
  await page.locator('.play .actions').getByRole('button', { name: 'Move', exact: true }).click()

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
  const actions = page.locator('.play .actions')
  await actions.getByRole('button', { name: 'Move', exact: true }).click()

  // Nothing done yet: End activation is greyed out, with the reason, and Cancel is offered.
  await expect(actions.getByRole('button', { name: 'End activation' })).toBeDisabled()
  await expect(page.locator('.play .reason')).toHaveText('The player hasn’t done anything yet: act, or Cancel')
  await actions.getByRole('button', { name: 'Cancel' }).click()
  await expectLog(page, "Orcs Black Orc 1's activation is cancelled")

  // He's still the Orcs' to activate, and can Block instead.
  await expect(page.locator('.play h2')).toHaveText('Orcs’ go')
  await actions.getByRole('button', { name: 'Block', exact: true }).click()
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
  await page.locator('.play .actions').getByRole('button', { name: 'Block', exact: true }).click()
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
  await page.locator('.play .actions').getByRole('button', { name: 'Move', exact: true }).click()
  await hex(page, 17, 5).click()
  await expect(page.locator('.card.active')).toContainText('MA used 8 of 6')
  await page.locator('.play').getByRole('button', { name: 'End activation' }).click()
  await page.getByRole('button', { name: 'Wait', exact: true }).click()
  await expect(page.locator('[data-when]')).toContainText('Round 2')

  // Round 2: the Elves Wait; the Blitzer steps into the end zone.
  await page.getByRole('button', { name: 'Wait', exact: true }).click()
  await tapPlayer(page, BLITZER)
  await page.locator('.play .actions').getByRole('button', { name: 'Move', exact: true }).click()
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

  await tapPlayer(page, BLITZER)
  await page.locator('.play .actions').getByRole('button', { name: 'Blitz', exact: true }).click()
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
  await page.locator('.play .actions').getByRole('button', { name: 'Block', exact: true }).click()
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
    await page.locator('.play .actions').getByRole('button', { name: 'Move', exact: true }).click()
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
  await page.locator('#icons').click()
  await expect(token(page, ELF).locator('image')).toHaveCount(0)
  await expect(token(page, ELF)).toContainText('L1')
  await page.reload()
  await expect(token(page, ELF)).toContainText('L1')
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
