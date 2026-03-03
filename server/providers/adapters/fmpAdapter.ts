// @ts-nocheck
import {
  CanonicalQuote
} from "../../schema/canonical/CanonicalQuote";

import {
  CanonicalNewsItem
} from "../../schema/canonical/CanonicalNewsItem";

import {
  CanonicalEarnings
} from "../../schema/canonical/CanonicalEarnings";

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadRvolService() {
  const servicePath = path.join(__dirname, '../../services/rvolService.ts');
  const source = fs.readFileSync(servicePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: servicePath,
  }).outputText;

  const moduleLike = { exports: {} };
  const exportsLike = moduleLike.exports;
  const fn = new Function('require', 'module', 'exports', transpiled);
  fn(require, moduleLike, exportsLike);

  return {
    calculateRelativeVolume: moduleLike.exports.calculateRelativeVolume,
    calculateCompositeRvol: moduleLike.exports.calculateCompositeRvol,
    safeNumber: moduleLike.exports.safeNumber,
  };
}

const {
  calculateCompositeRvol,
  safeNumber,
} = loadRvolService();

export function mapFmpQuoteToCanonical(raw: any): CanonicalQuote {
  const item = raw ?? {};
  const price = item.price ?? 0;
  const previousClose = item.previousClose ?? item.prevClose ?? 0;
  const change = item.change ?? (previousClose > 0 ? price - previousClose : 0);
  const changePercent = item.changesPercentage ?? item.changePercentage ?? item.changePercent ?? (previousClose > 0 ? (change / previousClose) * 100 : 0);
  const volume = item.volume ?? 0;
  const avgVolume = item.avgVolume ?? null;
  const marketCap = item.marketCap ?? null;
  const float = item.sharesOutstanding ?? item.sharesFloat ?? null;
  const fmpRvol = item.rvol ?? item.relativeVolume ?? null;

  const { value, confidence } = calculateCompositeRvol({
    volume: safeNumber(volume),
    avgVolume: avgVolume == null ? null : safeNumber(avgVolume),
    fmpRvol: fmpRvol == null ? null : safeNumber(fmpRvol),
    altSources: [],
  });

  return {
    symbol: String(item.symbol || ''),

    price: safeNumber(price),
    change: safeNumber(change),
    changePercent: safeNumber(changePercent),
    volume: safeNumber(volume),

    avgVolume: avgVolume == null ? null : safeNumber(avgVolume),
    rvol: value,
    rvolConfidence: confidence || 'LOW',
    marketCap: marketCap == null ? null : safeNumber(marketCap),
    float: float == null ? null : safeNumber(float),
    gapPercent: null,
    premarketVolume: null,

    timestamp: new Date().toISOString(),
    source: "FMP",

    providerProvenance: {
      primary: "fmp",
      fields: {
        price: "fmp.quote.price",
        change: "fmp.quote.change",
        changePercent: "fmp.quote.changesPercentage",
        volume: "fmp.quote.volume",
        avgVolume: "fmp.quote.avgVolume",
        marketCap: "fmp.quote.marketCap",
        float: "fmp.quote.sharesFloat"
      },
      fetchedAt: new Date().toISOString()
    }
  };
}

export function mapFmpNewsToCanonical(raw: any): CanonicalNewsItem {
  const item = raw || {};

  return {
    id: `fmp:${item.symbol ?? "unknown"}:${item.publishedDate ?? Date.now()}`,
    headline: item.title ?? "",
    summary: item.text ?? undefined,
    source: item.site ?? "unknown",
    publishedAt: item.publishedDate
      ? new Date(item.publishedDate).toISOString()
      : new Date().toISOString(),
    url: item.url ?? undefined,

    tickers: item.symbol ? [item.symbol] : [],

    providerProvenance: {
      primary: "fmp",
      fields: {
        headline: "fmp.news.title",
        summary: "fmp.news.text",
        tickers: "fmp.news.symbol"
      },
      fetchedAt: new Date().toISOString()
    }
  };
}

export function mapFmpEarningsToCanonical(raw: any): CanonicalEarnings {
  const item = raw || {};

  return {
    symbol: String(item.symbol || ''),
    earningsDate: item.date
      ? new Date(item.date).toISOString()
      : new Date().toISOString(),
    eps: item.eps ? Number(item.eps) : undefined,
    revenue: item.revenue ? Number(item.revenue) : undefined,
    surprise: item.surprise ? Number(item.surprise) : undefined,
    guidance: item.guidance ?? "unknown",

    providerProvenance: {
      primary: "fmp",
      fields: {
        eps: "fmp.earnings.eps",
        revenue: "fmp.earnings.revenue",
        surprise: "fmp.earnings.surprise"
      },
      fetchedAt: new Date().toISOString()
    }
  };
}
