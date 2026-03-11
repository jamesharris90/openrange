const FIELD_ACCESSORS = {
  price: 'price',
  market_cap: 'marketCap',
  float: 'float',
  volume: 'volume',
  relative_volume: 'relativeVolume',
  gap_percent: 'gapPercent',
  change_percent: 'changePercent',
  atr_percent: 'atrPct',
  expected_move: 'expectedMove',
  vwap_distance: 'vwapDistance',
  rsi: 'rsi',
  sma20_distance: 'sma20Distance',
  sma50_distance: 'sma50Distance',
  sma200_distance: 'sma200Distance',
  short_float: 'shortFloat',
  strategy_score: 'strategyScore',
  setup_type: 'setupType',
  catalyst_score: 'catalystScore',
  news_sentiment: 'newsSentiment',
  earnings_date: 'earningsDate',
};

function normalizeFieldName(fieldName = '') {
  const camelMap = {
    marketCap: 'market_cap',
    relativeVolume: 'relative_volume',
    gapPercent: 'gap_percent',
    changePercent: 'change_percent',
    atrPct: 'atr_percent',
    expectedMove: 'expected_move',
    vwapDistance: 'vwap_distance',
    sma20Distance: 'sma20_distance',
    sma50Distance: 'sma50_distance',
    sma200Distance: 'sma200_distance',
    shortFloat: 'short_float',
    strategyScore: 'strategy_score',
    setupType: 'setup_type',
    catalystScore: 'catalyst_score',
    newsSentiment: 'news_sentiment',
    earningsDate: 'earnings_date',
  };

  return camelMap[fieldName] || fieldName;
}

function toComparableDate(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  const stamp = date.getTime();
  return Number.isFinite(stamp) ? stamp : null;
}

function compareWithOperator(actual, operator, value) {
  if (actual == null) return false;

  if (operator === 'contains') {
    return String(actual).toLowerCase().includes(String(value ?? '').toLowerCase());
  }

  if (operator === 'equals') {
    return String(actual).toLowerCase() === String(value ?? '').toLowerCase();
  }

  if (operator === 'in') {
    if (!Array.isArray(value)) return false;
    return value.map((item) => String(item).toLowerCase()).includes(String(actual).toLowerCase());
  }

  const dateActual = toComparableDate(actual);
  const dateValue = toComparableDate(value);
  const isDateComparison = dateActual != null && (dateValue != null || (Array.isArray(value) && value.every((item) => toComparableDate(item) != null)));

  const numericActual = isDateComparison ? dateActual : Number(actual);
  const numericValue = isDateComparison ? dateValue : Number(value);

  if (!Number.isFinite(numericActual)) return false;

  if (operator === '>') return numericActual > numericValue;
  if (operator === '>=') return numericActual >= numericValue;
  if (operator === '<') return numericActual < numericValue;
  if (operator === '<=') return numericActual <= numericValue;

  if (operator === 'between') {
    if (!Array.isArray(value) || value.length < 2) return false;
    const [min, max] = value.map(Number);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return false;
    return numericActual >= min && numericActual <= max;
  }

  return false;
}

function toCondition(row) {
  if (!row || !row.field) return null;
  const conditionValue = row.operator === 'between' ? [row.value, row.valueTo] : row.value;
  return {
    field: normalizeFieldName(row.field),
    operator: row.operator || 'equals',
    value: conditionValue,
  };
}

function toApiCondition(row) {
  if (!row || !row.field) return null;
  const condition = {
    field: normalizeFieldName(row.field),
    operator: row.operator || 'equals',
    value: row.operator === 'between' ? [row.value, row.valueTo] : row.value,
  };

  if (condition.operator === 'between') {
    const [min, max] = Array.isArray(condition.value) ? condition.value : [];
    if (min == null || min === '' || max == null || max === '') return null;
  }

  if (condition.value == null || condition.value === '') return null;
  return condition;
}

