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

  const numericActual = Number(actual);
  const numericValue = Number(value);

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
    field: row.field,
    operator: row.operator || 'equals',
    value: conditionValue,
  };
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

export function buildStructuredQueryTree(values = {}) {
  const conditions = [];

  const rangeFields = [
    ['price', values.priceRange],
    ['marketCap', values.marketCapRange],
    ['float', values.floatRange],
    ['rsi', values.rsiRange],
    ['relativeVolume', values.rvolRange],
    ['volumeShock', values.volumeShockRange],
    ['daysUntilEarnings', values.daysUntilEarnings],
    ['expectedMove', values.expectedMoveRange],
  ];

  rangeFields.forEach(([field, rangeText]) => {
    const range = parseRange(rangeText);
    if (!range) return;
    conditions.push({ field, operator: 'between', value: range });
  });

  if (values.exchange) conditions.push({ field: 'exchange', operator: 'equals', value: values.exchange });
  if (values.sector) conditions.push({ field: 'sector', operator: 'equals', value: values.sector });
  if (values.country) conditions.push({ field: 'country', operator: 'equals', value: values.country });
  if (values.vwapRelation === 'above') conditions.push({ field: 'vwapDistance', operator: '>', value: 0 });
  if (values.vwapRelation === 'below') conditions.push({ field: 'vwapDistance', operator: '<', value: 0 });
  if (values.catalystType) conditions.push({ field: 'catalystType', operator: 'contains', value: values.catalystType });
  if (values.sentiment) conditions.push({ field: 'newsSentiment', operator: 'contains', value: values.sentiment });

  return {
    operator: 'AND',
    conditions,
  };
}

export function evaluateQueryTree(tree, row) {
  if (!tree) return true;

  if (tree.field) {
    return compareWithOperator(row?.[tree.field], tree.operator, tree.value);
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
