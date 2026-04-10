const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUTPUT_PATH = path.join(__dirname, 'research_ui_validation.json');
const SCREENSHOT_PATH = path.join(__dirname, 'research_ui_validation.png');
const URL = 'http://127.0.0.1:3000/research/INTC';
const EDGE_READ = 'Mixed earnings behavior with uneven post-print reaction. No reliable edge.';
const EDGE_READ_FRAGMENT = 'uneven post-print reaction';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } });
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const failedResponses = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  page.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || 'request failed',
    });
  });

  page.on('response', async (response) => {
    if (response.status() >= 500) {
      failedResponses.push({
        url: response.url(),
        status: response.status(),
      });
    }
  });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

  const bodyText = await page.locator('body').innerText();
  const pageTitle = await page.title();
  let earningsText = '';
  let fundamentalsText = '';
  let flowText = '';
  let hasVisibleEventRead = false;
  let hasVisibleDividendYield = false;
  let hasVisibleOptionsFlow = false;

  const earningsTab = page.locator('button').filter({ hasText: /^Earnings$/ }).last();
  if (await earningsTab.count()) {
    await earningsTab.click();
    await page.waitForSelector('text=Event Read', { timeout: 10000 });
    await page.waitForTimeout(1000);
    earningsText = await page.locator('body').innerText();
    hasVisibleEventRead = await page.getByText(EDGE_READ_FRAGMENT).isVisible().catch(() => false);
  }

  const fundamentalsTab = page.locator('button').filter({ hasText: /^Fundamentals$/ }).last();
  if (await fundamentalsTab.count()) {
    await fundamentalsTab.click();
    await page.waitForSelector('text=Valuation & Quality', { timeout: 10000 });
    fundamentalsText = await page.locator('body').innerText();
    hasVisibleDividendYield = await page.getByText('Dividend Yield %', { exact: true }).isVisible().catch(() => false);
  }

  const flowTab = page.locator('button').filter({ hasText: /^Flow & Score$/ }).last();
  if (await flowTab.count()) {
    await flowTab.click();
    await page.waitForSelector('text=Options Flow', { timeout: 10000 }).catch(() => null);
    flowText = await page.locator('body').innerText();
    hasVisibleOptionsFlow = await page.getByText('Options Flow', { exact: true }).isVisible().catch(() => false);
  }

  const summary = await page.evaluate(() => {
    const textNodes = Array.from(document.querySelectorAll('*'));
    const ladderAnchor = textNodes.find((node) => node.textContent && node.textContent.includes('Price Ladder'));
    const ladderText = ladderAnchor?.parentElement?.innerText || null;
    return { ladderText };
  });

  const report = {
    generated_at: new Date().toISOString(),
    url: URL,
    title: pageTitle,
    console_error_count: consoleErrors.length,
    page_error_count: pageErrors.length,
    has_event_read_fallback: hasVisibleEventRead || earningsText.includes(EDGE_READ) || earningsText.includes(EDGE_READ_FRAGMENT),
    has_dividend_yield_label: hasVisibleDividendYield || fundamentalsText.includes('Dividend Yield %'),
    has_dividend_yield_value: fundamentalsText.includes('0.00%'),
    has_options_put_call_ratio: hasVisibleOptionsFlow || flowText.includes('Put/Call Ratio'),
    body_length: bodyText.length,
    body_excerpt: bodyText.slice(0, 2000),
    earnings_excerpt: earningsText.slice(0, 2000),
    fundamentals_excerpt: fundamentalsText.slice(0, 2000),
    flow_excerpt: flowText.slice(0, 2000),
    ladder_text: summary.ladderText,
    console_errors: consoleErrors,
    page_errors: pageErrors,
    failed_requests: failedRequests,
    failed_responses: failedResponses,
    screenshot_path: SCREENSHOT_PATH,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await browser.close();

  if (
    report.console_error_count > 0
    || report.page_error_count > 0
    || !report.has_event_read_fallback
    || !report.has_dividend_yield_label
    || !report.has_options_put_call_ratio
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const report = {
    generated_at: new Date().toISOString(),
    url: URL,
    ok: false,
    error: error.message,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.error(error);
  process.exit(1);
});