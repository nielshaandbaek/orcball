import { expect, type Page, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { hex } from './helpers'

// The replay viewer (#188). The fixture is a v23 match from the long runs
// (#187), Orcs against Elves, seed 1, with the events left out: 534 commands,
// rounds starting after commands 17, 88, 167, 224 and 285 in the first half
// and 305, 369, 445 and 527 in the second, and the Orcs winning 2–0.

const FIXTURE = fileURLToPath(new URL('./fixtures/rules-v23-orcs-elves.json', import.meta.url))

const at = (page: Page) => page.locator('[data-replay-at]')
const when = (page: Page) => page.locator('[data-when]')
const button = (page: Page, id: string) => page.locator(`#${id}`)

async function importFixture(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start match' }).click()
  await page.locator('#import').setInputFiles(FIXTURE)
  await expect(page.locator('[data-replay]')).toBeVisible()
}

test('an imported match opens as a replay at the start, and steps back and forth (#188)', async ({ page }) => {
  await importFixture(page)
  await expect(at(page)).toHaveText('Command 0 of 534')
  await expect(when(page)).toHaveText('Rules v23 · Half 1 · Setup')
  await expect(page.locator('[data-score]')).toHaveText('0 – 0')
  await expect(button(page, 'replay-back')).toBeDisabled()
  // Nothing to play: no setup bench, no Undo, and a tap on the board only says so.
  await expect(page.locator('#undo')).toHaveCount(0)
  await expect(page.locator('[data-bench]')).toHaveCount(0)
  await hex(page, 5, 5).click()
  await expect(page.locator('.message')).toHaveText('This is a replay: step through it with the replay controls')

  for (let i = 0; i < 3; i++) await button(page, 'replay-forward').click()
  await expect(at(page)).toHaveText('Command 3 of 534')
  await button(page, 'replay-back').click()
  await expect(at(page)).toHaveText('Command 2 of 534')
  // The arrow keys step too.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(at(page)).toHaveText('Command 4 of 534')
  await page.keyboard.press('ArrowLeft')
  await expect(at(page)).toHaveText('Command 3 of 534')
})

test('jumps to the start of the next and previous activation and round (#188)', async ({ page }) => {
  await importFixture(page)
  await button(page, 'replay-next-activation').click()
  await expect(at(page)).toHaveText('Command 17 of 534')
  await expect(when(page)).toHaveText('Rules v23 · Half 1 · Round 1')
  await button(page, 'replay-next-activation').click()
  await expect(at(page)).toHaveText('Command 24 of 534')
  await button(page, 'replay-prev-activation').click()
  await expect(at(page)).toHaveText('Command 17 of 534')

  await button(page, 'replay-next-round').click()
  await expect(at(page)).toHaveText('Command 88 of 534')
  await expect(when(page)).toHaveText('Rules v23 · Half 1 · Round 2')
  for (let i = 0; i < 4; i++) await button(page, 'replay-next-round').click()
  await expect(at(page)).toHaveText('Command 305 of 534')
  await expect(when(page)).toHaveText('Rules v23 · Half 2 · Round 1')
  // Back from a step into a round goes to its start, then to the round before.
  await button(page, 'replay-forward').click()
  await button(page, 'replay-prev-round').click()
  await expect(at(page)).toHaveText('Command 305 of 534')
  await button(page, 'replay-prev-round').click()
  await expect(at(page)).toHaveText('Command 285 of 534')
  await expect(when(page)).toHaveText('Rules v23 · Half 1 · Round 5')
})

test('Play steps forward by itself until paused, and the end offers Play on (#188)', async ({ page }) => {
  await importFixture(page)
  await button(page, 'replay-play').click()
  await expect(button(page, 'replay-play')).toHaveText('Pause')
  await expect(at(page)).toHaveText('Command 2 of 534', { timeout: 5_000 })
  await button(page, 'replay-play').click()
  await expect(button(page, 'replay-play')).toHaveText('Play')
  const paused = await at(page).textContent()
  await page.waitForTimeout(1_000)
  await expect(at(page)).toHaveText(paused!)

  // From the last round's start to the end.
  for (let i = 0; i < 9; i++) await button(page, 'replay-next-round').click()
  await expect(at(page)).toHaveText('Command 527 of 534')
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight')
  await expect(at(page)).toHaveText('Command 534 of 534')
  await expect(when(page)).toContainText('Full time')
  await expect(page.locator('[data-score]')).toHaveText('2 – 0')
  await expect(button(page, 'replay-forward')).toBeDisabled()

  // Play on leaves the replay with the match as it ended, and Undo is back.
  await button(page, 'play-on').click()
  await expect(page.locator('[data-replay]')).toHaveCount(0)
  await expect(page.locator('#undo')).toBeVisible()
  await expect(page.locator('[data-score]')).toHaveText('2 – 0')
})

test('Leave replay goes back to the start screen (#188)', async ({ page }) => {
  await importFixture(page)
  await button(page, 'replay-leave').click()
  await expect(page.getByRole('button', { name: 'Start match' })).toBeVisible()
})