export function buildQueryTree(filters = []) {
  const rows = Array.isArray(filters) ? filters : [];
  const first = toApiCondition(rows[0]);
  if (!first) return { AND: [] };

  let tree = first;
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const next = toApiCondition(row);
    if (!next) continue;
    const logic = String(row?.logic || row?.booleanOp || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND';
    tree = { [logic]: [tree, next] };
  }

  if (tree.field) {
    return { AND: [tree] };
  }

  return tree;
}

export function buildQueryTreeFromRows(rows = []) {
  const validRows = rows.map(toCondition).filter(Boolean);
  if (!validRows.length) {
    return { operator: 'AND', conditions: [] };
  }

  let tree = validRows[0];

  for (let index = 1; index < rows.length; index += 1) {
    const rawRow = rows[index];
    const nextCondition = toCondition(rawRow);
    if (!nextCondition) continue;

    const boolOp = rawRow?.booleanOp || 'AND';

    if (boolOp === 'NOT') {
      tree = {
        operator: 'AND',
        conditions: [
          tree,
          {
            operator: 'NOT',
            conditions: [nextCondition],
          },
        ],
      };
      continue;
    }

    tree = {
      operator: boolOp,
      conditions: [tree, nextCondition],
    };
  }

  return tree.field ? { operator: 'AND', conditions: [tree] } : tree;
}

function parseRange(textRange) {
  if (!textRange) return null;
  const [min, max] = String(textRange).split('-').map(Number);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return [min, max];
}

export function buildStructuredQueryTree(values = {}, registryFilters = []) {
  const filterMap = new Map((registryFilters || []).map((item) => [item.field, item]));
  const conditions = [];

  Object.entries(values || {}).forEach(([field, rawValue]) => {
    if (rawValue == null || rawValue === '') return;
    const descriptor = filterMap.get(field);
    const isNumericLike = descriptor?.type === 'number';
    const isDate = descriptor?.type === 'date';

    if (isNumericLike && typeof rawValue === 'string' && rawValue.includes('-')) {
      const range = parseRange(rawValue);
      if (!range) return;
      conditions.push({ field, operator: 'between', value: range });
      return;
    }

    if (isDate && typeof rawValue === 'string' && rawValue.includes('|')) {
      const [start, end] = rawValue.split('|');
      if (!start || !end) return;
      conditions.push({ field, operator: 'between', value: [start, end] });
      return;
    }

    const defaultOperator = isNumericLike ? 'equals' : 'contains';
    conditions.push({ field, operator: defaultOperator, value: rawValue });
  });

  return {
    operator: 'AND',
    conditions,
  };
}

function getRowValue(row, fieldName) {
  const normalized = normalizeFieldName(fieldName);
  const accessor = FIELD_ACCESSORS[normalized] || normalized;
  return row?.[accessor];
}

export function evaluateQueryTree(tree, row) {
  if (!tree) return true;

  if (tree.field) {
    return compareWithOperator(getRowValue(row, tree.field), tree.operator, tree.value);
  }

  const op = tree.operator || 'AND';
  const conditions = Array.isArray(tree.conditions) ? tree.conditions : [];

  if (!conditions.length) return true;

  if (op === 'NOT') {
    return !conditions.every((condition) => evaluateQueryTree(condition, row));
  }

  if (op === 'OR') {
    return conditions.some((condition) => evaluateQueryTree(condition, row));
  }

  return conditions.every((condition) => evaluateQueryTree(condition, row));
}

export function mapQueryTreeToBackend(tree, filters = [], logicalOperators = ['AND', 'OR', 'NOT']) {
  if (!tree) return null;

  const fieldMap = new Map((filters || []).map((filter) => [filter.field, filter.database_column]));
  const validLogical = new Set(logicalOperators);

  function walk(node) {
    if (!node) return null;

    if (node.field) {
      const normalized = normalizeFieldName(node.field);
      return {
        field: normalized,
        database_column: fieldMap.get(normalized) || normalized,
        operator: node.operator,
        value: node.value,
      };
    }

    const logical = validLogical.has(node.operator) ? node.operator : 'AND';
    return {
      operator: logical,
      conditions: (node.conditions || []).map(walk).filter(Boolean),
    };
  }

  return walk(tree);
}
