import { expect, type Page, test } from '@playwright/test'
import { centre, hex, setUp, startWithElvesKicking, tapPlayer, token } from './helpers'

// A tap on empty pitch closes what's open before it opens Wait / Momentum
// (#292); shortcuts from the actions pop-up: a reachable hex starts a Move, an
// adjacent opponent a Block (#293); an activation with nothing left in it ends
// by itself, and one Undo takes back the end with his last step (#294).

const BLITZER = 'home-blitzer-1'
const BLACK_ORC = 'home-black-orc-1'
const ELF = 'away-lineman-1'

/** The Orcs to go in round 1, after a touchback gives their Blitzer the ball. */
async function orcsToGo(page: Page, elf: [number, number], orcs: [string, number, number][] = [['Blitzer 1', 9, 5]]): Promise<void> {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', ...elf]])
  await setUp(page, orcs)
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLITZER)
  await expect(page.locator('.team-box.on-go .team-name')).toHaveText('Orcs')
}

test('a tap on empty pitch first closes the actions pop-up; the next one opens Wait / Momentum (#292)', async ({ page }) => {
  await orcsToGo(page, [16, 9])
  await tapPlayer(page, BLITZER)
  await expect(page.locator('[data-player-prompt="actions"]')).toBeVisible()
  // Far beyond his reach: it only closes the pop-up.
  await hex(page, 2, 9).click()
  await expect(page.locator('[data-player-prompt="actions"]')).toHaveCount(0)
  await expect(page.locator('[data-go-prompt]')).toHaveCount(0)
  await hex(page, 2, 9).click()
  await expect(page.locator('[data-go-prompt]')).toBeVisible()
  // And with it open, a tap on empty pitch closes it.
  await hex(page, 2, 7).click()
  await expect(page.locator('[data-go-prompt]')).toHaveCount(0)
})

test('a reachable hex starts his Move and shows the way; a second tap goes (#293)', async ({ page }) => {
  await orcsToGo(page, [16, 9])
  await tapPlayer(page, BLITZER)
  await hex(page, 12, 5).click()
  await expect(page.locator('.path')).toHaveAttribute('data-path', /12,5$/)
  await expect(token(page, BLITZER)).toHaveClass(/selected/)
  await hex(page, 12, 5).click()
  await expect(page.locator('.card.active')).toContainText('MA used 3 of 6')
})

test('an adjacent standing opponent starts a Block on him, odds first (#293)', async ({ page }) => {
  await orcsToGo(page, [10, 5])
  await tapPlayer(page, BLITZER)
  await tapPlayer(page, ELF)
  await expect(page.locator('[data-declare="block"]')).toBeVisible()
})

test('with nothing left but End activation, it ends by itself; one Undo takes back the end and his last step (#294)', async ({ page }) => {
  await orcsToGo(page, [16, 9], [['Blitzer 1', 9, 5], ['Black Orc 1', 8, 7]])
  const before = await centre(page, BLACK_ORC)
  await tapPlayer(page, BLACK_ORC)
  await page.locator('[data-player-prompt="actions"]').getByRole('button', { name: 'Move', exact: true }).click()
  // As far as he goes, his 4 MA and both Sprints (no roll in v10): then he can only end.
  await hex(page, 2, 7).click()
  await expect(page.locator('.team-box.on-go .team-name')).toHaveText('Elves', { timeout: 5_000 })
  await expect(page.locator('[data-player-prompt="activation"]')).toHaveCount(0)
  await page.locator('#undo').click()
  // One Undo takes back the end and his last step with it: his activation is open again, a step left.
  await expect(page.locator('.team-box.on-go .team-name')).toHaveText('Orcs')
  await expect(page.locator('.card.active')).toContainText('MA used 5 of 4')
  expect(await centre(page, BLACK_ORC)).not.toBe(before)
})
