const { chromium } = require('playwright');
const fs = require('fs/promises');
const path = require('path');

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickTab(page, label) {
  const button = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
  await button.waitFor({ state: 'visible', timeout: 15000 });
  await button.click();
  await wait(1200);
}

async function collectMutedDashSignals(page) {
  return page.evaluate(() => {
    const textNodes = Array.from(document.querySelectorAll('div, span, p, button'));
    const dashNodes = textNodes.filter((node) => node.textContent && node.textContent.trim() === '—');
    const mutedDashNodes = dashNodes.filter((node) => {
      const className = node.getAttribute('class') || '';
      return className.includes('text-slate-500') || className.includes('text-slate-600');
    });

    const bodyText = document.body.innerText || '';
    return {
      dashCount: dashNodes.length,
      mutedDashCount: mutedDashNodes.length,
      hasLegacyTimeUnavailable: bodyText.includes('Time unavailable'),
      hasLegacyEstimating: bodyText.includes('Estimating'),
      hasLegacyNotAvailable: bodyText.includes('Not available'),
      hasLegacyPending: bodyText.includes('Pending'),
      bodySample: bodyText.slice(0, 1200),
    };
  });
}

async function visibleTabLabels(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('button'))
      .map((button) => (button.textContent || '').trim())
      .filter((text) => ['Overview', 'Technical', 'Fundamentals', 'Earnings', 'Flow & Score'].includes(text));
  });
}

async function main() {
  const outDir = path.resolve('/Users/jamesharris/Server/logs/smoke');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 2200 }, deviceScaleFactor: 1 });

  await page.goto('http://127.0.0.1:3000/research/AAPL', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  const tabs = await visibleTabLabels(page);

  await page.screenshot({ path: path.join(outDir, 'research-aapl-overview.png'), fullPage: true });
  const overview = await collectMutedDashSignals(page);

  await clickTab(page, 'Earnings');
  await page.screenshot({ path: path.join(outDir, 'research-aapl-earnings.png'), fullPage: true });
  const earnings = await collectMutedDashSignals(page);

  await clickTab(page, 'Flow & Score');
  await page.screenshot({ path: path.join(outDir, 'research-aapl-flow.png'), fullPage: true });
  const flow = await collectMutedDashSignals(page);

  const result = {
    generated_at: new Date().toISOString(),
    url: 'http://127.0.0.1:3000/research/AAPL',
    tabs,
    overview,
    earnings,
    flow,
    screenshots: {
      overview: path.join(outDir, 'research-aapl-overview.png'),
      earnings: path.join(outDir, 'research-aapl-earnings.png'),
      flow: path.join(outDir, 'research-aapl-flow.png'),
    },
  };

  await fs.writeFile(path.join(outDir, 'research-smoke-report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
