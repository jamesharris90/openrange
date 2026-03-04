const fs = require('fs');
const path = require('path');

const DEFAULT_SCORING_RULES = {
  strategy: {
    gap_go: {
      gap_percent: 3,
      relative_volume: 2,
      float_rotation: 0.05,
    },
    vwap_reclaim: {
      relative_volume: 1.5,
    },
    momentum_continuation: {
      relative_volume: 3,
      gap_percent: 2,
    },
  },
  grading: {
    A: 15,
    B: 10,
    C: 6,
  },
  catalyst_scores: {
    earnings: 5,
    fda: 6,
    analyst_upgrade: 4,
    general_news: 2,
  },
};

const DEFAULT_FILTER_REGISTRY = {
  filters: [
    'price',
    'market_cap',
    'gap_percent',
    'relative_volume',
    'atr',
    'rsi',
    'float',
    'sector',
    'country',
    'vwap',
    'structure',
    'min_grade',
    'spy_alignment',
  ],
};

const scoringPath = path.join(__dirname, 'scoring_rules.json');
const filterPath = path.join(__dirname, 'filter_registry.json');

let scoringLoaded = false;
let filterLoaded = false;
let scoringCache = DEFAULT_SCORING_RULES;
let filterCache = DEFAULT_FILTER_REGISTRY;
let scoringCacheReady = false;
let filterCacheReady = false;

function readJsonOrDefault(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return { data: parsed, loaded: true };
  } catch {
    return { data: fallback, loaded: false };
  }
}

function getScoringRules() {
  if (!scoringCacheReady) {
    const { data, loaded } = readJsonOrDefault(scoringPath, DEFAULT_SCORING_RULES);
    scoringLoaded = loaded;
    scoringCache = data;
    scoringCacheReady = true;
  }

  return scoringCache;
}

function getFilterRegistry() {
  if (!filterCacheReady) {
    const { data, loaded } = readJsonOrDefault(filterPath, DEFAULT_FILTER_REGISTRY);
    filterLoaded = loaded;
    filterCache = data;
    filterCacheReady = true;
  }

  return filterCache;
}

function getConfigLoadStatus() {
  getScoringRules();
  getFilterRegistry();
  return {
    scoring_config_loaded: scoringLoaded,
    filter_registry_loaded: filterLoaded,
  };
}

module.exports = {
  getScoringRules,
  getFilterRegistry,
  getConfigLoadStatus,
  DEFAULT_SCORING_RULES,
  DEFAULT_FILTER_REGISTRY,
};
