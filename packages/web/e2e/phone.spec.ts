import { expect, type Page, test } from '@playwright/test'
import { hex, setUp, startWithElvesKicking, tapPlayer, token } from './helpers'

// On a phone the panel sits below the board, out of sight (#91). A whole
// activation plays from prompts next to the player, with no scrolling.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

const BLITZER = 'home-blitzer-1'
const scrolled = (page: Page) => page.evaluate(() => window.scrollY)

test('select a player, Move and end the activation without scrolling', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 16, 9]])
  await setUp(page, [['Blitzer 1', 9, 5]])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLITZER) // the touchback gives him the ball
  await page.evaluate(() => window.scrollTo(0, 0))

  // Tapping him opens his actions beside him.
  await tapPlayer(page, BLITZER)
  const actions = page.locator('[data-player-prompt="actions"]')
  await expect(actions).toContainText('Blitzer 1')
  await expect(actions.getByRole('button')).toHaveText(['Move', 'Block', 'Blitz', 'Pass', 'Hand-off', 'Foul'])
  await actions.getByRole('button', { name: 'Move' }).click()
  await expect(actions).toHaveCount(0)
  await expect(page.locator('.message')).toHaveText('Tap the player again for End activation and his other options')

  // Move, then tap him for his controls; tapping a hex closes them again.
  await hex(page, 12, 5).click()
  await expect(page.locator('[data-player-prompt="activation"]')).toHaveCount(0)
  await tapPlayer(page, BLITZER)
  const controls = page.locator('[data-player-prompt="activation"]')
  await expect(controls.getByRole('button', { name: 'End activation' })).toBeVisible()
  await tapPlayer(page, BLITZER)
  await expect(controls).toHaveCount(0)
  await tapPlayer(page, BLITZER)
  await controls.getByRole('button', { name: 'End activation' }).click()
  await expect(token(page, BLITZER)).toHaveClass(/\bdone\b/)

  expect(await scrolled(page)).toBe(0)
})

test('tapping elsewhere closes the actions, and another player moves them', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 16, 9]])
  await setUp(page, [
    ['Blitzer 1', 9, 5],
    ['Lineman 1', 9, 9],
  ])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLITZER)
  await page.evaluate(() => window.scrollTo(0, 0))

  await tapPlayer(page, BLITZER)
  const actions = page.locator('[data-player-prompt="actions"]')
  await expect(actions).toContainText('Blitzer 1')
  await tapPlayer(page, 'home-lineman-1')
  await expect(actions).toContainText('Lineman 1')
  await hex(page, 12, 7).click()
  await expect(actions).toHaveCount(0)
  expect(await scrolled(page)).toBe(0)
})

test('a touchback asks for a tap on a player, in a small prompt that covers none of them', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 16, 9]])
  const orcs: [string, number, number][] = [
    ['Blitzer 1', 2, 1], // at the top: a tall prompt beside him went off the screen
    ['Lineman 1', 5, 3],
    ['Lineman 2', 9, 5],
    ['Thrower 1', 7, 7],
    ['Blitzer 2', 3, 9],
  ]
  await setUp(page, orcs)
  await hex(page, 1, 1).click() // out: a touchback
  await page.evaluate(() => window.scrollTo(0, 0))

  const prompt = page.locator('.board-prompt')
  await expect(prompt).toContainText('Tap one of the marked players.')
  await expect(prompt.getByRole('button')).toHaveCount(0)
  const box = (await prompt.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)

  // Every Orc can still be tapped: nothing lies over his token.
  for (const id of ['home-blitzer-1', 'home-lineman-1', 'home-lineman-2', 'home-thrower-1', 'home-blitzer-2']) {
    const c = (await token(page, id).boundingBox())!
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-player]')?.getAttribute('data-player'), [c.x + c.width / 2, c.y + c.height / 2])
    expect(hit, id).toBe(id)
  }
  await tapPlayer(page, 'home-thrower-1')
  await expect(page.locator('.play h2')).toHaveText('Orcs’ go')
})
