import { expect, type Page, test } from '@playwright/test'
import { hex, setUp, startWithElvesKicking, tapPlayer, token } from './helpers'

// Phones in landscape (#258): everything on one screen. No row under the
// board: Undo, Wait and Momentum are in a pop-up on an empty hex, the player's
// stats in his pop-ups, the newest log line over the board for a moment, and
// the full log in the menu.

const BLITZER = 'home-blitzer-1'

/** The Orcs to go in round 1, after a touchback gives their Blitzer the ball. */
async function orcsToGo(page: Page): Promise<void> {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 16, 9]])
  await setUp(page, [['Blitzer 1', 9, 5]])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLITZER) // the touchback gives him the ball
  await expect(page.locator('.team-box.on-go .team-name')).toHaveText('Orcs')
}

test.describe('a phone held sideways', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true })

  test('everything fits on one screen: no row under the board, the commands on an empty hex', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.removeItem('orcball.goMenuSeen'))
    await orcsToGo(page)

    // No scrolling, and no row under the board.
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true)
    await expect(page.locator('.board-foot')).toBeHidden()
    // On the Orcs' go, with nobody selected, the hint says where Wait is.
    await expect(page.locator('[data-go-hint]')).toHaveText('Tap the pitch to Wait or use Momentum')

    // An empty hex opens Undo, Wait and Momentum there.
    await hex(page, 4, 8).click()
    const go = page.locator('[data-go-prompt]')
    await expect(go.getByRole('button')).toHaveText(['Undo', 'Wait', 'Momentum'])
    // Once opened, the hint is gone, also after a reload.
    await expect(page.locator('[data-go-hint]')).toHaveCount(0)
    await go.getByRole('button', { name: 'Wait', exact: true }).click()
    await expect(page.locator('.team-box.on-go .team-name')).toHaveText('Elves')
    await expect(go).toHaveCount(0)
    await page.reload()
    await expect(page.locator('.team-box')).toHaveCount(2)
    await expect(page.locator('[data-go-hint]')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true)
  })

  test('a player’s pop-ups carry his stats, and Undo is in his activation pop-up', async ({ page }) => {
    await orcsToGo(page)
    await tapPlayer(page, BLITZER)
    const actions = page.locator('[data-player-prompt="actions"]')
    await expect(actions.locator('.player-line')).toContainText('Blitzer 1')
    await expect(actions.locator('.player-line')).toContainText('MA 6 · ST 3 · AG 6+ · TO 9')
    await actions.getByRole('button', { name: 'Move' }).click()

    // During the activation an empty hex moves him (on touch, the first tap shows the way), no commands pop-up.
    await hex(page, 11, 5).click()
    await expect(page.locator('[data-go-prompt]')).toHaveCount(0)
    await hex(page, 11, 5).click()
    await expect(page.locator('.board-frame.walking')).toHaveCount(0)
    await tapPlayer(page, BLITZER)
    const controls = page.locator('[data-player-prompt="activation"]')
    await expect(controls.locator('.player-line')).toContainText('MA used 2 of 6')
    await expect(controls.getByRole('button', { name: 'Undo' })).toBeVisible()
    await controls.getByRole('button', { name: 'Undo' }).click()
    await expect(token(page, BLITZER)).not.toHaveClass(/\bdone\b/)
  })

  test('the newest log line shows over the board for a moment; the whole log is in the menu', async ({ page }) => {
    await orcsToGo(page)
    await hex(page, 4, 8).click()
    await page.locator('[data-go-prompt]').getByRole('button', { name: 'Wait', exact: true }).click()
    await expect(page.locator('[data-log-toast]')).toContainText('Orcs Wait')
    await expect(page.locator('[data-log-toast]')).toHaveCount(0, { timeout: 8_000 })
    await page.locator('#menu-button').click()
    await page.getByRole('menuitem', { name: 'Match log' }).click()
    await expect(page.getByRole('dialog', { name: 'Match log' })).toBeVisible()
  })
})

test('on desktop the row under the board stays, and an empty hex opens the commands too (#258)', async ({ page }) => {
  await orcsToGo(page)
  await expect(page.locator('.board-foot #undo')).toBeVisible()
  await expect(page.locator('[data-go-hint]')).toBeHidden()
  await hex(page, 4, 8).click()
  await expect(page.locator('[data-go-prompt]').getByRole('button')).toHaveText(['Undo', 'Wait', 'Momentum'])
  // Tapping it again shuts it.
  await hex(page, 4, 8).click()
  await expect(page.locator('[data-go-prompt]')).toHaveCount(0)
})
