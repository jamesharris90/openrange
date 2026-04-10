const { test, expect } = require('@playwright/test');

test('Earnings page loads cleanly', async ({ page }) => {
  const consoleMessages = [];
  const errors = [];

  page.on('console', msg => {
    consoleMessages.push({
      type: msg.type(),
      text: msg.text(),
    });

    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  await page.goto('http://localhost:3000/earnings');

  // wait for data
  await page.waitForTimeout(2000);

  await expect(page).toHaveURL(/\/earnings/);

  if (errors.length > 0) {
    console.log('PLAYWRIGHT_CONSOLE_MESSAGES', JSON.stringify(consoleMessages, null, 2));
  }

  // FAIL if console errors
  expect(errors.length).toBe(0);

  const bodyText = await page.textContent('body');

  expect(bodyText).not.toContain('Error loading data');

  const hasData =
    bodyText.includes('CLASS A') ||
    bodyText.includes('No earnings data available');

  expect(hasData).toBeTruthy();
});
