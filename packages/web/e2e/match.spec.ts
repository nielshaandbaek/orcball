import { expect, type Page, test } from '@playwright/test'
import { centre, hex, setUp, startWithElvesKicking, tapPlayer, token } from './helpers'

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

test('block', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 10, 5]])
  await setUp(page, [['Black Orc 1', 9, 5]])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLACK_ORC)
  await tapPlayer(page, BLACK_ORC)
  await page.locator('.play .actions').getByRole('button', { name: 'Block', exact: true }).click()
  await tapPlayer(page, ELF)
  const prompt = page.locator('.board-prompt')
  await expect(prompt).toContainText('Your total 4 against 3. Shove or Tackle?')
  await prompt.getByRole('button', { name: /Shove/ }).click()
  // Push straight back, then stay put.
  await hex(page, 11, 5).click()
  await prompt.getByRole('button', { name: 'Stay' }).click()

  await expect(page.locator('.log-lines')).toContainText('Orcs Black Orc 1 blocks Elves Lineman 1: 4 against 3')
  await expect(page.locator('.log-lines')).toContainText('Elves Lineman 1 is pushed to (11, 5)')
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
  await expect(page.locator('.log-lines')).toContainText('TOUCHDOWN for Orcs! (Orcs Blitzer 1)')
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
  await expect(page.locator('.log-lines')).toContainText('Elves Lineman 1 is pushed to (12, 5)')
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
  await expect(page.locator('.log-lines')).toContainText('Elves Lineman 1 braces')
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
    await expect(page.locator('.log-lines li.round-start')).toHaveText('Round 1: Orcs go first')
    await tapPlayer(page, BLITZER)
    await page.locator('.play .actions').getByRole('button', { name: 'Move', exact: true }).click()
  }

  test('Strength Disengage one hex, with no roll', async ({ page }) => {
    await marked(page)
    await hex(page, 8, 5).click()
    await expect(page.locator('.board-prompt:not(.player-prompt)')).toHaveCount(0)
    await expect(page.locator('.log-lines')).toContainText('Orcs Blitzer 1 disengages to (8, 5)')
    await expect(page.locator('.card.active')).toContainText('MA used 1 of 6')
    // A Disengage ends his movement: nothing is left to do on the board, so his controls open by themselves.
    await expect(page.locator('[data-player-prompt="activation"]').getByRole('button', { name: 'End activation' })).toBeVisible()
  })

  test('going further means a Dodge, with the Disengage as the way to stop', async ({ page }) => {
    await marked(page)
    await hex(page, 6, 5).click()
    const prompt = page.locator('.board-prompt')
    await expect(prompt.getByRole('button', { name: /^Dodge \(\d+%\)$/ })).toBeVisible()
    await prompt.getByRole('button', { name: 'Stop here' }).click()
    await expect(page.locator('.log-lines')).toContainText('Orcs Blitzer 1 disengages to')
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
