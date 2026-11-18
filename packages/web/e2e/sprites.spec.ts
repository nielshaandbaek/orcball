import { expect, type Page, test } from '@playwright/test'
import { action, declare, expectLog, hex, setUp, startWithElvesKicking, tapPlayer, token } from './helpers'

// Animated sprites (#208). Each player's sprite says which animation it's
// showing in data-anim. The one-off animations last well under a second, so
// rather than catch them in the act, every animation each player shows is
// recorded as it happens and checked afterwards.

const BLITZER = 'home-blitzer-1'
const BLACK_ORC = 'home-black-orc-1'
const ELF = 'away-lineman-1'

/** Start recording the animations these players show, in order, without repeats. */
async function watch(page: Page, ids: string[]): Promise<void> {
  await page.evaluate((ids) => {
    const seen: Record<string, string[]> = {}
    ;(window as unknown as { anims: Record<string, string[]> }).anims = seen
    for (const id of ids) {
      const token = document.querySelector(`[data-player="${id}"]`)!
      const list: string[] = (seen[id] = [])
      const note = () => {
        const anim = token.querySelector('[data-anim]')?.getAttribute('data-anim')
        if (anim && list.at(-1) !== anim) list.push(anim)
      }
      note()
      new MutationObserver(note).observe(token, { attributes: true, subtree: true, attributeFilter: ['data-anim'] })
    }
  }, ids)
}

const seen = (page: Page, id: string) => page.evaluate((id) => (window as unknown as { anims: Record<string, string[]> }).anims[id] ?? [], id)

test('players stand idle, run while they move, and are idle again after (#208)', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 16, 9]])
  await setUp(page, [['Blitzer 1', 9, 5]])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLITZER)
  await expect(token(page, BLITZER).locator('[data-anim]')).toHaveAttribute('data-anim', 'idle')
  // The Orcs at home in red, the Elves away in blue.
  await expect(token(page, BLITZER).locator('image')).toHaveAttribute('href', /sprites\/orcs\/red\/blitzer\.png/)
  await expect(token(page, 'away-lineman-1').locator('image')).toHaveAttribute('href', /sprites\/elves\/blue\/lineman\.png/)
  // Pixel art, drawn crisp (Safari's crisp-edges, the others' pixelated).
  expect(await token(page, BLITZER).locator('image').evaluate((el) => getComputedStyle(el).imageRendering)).toMatch(/pixelated|crisp-edges/)

  await watch(page, [BLITZER])
  await tapPlayer(page, BLITZER)
  await action(page, 'Move').click()
  await hex(page, 12, 5).click()
  await expect(page.locator('.card.active')).toContainText('MA used 3 of 6')
  await expect(token(page, BLITZER).locator('[data-anim]')).toHaveAttribute('data-anim', 'idle')
  expect(await seen(page, BLITZER)).toEqual(['idle', 'running', 'idle'])

  // He runs facing the way he goes: back to the left, then he faces his attacking end again.
  const sprite = token(page, BLITZER).locator('[data-anim]')
  await expect(sprite).toHaveAttribute('data-facing', 'right')
  await hex(page, 10, 5).click()
  await expect(sprite).toHaveAttribute('data-facing', 'left')
  await expect(sprite).toHaveAttribute('data-anim', 'running')
  await expect(page.locator('.card.active')).toContainText('MA used 5 of 6')
  await expect(sprite).toHaveAttribute('data-facing', 'right')
})

test('a Tackle: the attacker blocks, the player knocked down falls and lies there (#208)', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 10, 5]])
  await setUp(page, [['Black Orc 1', 9, 5]])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLACK_ORC)
  await watch(page, [BLACK_ORC, ELF])

  // The Black Orc Tackles the Elf, pushing him back first, and stays put.
  await tapPlayer(page, BLACK_ORC)
  await action(page, 'Block').click()
  await tapPlayer(page, ELF)
  await declare(page, 'Tackle')
  await hex(page, 11, 5).click()
  await page.locator('.board-prompt').getByRole('button', { name: 'Stay' }).click()
  await expectLog(page, 'Elves Lineman 1 is knocked down')
  // He lies there: the fall's last frame, for as long as he's down.
  await expect(token(page, ELF)).toHaveClass(/\bprone\b/)
  await expect(token(page, ELF).locator('[data-anim]')).toHaveAttribute('data-anim', 'falling')

  await expect(token(page, BLACK_ORC).locator('[data-anim]')).toHaveAttribute('data-anim', 'idle')
  expect(await seen(page, BLACK_ORC)).toEqual(['idle', 'blocking', 'idle'])
  // Pushed back and knocked down in one go: he falls, the fall taking the place of a stumble.
  expect(await seen(page, ELF)).toEqual(['idle', 'falling'])
})

test('the scorer celebrates his touchdown before the pitch is cleared (#208)', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 16, 9]])
  await setUp(page, [['Blitzer 1', 9, 5]])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLITZER)

  // Round 1: the Blitzer runs 8 hexes with the ball, Sprinting, and is winded.
  await tapPlayer(page, BLITZER)
  await action(page, 'Move').click()
  await hex(page, 17, 5).click()
  await expect(page.locator('.card.active')).toContainText('MA used 8 of 6')
  await page.locator('.play').getByRole('button', { name: 'End activation' }).click()
  await expect(token(page, BLITZER).locator('[data-anim]')).toHaveAttribute('data-anim', 'winded')
  await page.getByRole('button', { name: 'Wait', exact: true }).click()
  await expect(page.locator('[data-when]')).toContainText('Round 2')

  // Round 2: the Elves Wait; the Blitzer steps into the end zone.
  await page.getByRole('button', { name: 'Wait', exact: true }).click()
  await watch(page, [BLITZER])
  await tapPlayer(page, BLITZER)
  await action(page, 'Move').click()
  await hex(page, 18, 5).click()
  await expect(page.locator('[data-centre-banner]')).toContainText('Touchdown!')
  expect(await seen(page, BLITZER)).toEqual(expect.arrayContaining(['victory']))
})

test('a Shove: the attacker blocks, the player shoved stumbles and stands again (#208)', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 10, 5]])
  await setUp(page, [['Black Orc 1', 9, 5]])
  await hex(page, 1, 1).click()
  await tapPlayer(page, BLACK_ORC)
  await watch(page, [BLACK_ORC, ELF])

  await tapPlayer(page, BLACK_ORC)
  await action(page, 'Block').click()
  await tapPlayer(page, ELF)
  await declare(page, 'Shove')
  await hex(page, 11, 5).click()
  await page.locator('.board-prompt').getByRole('button', { name: 'Stay' }).click()
  await expectLog(page, 'Elves Lineman 1 is pushed to (11, 5)')
  await expect(token(page, ELF).locator('[data-anim]')).toHaveAttribute('data-anim', 'idle')
  await expect(token(page, BLACK_ORC).locator('[data-anim]')).toHaveAttribute('data-anim', 'idle')
  expect(await seen(page, BLACK_ORC)).toEqual(['idle', 'blocking', 'idle'])
  expect(await seen(page, ELF)).toEqual(['idle', 'stumbling', 'idle'])
})
