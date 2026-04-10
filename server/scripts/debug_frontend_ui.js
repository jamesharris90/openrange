const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errs = [];
  const failed = [];
  const traced = [];

  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(`PAGEERROR:${e.message}`));
  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('/api/earnings') || url.includes('/earnings')) {
      traced.push(`${res.status()} ${url}`);
    }
    if (res.status() >= 400) {
      failed.push(`${res.status()} ${url}`);
    }
  });

  for (const p of ['/intelligence', '/earnings', '/research/AAPL']) {
    await page.goto(`http://localhost:3000${p}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(8500);
    const t = await page.evaluate(() => document.body?.innerText || '');
    console.log(`\n--- ${p} ---`);
    console.log('len', t.length);
    console.log('has Live Top Opportunities Feed', t.includes('Live Top Opportunities Feed'));
    console.log('has final_score', t.includes('final_score'));
    console.log('has Expected Move', t.includes('Expected Move'));
    console.log('has Report Date', t.includes('Report Date'));
    console.log('has Research Intelligence', t.includes('Research Intelligence'));
    console.log('has why_moving', t.includes('why_moving'));
    console.log(t.slice(0, 1200).replace(/\n/g, ' | '));
  }

  console.log('\nerror count', errs.length);
  console.log(errs.slice(0, 30).join('\n'));
  console.log('\nfailed responses', failed.length);
  console.log(failed.slice(0, 30).join('\n'));
  console.log('\ntraced earnings calls', traced.length);
  console.log(traced.slice(0, 40).join('\n'));
  await browser.close();
})();
