import { expect, test } from '@playwright/test'

// Fullscreen (#88). Desktop Chrome has the Fullscreen API, so the button toggles it.

test('the fullscreen button enters and leaves fullscreen, and follows Esc', async ({ page }) => {
  await page.goto('/')
  const button = page.locator('#fullscreen')
  await expect(button).toHaveText('Full screen')
  await expect(button).toHaveAttribute('aria-pressed', 'false')

  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(button).toHaveText('Exit full screen')
  expect(await page.evaluate(() => document.fullscreenElement !== null)).toBe(true)

  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true)

  // Leaving another way (Esc, a swipe) updates the button too.
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => document.exitFullscreen())
  await expect(button).toHaveText('Full screen')
})

test('on an iPhone the button explains Add to Home Screen instead', async ({ browser }) => {
  // An iPhone has no page fullscreen: no API, an iPhone user agent.
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' })
  const page = await context.newPage()
  await page.addInitScript(() => Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false }))
  await page.goto('/')
  await expect(page.locator('[data-fullscreen-hint]')).toHaveCount(0)
  await page.locator('#fullscreen').click()
  await expect(page.locator('[data-fullscreen-hint]')).toContainText('Add to Home Screen')
  await context.close()
})
