import { expect, type Page, test } from '@playwright/test'
import { hex, setUp, startWithElvesKicking, tapPlayer } from './helpers'

// The score bar without the "▶ Go" mark (#289), an opponent's reach shaded
// cooler than your own player's (#290), and the stats-only pop-up (phones in
// landscape) fading out by itself (#291).

const BLITZER = 'home-blitzer-1'
const ELF = 'away-lineman-1'

/** The Orcs to go in round 1, after a touchback gives their Blitzer the ball; an Elf Lineman across from him. */
async function orcsToGo(page: Page): Promise<void> {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 12, 5]])
  await setUp(page, [['Blitzer 1', 9, 5]])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLITZER)
  await expect(page.locator('.team-box.on-go .team-name')).toHaveText('Orcs')
}

test('no Go mark in the score bar; an opponent’s reach is tinted, your own player’s isn’t (#289, #290)', async ({ page }) => {
  await orcsToGo(page)
  await expect(page.locator('.go-mark')).toHaveCount(0)
  await expect(page.locator('.team-box.on-go')).not.toContainText('▶')

  await tapPlayer(page, BLITZER)
  await expect(page.locator('.board .reach').first()).toBeVisible()
  await expect(page.locator('.board .reach.opponent')).toHaveCount(0)

  await tapPlayer(page, ELF)
  await expect(page.locator('.board .reach.opponent').first()).toBeVisible()
  expect(await page.locator('.board .reach').count()).toBe(await page.locator('.board .reach.opponent').count())
})

test.describe('on a phone in landscape', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true })

  test('an opponent’s stats pop-up fades out by itself, his reach stays, and a tap on him shows it again (#291)', async ({ page }) => {
    await orcsToGo(page)
    await tapPlayer(page, ELF)
    const info = page.locator('[data-player-prompt="info"]')
    await expect(info).toBeVisible()
    await expect(info).toBeHidden({ timeout: 4_000 })
    await expect(page.locator('.board .reach.opponent').first()).toBeVisible()
    await tapPlayer(page, ELF)
    await expect(info).toBeVisible()
  })
})
