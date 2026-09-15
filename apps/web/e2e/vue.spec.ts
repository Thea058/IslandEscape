import { test, expect } from '@playwright/test'

test('shows the Kowloon Walled City title screen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'KOWLOON WALLED CITY' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'NEW GAME' })).toBeVisible()
  await expect(page.getByText('How to play')).toBeVisible()
})
