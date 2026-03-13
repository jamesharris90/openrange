import { DATA_CONTRACT } from "../contracts/dataContract.js";

function flattenContract(contract) {
  let tables = [];
  Object.values(contract).forEach((v) => {
    if (typeof v === "string") tables.push(v);
    else tables.push(...Object.values(v));
  });
  return tables;
}

const allowedTables = flattenContract(DATA_CONTRACT);

export function verifyTable(table) {
  if (!allowedTables.includes(table)) {
    throw new Error(`Unauthorized table access attempted: ${table}`);
  }
}
