function normalizeRow(row) {
  return row && typeof row === 'object' ? row : {};
}

function validateData(data) {
  const issues = [];
  const issueCounts = {
    notArray: 0,
    emptyDataset: 0,
    missingSymbol: 0,
    missingCatalyst: 0,
    missingTimestamp: 0,
    expectedMoveAlwaysZero: 0,
  };

  if (!Array.isArray(data)) {
    issues.push('Not array');
    issueCounts.notArray += 1;
    return { issues, issueCounts, totalRows: 0 };
  }

  if (data.length === 0) {
    issues.push('Empty dataset');
    issueCounts.emptyDataset += 1;
  }

  data.forEach((rawRow) => {
    const row = normalizeRow(rawRow);

    if (!row.symbol) {
      issueCounts.missingSymbol += 1;
    }

    if (!row.catalyst && !row.catalyst_type && !row.headline) {
      issueCounts.missingCatalyst += 1;
    }

    if (!row.timestamp && !row.created_at && !row.updated_at && !row.published_at) {
      issueCounts.missingTimestamp += 1;
    }

    const expectedMove = row.expectedMove ?? row.expected_move ?? row.expected_move_percent;
    if (expectedMove === 0 || expectedMove === '0.00' || expectedMove === '0') {
      issueCounts.expectedMoveAlwaysZero += 1;
    }
  });

  if (issueCounts.missingSymbol > 0) issues.push('Missing symbol');
  if (issueCounts.missingCatalyst > 0) issues.push('Missing catalyst');
  if (issueCounts.missingTimestamp > 0) issues.push('Missing timestamp');
  if (issueCounts.expectedMoveAlwaysZero > 0) issues.push('Expected move always zero');

  return {
    issues,
    issueCounts,
    totalRows: data.length,
  };
}

module.exports = {
  validateData,
};
