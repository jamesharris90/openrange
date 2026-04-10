const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE_ERROR', m.text());
  });

  await page.goto('http://localhost:3000/earnings', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(22000);
  const t = await page.evaluate(() => (document.body?.innerText || ''));
  console.log('len', t.length);
  console.log('hasExpectedMove', t.toUpperCase().includes('EXPECTED MOVE'));
  console.log('hasReportDate', t.toUpperCase().includes('REPORT DATE'));
  console.log(t.slice(0, 2000).replace(/\n/g, ' | '));

  await browser.close();
})();
