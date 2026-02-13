import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { parse } from 'csv-parse/sync';
import { Config, ReportJson, TickerInput } from '../models/types';
import {
  MockEarningsProvider,
  MockMarketDataProvider,
  MockNewsProvider,
} from '../providers/MockProviders';
import { runEngine } from './engine';
import { buildReportMd } from './report';

export async function runCli(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .option('input', {
      type: 'string',
      demandOption: true,
      desc: 'Path to input CSV or JSON file',
    })
    .option('config', {
      type: 'string',
      default: 'config/default-config.yaml',
      desc: 'Path to config JSON or YAML file',
    })
    .option('output', {
      type: 'string',
      default: 'output',
      desc: 'Output directory for report.md and report.json',
    })
    .help()
    .parse();

  const inputPath = path.resolve(argv.input);
  const configPath = path.resolve(argv.config);
  const outputDir = path.resolve(argv.output);

  const config = loadConfig(configPath);
  const tickers = loadTickers(inputPath);

  console.log(`Scanning ${tickers.length} tickers from ${path.basename(inputPath)} …`);

  const report = await runEngine(tickers, config, {
    news: new MockNewsProvider(),
    earnings: new MockEarningsProvider(),
    market: new MockMarketDataProvider(),
  });

  writeOutputs(report, outputDir);

  console.log(`✓ ${report.sessionInfo.tickersPassing} passed gate / ${report.sessionInfo.tickersScanned} scanned`);
  console.log(`  Tier 1: ${report.priority.tier1.map((t) => t.ticker).join(', ') || 'none'}`);
  console.log(`  Tier 2: ${report.priority.tier2.map((t) => t.ticker).join(', ') || 'none'}`);
  console.log(`  Tier 3: ${report.priority.tier3.map((t) => t.ticker).join(', ') || 'none'}`);
}

function loadConfig(filePath: string): Config {
  const raw = fs.readFileSync(filePath, 'utf-8');
  if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
    return yaml.load(raw) as Config;
  }
  return JSON.parse(raw) as Config;
}

function loadTickers(filePath: string): TickerInput[] {
  const raw = fs.readFileSync(filePath, 'utf-8');

  if (filePath.endsWith('.json')) {
    return JSON.parse(raw) as TickerInput[];
  }

  if (filePath.endsWith('.csv')) {
    const records = parse(raw, { columns: true, skip_empty_lines: true });
    return records.map((r: Record<string, string>) => ({
      ticker: r.ticker || r.Ticker,
      last: numberOrUndefined(r.last || r.Last),
      pmPrice: numberOrUndefined(r.pmPrice || r.PMPrice),
      pmChangePct: numberOrUndefined(r.pmChangePct || r.PMChangePct),
      pmVolume: numberOrUndefined(r.pmVolume || r.PMVolume),
      avgVolume: numberOrUndefined(r.avgVolume || r.AvgVolume),
      float: numberOrUndefined(r.float || r.Float),
      sector: r.sector || r.Sector,
      pmHigh: numberOrUndefined(r.pmHigh || r.PMHigh),
      pmLow: numberOrUndefined(r.pmLow || r.PMLow),
    }));
  }

  throw new Error('Unsupported input format — use .json or .csv');
}

function writeOutputs(report: ReportJson, outputDir: string): void {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const md = buildReportMd(
    report.sessionInfo,
    report.tickers,
    report.priority,
    report.actionPlan,
    report.stopConditions,
  );

  const mdPath = path.join(outputDir, 'report.md');
  const jsonPath = path.join(outputDir, 'report.json');

  fs.writeFileSync(mdPath, md, 'utf-8');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`Reports written to ${outputDir}/`);
}

function numberOrUndefined(val: unknown): number | undefined {
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}
