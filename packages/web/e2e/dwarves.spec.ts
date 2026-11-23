import { expect, type Page, test } from '@playwright/test'
import { action, ballLanded, expectLog, hex, tapPlayer, token } from './helpers'

// Rules v26 (#211): the Dwarves, with Thick Skull for the whole team, and
// a team must field 7 at setup (#200). A Troll Slayer's Frenzy (#213).

const SLAYER = 'home-troll-slayer-1'
const ELF = 'away-lineman-1'

/** Place the bench players on these hexes in turn: the named one first if given, then whoever is first on the bench. */
async function fill(page: Page, hexes: [number, number][], first?: string): Promise<void> {
  for (const [i, [col, row]] of hexes.entries()) {
    const bench = i === 0 && first ? page.locator('[data-bench]', { hasText: first }) : page.locator('[data-bench]').first()
    await bench.click()
    await hex(page, col, row).click()
  }
}

test('rules v26: the Dwarves at home against the Elves; 7 to field, Thick Skull for all, and a Frenzied Shove twice', async ({ page }) => {
  await page.goto('/')
  // v28 (#229) is the default now; the Dwarves came in v26.
  await expect(page.locator('#config')).toHaveValue('rules-v32')
  await page.selectOption('#config', 'rules-v26')
  await expect(page.locator('#home-team option')).toHaveText(['Orcs', 'Elves', 'Humans', 'Dwarves'])
  await page.selectOption('#home-team', 'dwarves')
  await page.selectOption('#away-team', 'elves')
  await page.getByRole('button', { name: 'Start match' }).click()
  await expect(page.locator('.setup h2')).toHaveText('Elves set up (kicking)')

  // The Elves: the Lineman opposite the Troll Slayer, the rest further back. Six aren't enough (#200).
  await fill(page, [[10, 5], [12, 3], [12, 4], [12, 6], [12, 7], [14, 5]], 'Lineman 1')
  const end = page.getByRole('button', { name: 'End setup' })
  await expect(end).toHaveAttribute('aria-disabled', 'true')
  await expect(end).toHaveAttribute('title', 'Set up 1 more player')
  await fill(page, [[14, 4]])
  await end.click()

  // The Dwarves: the Troll Slayer at (9,5), facing the Elf; his card shows the team trait.
  await fill(page, [[9, 5], [7, 3], [7, 4], [7, 6], [7, 7], [5, 5], [5, 4]], 'Troll Slayer 1')
  await expect(page.getByRole('button', { name: 'End setup' })).not.toHaveAttribute('aria-disabled', 'true')
  await page.getByRole('button', { name: 'End setup' }).click()
  // Kick out of bounds for a touchback; the Dwarves give the ball to a player at the back.
  await hex(page, 1, 1).click()
  await ballLanded(page)
  await tapPlayer(page, 'home-runner-1')

  await tapPlayer(page, SLAYER)
  await expect(page.locator('.card')).toContainText('Frenzy, Thick Skull (team)')
  await action(page, 'Block').click()
  await tapPlayer(page, ELF)
  const prompt = page.locator('.board-prompt')
  await expect(prompt).toContainText('Frenzy: blocks again if he stays up')
  await prompt.getByRole('button', { name: /^Shove/ }).click()
  // The Elf Lineman could Brace (hot-seat: his coach is asked); he doesn't.
  await page.locator('[data-kind="blocking.brace"]').getByRole('button', { name: "Don't brace" }).click()
  // First push straight back; he follows by himself, and blocks again: the second push.
  await hex(page, 11, 5).click()
  await expectLog(page, 'Frenzy: Dwarves Troll Slayer 1 blocks Elves Lineman 1 again')
  await hex(page, 12, 5).click()
  await expectLog(page, 'Elves Lineman 1 is pushed to (12, 5)')
  // Never asked to follow up: no Stay anywhere.
  await expect(page.getByRole('button', { name: 'Stay' })).toHaveCount(0)
  // Two hexes forward: the Troll Slayer stands on (11,5).
  const circle = (await token(page, SLAYER).locator('circle').boundingBox())!
  const target = (await hex(page, 11, 5).boundingBox())!
  expect(Math.abs(circle.x + circle.width / 2 - (target.x + target.width / 2))).toBeLessThan(3)
})
