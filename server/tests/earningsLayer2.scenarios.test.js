const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { createRequire } = require('module');

function resolveImportPath(fromFile, request) {
  const base = path.resolve(path.dirname(fromFile), request);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.js`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.js'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function loadTsModule(filePath, mocks = {}, cache = new Map()) {
  if (cache.has(filePath)) return cache.get(filePath);

  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;

  const moduleLike = { exports: {} };
  cache.set(filePath, moduleLike.exports);

  const nodeRequire = createRequire(filePath);
  const customRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }

    if (request.startsWith('.')) {
      const resolved = resolveImportPath(filePath, request);
      if (resolved && Object.prototype.hasOwnProperty.call(mocks, resolved)) {
        return mocks[resolved];
      }
      if (resolved && resolved.endsWith('.ts')) {
        return loadTsModule(resolved, mocks, cache);
      }
      if (resolved) return nodeRequire(resolved);
    }

    return nodeRequire(request);
  };

  const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', transpiled);
  fn(customRequire, moduleLike, moduleLike.exports, path.dirname(filePath), filePath);
  cache.set(filePath, moduleLike.exports);
  return moduleLike.exports;
}

describe('Earnings Layer 2 deterministic scenarios', () => {
  const scoreEnginePath = path.join(__dirname, '../services/earnings/earningsScoreEngine.ts');

  function loadScoreEngineWithContinuation(continuationProbability, bias) {
    const continuationMock = {
      calculateContinuationProbability: jest.fn(async () => ({
        continuationProbability,
        bias,
      })),
    };

    const pgMock = {
      pool: {
        query: jest.fn(),
      },
    };

    return loadTsModule(scoreEnginePath, {
      '../../db/pg': pgMock,
      './layer2/continuationModel': continuationMock,
      [path.join(__dirname, '../services/earnings/layer2/continuationModel.ts')]: continuationMock,
    });
  }

  test('Test Case 1: Strong beat + strong reaction + aligned context -> A+ Continuation', async () => {
    const { calculateEarningsIntelligenceScore } = loadScoreEngineWithContinuation(82, 'HIGH');

    const event = {
      symbol: 'AAPL',
      report_date: '2026-02-20',
      eps_surprise_pct: 26,
      rev_surprise_pct: 16,
      guidance_direction: 'raised',
    };

    const reaction = {
      actual_move_pct: 8,
      implied_move_pct: 4,
      move_vs_implied_ratio: 2,
      high_of_day_pct: 8,
      close_pct: 7,
      volume_vs_avg: 2.4,
      day2_followthrough_pct: 4.1,
      open_gap_pct: 5,
    };

    const context = {
      newsScore: 30,
      sectorStrength: 1.4,
      spyBias: 'bullish analyst_upgrade',
    };

    const result = await calculateEarningsIntelligenceScore(event, reaction, context);

    expect(result.baseScore).toBe(80);
    expect(result.layer2Score).toBe(45);
    expect(result.totalScore).toBe(100);
    expect(result.tier).toBe('A+ Continuation');
    expect(result.continuationBias).toBe('HIGH');
  });

  test('Test Case 2: Strong beat + fade reaction + negative context -> downgraded tier', async () => {
    const { calculateEarningsIntelligenceScore } = loadScoreEngineWithContinuation(35, 'LOW');

    const event = {
      symbol: 'MSFT',
      report_date: '2026-02-20',
      eps_surprise_pct: 24,
      rev_surprise_pct: 14,
      guidance_direction: 'raised',
    };

    const reaction = {
      actual_move_pct: 4,
      implied_move_pct: 2,
      move_vs_implied_ratio: 2,
      high_of_day_pct: 10,
      close_pct: 3,
      volume_vs_avg: 1.2,
      day2_followthrough_pct: 1,
      open_gap_pct: 10,
    };

    const context = {
      newsScore: 10,
      sectorStrength: -0.8,
      spyBias: 'bearish',
    };

    const result = await calculateEarningsIntelligenceScore(event, reaction, context);

    expect(result.baseScore).toBe(80);
    expect(result.layer2Score).toBe(-10);
    expect(result.totalScore).toBe(70);
    expect(result.tier).toBe('A Setup');
    expect(result.tier).not.toBe('A+ Continuation');
  });

  test('Test Case 3: Weak beat + strong continuation history -> moderate continuationBias', async () => {
    const { calculateEarningsIntelligenceScore } = loadScoreEngineWithContinuation(55, 'MEDIUM');

    const event = {
      symbol: 'NVDA',
      report_date: '2026-02-20',
      eps_surprise_pct: 1,
      rev_surprise_pct: 2,
      guidance_direction: null,
    };

    const reaction = {
      actual_move_pct: 1,
      implied_move_pct: 1.5,
      move_vs_implied_ratio: 0.9,
      high_of_day_pct: 2,
      close_pct: 1,
      volume_vs_avg: 1,
      day2_followthrough_pct: 0.5,
      open_gap_pct: 1.5,
    };

    const context = {
      newsScore: 8,
      sectorStrength: 0.2,
      spyBias: 'neutral',
    };

    const result = await calculateEarningsIntelligenceScore(event, reaction, context);

    expect(result.baseScore).toBe(0);
    expect(result.layer2Score).toBe(0);
    expect(result.totalScore).toBe(0);
    expect(result.continuationProbability).toBe(55);
    expect(result.continuationBias).toBe('MEDIUM');
  });
});
