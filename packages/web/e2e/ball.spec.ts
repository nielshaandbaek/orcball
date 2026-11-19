import { expect, test } from '@playwright/test'
import { action, ballLanded, expectLog, hex, setUp, startWithElvesKicking, tapPlayer } from './helpers'

// The ball in the air (#171): a pass flies from the thrower to the target,
// with its shadow on the pitch, once it has left his hands.

const THROWER = 'home-thrower-1'

test('a pass flies once it leaves his hands, its shadow on the pitch; a failed one straight to where its scatters end (#171)', async ({ page }) => {
  await startWithElvesKicking(page)
  await setUp(page, [['Lineman 1', 16, 9]])
  await setUp(page, [
    ['Thrower 1', 5, 5],
    ['Lineman 1', 8, 5],
  ])
  await hex(page, 1, 1).click()
  // Touchback: the Thrower gets the ball.
  await tapPlayer(page, THROWER)
  await page.evaluate(() => {
    const seen: string[] = []
    ;(window as unknown as { phases: string[] }).phases = seen
    new MutationObserver(() => {
      const flight = document.querySelector('[data-ball-phase]')
      const note = flight ? `${flight.getAttribute('data-ball-phase')}${flight.querySelector('.ball-shadow') ? '+shadow' : ''}` : 'rest'
      if (seen.at(-1) !== note) seen.push(note)
    }).observe(document.querySelector('svg.board')!, { subtree: true, attributes: true, childList: true })
  })

  await tapPlayer(page, THROWER)
  await action(page, 'Pass').click()
  await page.locator('.play').getByRole('button', { name: 'Aim pass' }).click()
  // Aimed at the Lineman: a tap on him.
  await tapPlayer(page, 'home-lineman-1')
  await page.locator('.board-prompt').getByRole('button', { name: /^Pass \(/ }).click()
  // Seed 1: the pass fails and a Momentum re-roll is offered. The ball stays in his hands meanwhile.
  await expect(page.locator('.board-prompt')).toContainText('Re-roll')
  expect(await page.evaluate(() => (window as unknown as { phases: string[] }).phases)).toEqual(['rest'])
  // Taking the failure: the inaccurate pass scatters in the air, so it flies straight to where the scatters end.
  await page.locator('.board-prompt').getByRole('button', { name: 'Accept the result' }).click()
  await expect(page.locator('[data-ball-phase="flight"]')).toHaveCount(1)
  await ballLanded(page)
  await expectLog(page, 'The ball scatters')
  const phases = await page.evaluate(() => (window as unknown as { phases: string[] }).phases)
  expect(phases[1]).toBe('flight+shadow')
  // One flight, not a flight and then hops along the scatters.
  expect(phases.filter((p) => p.startsWith('flight'))).toHaveLength(1)
  expect(phases.indexOf('flight+shadow')).toBe(1)
  expect(phases.at(-1)).toBe('rest')
})
