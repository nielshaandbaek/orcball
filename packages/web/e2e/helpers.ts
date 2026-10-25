import { expect, type Page } from '@playwright/test'

// Helpers for driving a match through the UI. Seed 1 is fixed throughout:
// with the coin toss answered so that the Elves kick off, a kick at the Orcs'
// corner (1,1) goes out for a touchback.

export const SEED = 1

export const hex = (page: Page, col: number, row: number) => page.locator(`[data-hex="${col},${row}"]`)
export const token = (page: Page, playerId: string) => page.locator(`[data-player="${playerId}"]`)

/** Start a match and answer the coin toss so that the Elves (away) kick off. */
export async function startWithElvesKicking(page: Page, rules = 'rules-v10'): Promise<void> {
  await page.goto('/')
  await page.selectOption('#config', rules)
  await page.fill('#seed', String(SEED))
  await page.getByRole('button', { name: 'Start match' }).click()
  const prompt = (await page.locator('.decision').textContent())!
  const elvesWon = prompt.includes('Away')
  await page.locator('.decision').getByRole('button', { name: elvesWon ? 'Kick off' : 'Receive' }).click()
  await expect(page.locator('.setup h2')).toHaveText('Elves set up (kicking)')
}

/** Place players by bench name (e.g. "Lineman 1") on hexes, then end setup. */
export async function setUp(page: Page, placements: [string, number, number][]): Promise<void> {
  for (const [name, col, row] of placements) {
    await page.locator('[data-bench]', { hasText: name }).click()
    await hex(page, col, row).click()
  }
  await page.getByRole('button', { name: 'End setup' }).click()
}

/** Tap a player's token (the token sits over its hex). */
export async function tapPlayer(page: Page, playerId: string): Promise<void> {
  await token(page, playerId).click()
}

export async function centre(page: Page, playerId: string): Promise<string> {
  const circle = token(page, playerId).locator('circle')
  return `${await circle.getAttribute('cx')},${await circle.getAttribute('cy')}`
}
