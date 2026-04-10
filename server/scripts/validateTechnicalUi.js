#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { chromium } = require('playwright');

const API_URL = 'http://127.0.0.1:3007/api/research/AAPL/full';
const PAGE_URL = 'http://127.0.0.1:3000/research/AAPL';
const OUTPUT_PATH = path.resolve(__dirname, '..', '..', 'TECHNICAL_UI_REPORT.json');

async function measureApiPasses() {
  const passes = [];
  for (let index = 1; index <= 3; index += 1) {
    const startedAt = Date.now();
    const response = await fetch(API_URL, { headers: { Accept: 'application/json' } });
    const payload = await response.json();
    passes.push({
      pass: index,
      status: response.status,
      elapsed_ms: Date.now() - startedAt,
      response_meta_total_ms: payload?.meta?.total_ms ?? null,
      cached_flag: payload?.meta?.cached ?? null,
      indicator_rows_1min: Array.isArray(payload?.indicators?.panels?.['1min']) ? payload.indicators.panels['1min'].length : null,
    });
  }
  return passes;
}

async function getCrosshairX(locator) {
  return locator.evaluate((element) => {
    const line = element.querySelector('line[stroke-dasharray="4 4"]');
    if (!line) return null;
    const x1 = Number(line.getAttribute('x1'));
    return Number.isFinite(x1) ? x1 : null;
  });
}

async function getPageBox(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x + window.scrollX,
      y: rect.y + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
  });
}

async function hoverInteractiveBand(svgLocator, position = 0.5) {
  const bands = svgLocator.locator('rect[fill="transparent"]');
  const bandCount = await bands.count();
  if (bandCount === 0) {
    throw new Error('interactive_band_not_found');
  }

  const targetIndex = Math.min(
    bandCount - 1,
    Math.max(0, Math.floor((bandCount - 1) * position))
  );

  const targetBand = bands.nth(targetIndex);
  const box = await targetBand.boundingBox();
  if (!box) {
    throw new Error('interactive_band_box_not_found');
  }

  const page = svgLocator.page();
  await page.mouse.move(box.x + (box.width / 2), box.y + (box.height / 2));
}

async function largeSvgLocator(page, order) {
  const indices = await page.locator('svg').evaluateAll((elements) => {
    return elements
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        return {
          index,
          width: rect.width,
          height: rect.height,
          y: rect.y,
        };
      })
      .filter((entry) => entry.width > 500 && entry.height > 100)
      .sort((left, right) => left.y - right.y)
      .map((entry) => entry.index);
  });

  const targetIndex = indices[order];
  if (targetIndex === undefined) {
    throw new Error(`large_svg_not_found_${order}`);
  }

  return page.locator('svg').nth(targetIndex);
}

async function run() {
  const apiPasses = await measureApiPasses();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  const requests = [];

  page.on('request', (request) => {
    requests.push(request.url());
  });

  await page.goto(PAGE_URL, { waitUntil: 'networkidle', timeout: 120000 });
  await page.getByRole('button', { name: 'Fundamentals' }).click();
  await page.getByText('Technical Indicators').waitFor({ timeout: 30000 });

  const mainChartSvg = await largeSvgLocator(page, 0);
  await mainChartSvg.scrollIntoViewIfNeeded();
  const chartBoxBefore = await getPageBox(mainChartSvg);

  const requestCountBeforeToggle = requests.length;
  const volumeToggle = page.getByRole('button', { name: /show volume/i });
  const macdToggle = page.getByRole('button', { name: /show macd/i });

  const volumeToggleStartedAt = Date.now();
  await volumeToggle.click();
  await page.getByText('Volume Panel').waitFor({ timeout: 30000 });
  const volumeToggleMs = Date.now() - volumeToggleStartedAt;

  const macdToggleStartedAt = Date.now();
  await macdToggle.click();
  await page.getByText('MACD Panel').waitFor({ timeout: 30000 });
  const macdToggleMs = Date.now() - macdToggleStartedAt;

  const chartBoxAfter = await getPageBox(mainChartSvg);
  const requestCountAfterToggle = requests.length;
  const toggleTriggeredRequests = requests.slice(requestCountBeforeToggle, requestCountAfterToggle);

  const volumeSvg = await largeSvgLocator(page, 1);
  const macdSvg = await largeSvgLocator(page, 2);
  await volumeSvg.scrollIntoViewIfNeeded();
  await hoverInteractiveBand(volumeSvg, 0.5);
  await page.waitForTimeout(120);
  const chartCrosshairFromVolume = await getCrosshairX(mainChartSvg);
  const volumeCrosshair = await getCrosshairX(volumeSvg);

  await macdSvg.scrollIntoViewIfNeeded();
  await hoverInteractiveBand(macdSvg, 0.5);
  await page.waitForTimeout(120);
  const chartCrosshairFromMacd = await getCrosshairX(mainChartSvg);
  const macdCrosshair = await getCrosshairX(macdSvg);

  const report = {
    generated_at: new Date().toISOString(),
    api_passes: apiPasses,
    ui: {
      page_url: PAGE_URL,
      chart_box_before: chartBoxBefore,
      chart_box_after: chartBoxAfter,
      chart_layout_shift_px: chartBoxBefore && chartBoxAfter
        ? {
            x: Math.abs(chartBoxAfter.x - chartBoxBefore.x),
            y: Math.abs(chartBoxAfter.y - chartBoxBefore.y),
            width: Math.abs(chartBoxAfter.width - chartBoxBefore.width),
            height: Math.abs(chartBoxAfter.height - chartBoxBefore.height),
          }
        : null,
      toggle_latency_ms: {
        volume: volumeToggleMs,
        macd: macdToggleMs,
      },
      toggle_network_requests: toggleTriggeredRequests,
      cursor_sync: {
        chart_from_volume_x: chartCrosshairFromVolume,
        volume_x: volumeCrosshair,
        chart_from_macd_x: chartCrosshairFromMacd,
        macd_x: macdCrosshair,
      },
    },
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

run().catch((error) => {
  const report = {
    generated_at: new Date().toISOString(),
    ok: false,
    error: error.message,
  };
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
});