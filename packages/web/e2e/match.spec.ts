import { expect, test } from '@playwright/test'
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
  await page.locator('.actions').getByRole('button', { name: 'Move', exact: true }).click()
  await hex(page, 12, 5).click()
  await expect(page.locator('.card.active')).toContainText('MA used 3 of 6')
  expect(await centre(page, BLITZER)).not.toBe(before)
})

test('block', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 10, 5]])
  await setUp(page, [['Black Orc 1', 9, 5]])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLACK_ORC)
  await tapPlayer(page, BLACK_ORC)
  await page.locator('.actions').getByRole('button', { name: 'Block', exact: true }).click()
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
  await page.locator('.actions').getByRole('button', { name: 'Move', exact: true }).click()
  await hex(page, 17, 5).click()
  await expect(page.locator('.card.active')).toContainText('MA used 8 of 6')
  await page.getByRole('button', { name: 'End activation' }).click()
  await page.getByRole('button', { name: 'Wait', exact: true }).click()
  await expect(page.locator('[data-when]')).toContainText('Round 2')

  // Round 2: the Elves Wait; the Blitzer steps into the end zone.
  await page.getByRole('button', { name: 'Wait', exact: true }).click()
  await tapPlayer(page, BLITZER)
  await page.locator('.actions').getByRole('button', { name: 'Move', exact: true }).click()
  await hex(page, 18, 5).click()

  await expect(page.locator('[data-score]')).toHaveText('1 – 0')
  await expect(page.locator('.log-lines')).toContainText('TOUCHDOWN for Orcs! (Orcs Blitzer 1)')
  await expect(page.locator('.setup h2')).toHaveText('Orcs set up (kicking)')
})
