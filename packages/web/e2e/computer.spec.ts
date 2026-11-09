import { expect, test } from '@playwright/test'
import { hex, inLog, setUp } from './helpers'

// Against the computer (#62): the computer plays the Orcs at Novice and the
// test plays the Elves as simply as it can (two players, kick anywhere, Wait
// every go) until the computer has activated players and logged its reasons.

test('play against the computer at Novice', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await page.selectOption('#config', 'rules-v12')
  await page.selectOption('#opponent', 'novice')
  await page.selectOption('#computer-team', 'home')
  await page.fill('#seed', '1')
  await page.getByRole('button', { name: 'Start match' }).click()
  await expect(page.locator('.team.home')).toContainText('(computer)')
  await expect(page.locator('#undo')).toHaveAttribute('aria-disabled', 'true')
  await expect(page.locator('#undo')).toHaveAttribute('title', 'Undo isn’t available in a match against the computer')

  const ORC_ACTIVATION = /^Orcs .+: (Move|Block|Blitz|Pass|Hand-off|Foul)$/
  // The log is closed by default (#127): count the Orcs' activations in it now and then.
  const orcActivations = async () => {
    let n = 0
    await inLog(page, async (lines) => {
      n = await lines.locator('li', { hasText: ORC_ACTIVATION }).count()
    })
    return n
  }
  const computerTurn = page.locator('[data-computer-turn]')
  let sawComputerTurn = false

  for (let i = 0; i < 200 && (i % 10 !== 0 || (await orcActivations()) < 3); i++) {
    if (await computerTurn.isVisible()) {
      sawComputerTurn = true
      // The page answers while the computer thinks: it thinks in a worker.
      const before = Date.now()
      await page.evaluate(() => document.title)
      expect(Date.now() - before).toBeLessThan(1_000)
      await page.waitForTimeout(200)
      continue
    }
    const onBoard = page.locator('.board-prompt button').first()
    const inPanel = page.locator('.decision button').first()
    if (await onBoard.isVisible()) await onBoard.click()
    else if (await inPanel.isVisible()) await inPanel.click()
    else if (await page.locator('.setup h2').isVisible()) {
      await setUp(page, [
        ['Lineman 1', 12, 5],
        ['Catcher 1', 14, 3],
      ])
    } else if (await page.getByText('Tap a highlighted hex in the receiving team’s half').isVisible()) await hex(page, 5, 5).click()
    else if (await page.getByRole('button', { name: 'Wait', exact: true }).isVisible()) await page.getByRole('button', { name: 'Wait', exact: true }).click()
    else await page.waitForTimeout(200)
  }

  expect(sawComputerTurn).toBe(true)
  await inLog(page, async (lines) => {
    await expect(lines.locator('li', { hasText: ORC_ACTIVATION })).not.toHaveCount(0)
    const reasons = lines.locator('li.reason')
    await expect(reasons.first()).toContainText('Computer: ')
    // Player ids read as names in the reasons, as in the rest of the log.
    expect((await reasons.allTextContents()).join(' ')).not.toMatch(/\bhome-[a-z-]+-\d/)
  })
})

test('a reload during the computer’s go carries on where it was', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.selectOption('#config', 'rules-v12')
  await page.selectOption('#opponent', 'novice')
  await page.selectOption('#computer-team', 'home')
  await page.fill('#seed', '1')
  await page.getByRole('button', { name: 'Start match' }).click()
  // Seed 1: the Elves (the human) win the toss. Receiving, they let the computer kick, so it sets up first.
  await page.locator('.decision').getByRole('button', { name: 'Receive' }).click()
  await expect(page.locator('[data-computer-turn]')).toBeVisible()
  // Reload once the computer has placed its first Orc, partway through its setup.
  await expect(page.locator('[data-player^="home-"]').first()).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-player^="home-"]').first()).toBeVisible()
  await expect(page.locator('.team.home')).toContainText('(computer)')
  await expect(page.locator('#undo')).toHaveAttribute('aria-disabled', 'true')
  // The computer finishes its setup after the reload and the log shows it.
  await expect(page.locator('[data-log-ticker]')).toContainText(/Orcs have set up|Computer: /, { timeout: 30_000 })
  await expect(page.locator('[data-computer-turn]')).toBeHidden({ timeout: 30_000 })
  await inLog(page, async (lines) => {
    await expect(lines.locator('li', { hasText: 'Orcs have set up' })).toBeVisible()
    await expect(lines.locator('li.reason').first()).toBeVisible()
  })
})

test('the computer waits while the match log is open (#127)', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.selectOption('#config', 'rules-v12')
  await page.selectOption('#opponent', 'novice')
  await page.selectOption('#computer-team', 'home')
  await page.fill('#seed', '1')
  await page.getByRole('button', { name: 'Start match' }).click()
  // Seed 1: the Elves (the human) win the toss. Receiving, they let the computer kick, so it sets up first.
  await page.locator('.decision').getByRole('button', { name: 'Receive' }).click()
  await page.locator('#log-button').click()
  const placed = page.locator('[data-player^="home-"]')
  const before = await placed.count()
  await page.waitForTimeout(3_000)
  // Nothing more placed behind the log, at most the one it was already sending.
  expect(await placed.count()).toBeLessThanOrEqual(before + 1)
  const held = await placed.count()
  await page.waitForTimeout(1_500)
  expect(await placed.count()).toBe(held)
  await page.locator('#log-close').click()
  await expect(placed).not.toHaveCount(held, { timeout: 15_000 })
})
