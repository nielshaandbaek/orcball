import { expect, test } from '@playwright/test'
import { setUp, token } from './helpers'

// Picking the teams on the start screen (#192): v24 adds the Humans.

test('rules v24: the Humans at home against the Orcs, with their own sprites', async ({ page }) => {
  await page.goto('/')
  // The newest rules are the default.
  await expect(page.locator('#config')).toHaveValue('rules-v27')
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
