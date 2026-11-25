import { expect, test } from '@playwright/test'
import { hex, setUp, token } from './helpers'

// Picking the teams on the start screen (#192): v24 adds the Humans.

test('rules v24: the Humans at home against the Orcs, with their own sprites', async ({ page }) => {
  await page.goto('/')
  // The newest rules are the default.
  await expect(page.locator('#config')).toHaveValue('rules-v33')
  await page.selectOption('#config', 'rules-v24')
  await expect(page.locator('#home-team option')).toHaveText(['Orcs', 'Elves', 'Humans'])
  await page.selectOption('#home-team', 'humans')
  await page.selectOption('#away-team', 'orcs')
  await page.getByRole('button', { name: 'Start match' }).click()
  // No coin toss since v23: the away team (Orcs) sets up to kick.
  await expect(page.locator('.setup h2')).toHaveText('Orcs set up (kicking)')
  await expect(page.getByRole('banner')).toContainText('Humans')
  // The Orcs set up on their side, then a Human Lineman opposite: the Humans in red at home,
  // the Orcs in blue (#208).
  await setUp(page, [['Lineman 1', 10, 5]])
  await setUp(page, [['Lineman 1', 9, 5]])
  await expect(token(page, 'home-lineman-1').locator('image')).toHaveAttribute('href', /sprites\/humans\/red\/lineman\.png/)
  await expect(token(page, 'away-lineman-1').locator('image')).toHaveAttribute('href', /sprites\/orcs\/blue\/lineman\.png/)
})

test('rules with two teams still offer just the two', async ({ page }) => {
  await page.goto('/')
  await page.selectOption('#config', 'rules-v21')
  await expect(page.locator('#home-team option')).toHaveText(['Orcs', 'Elves'])
  await expect(page.locator('#home-team')).toHaveValue('orcs')
  await expect(page.locator('#away-team')).toHaveValue('elves')
})

test('rules v24: the Elves at home play in their red sprites, the Humans away in blue (#208)', async ({ page }) => {
  await page.goto('/')
  await page.selectOption('#config', 'rules-v24')
  await page.selectOption('#home-team', 'elves')
  await page.selectOption('#away-team', 'humans')
  await page.getByRole('button', { name: 'Start match' }).click()
  await expect(page.locator('.setup h2')).toHaveText('Humans set up (kicking)')
  await setUp(page, [['Lineman 1', 10, 5]])
  await setUp(page, [['Lineman 1', 9, 5]])
  await expect(token(page, 'home-lineman-1').locator('image')).toHaveAttribute('href', /sprites\/elves\/red\/lineman\.png/)
  await expect(token(page, 'away-lineman-1').locator('image')).toHaveAttribute('href', /sprites\/humans\/blue\/lineman\.png/)
})

test('rules v30: the Lizards at home against the Amazons, in their own sprites, home in red (#237, #238)', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#home-team option')).toHaveText(['Orcs', 'Elves', 'Humans', 'Dwarves', 'Drow', 'Undead', 'Lizards', 'Amazons'])
  await page.selectOption('#home-team', 'lizards')
  await page.selectOption('#away-team', 'amazons')
  await page.getByRole('button', { name: 'Start match' }).click()
  await expect(page.locator('.setup h2')).toHaveText('Amazons set up (kicking)')
  // Seven a side to field (#200): the named player first, then whoever is first on the bench.
  const fill = async (hexes: [number, number][], first: string) => {
    for (const [i, [col, row]] of hexes.entries()) {
      await (i === 0 ? page.locator('[data-bench]', { hasText: first }) : page.locator('[data-bench]').first()).click()
      await hex(page, col, row).click()
    }
    await page.getByRole('button', { name: 'End setup' }).click()
  }
  await fill([[10, 5], [12, 3], [12, 4], [12, 6], [12, 7], [14, 5], [14, 4]], 'Lineman 1')
  await fill([[9, 5], [7, 3], [7, 4], [7, 6], [7, 7], [5, 5], [5, 4]], 'Warrior 1')
  await expect(token(page, 'home-warrior-1').locator('image')).toHaveAttribute('href', /sprites\/lizards\/red\/warrior\.png/)
  await expect(token(page, 'away-lineman-1').locator('image')).toHaveAttribute('href', /sprites\/amazons\/blue\/lineman\.png/)
})
