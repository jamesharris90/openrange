type ContractPayload = Record<string, unknown>;

export function validateDecisionPayload(payload: ContractPayload): true {
  const required = [
    "bias",
    "expectedMoveLabel",
    "catalystType",
  ];

  for (const key of required) {
    if (payload[key] === undefined || payload[key] === null) {
      throw new Error(`CONTRACT_VIOLATION: Missing ${key}`);
    }
  }

  return true;
}

export function validateEarningsPayload(row: ContractPayload): true {
  const required = ["event_date", "tradeability"];

  for (const key of required) {
    if (!row[key]) {
      throw new Error(`EARNINGS_CONTRACT_VIOLATION: Missing ${key}`);
    }
  }

  return true;
}
