import { verifyTable } from "../system/queryGuard.js";

export function safeFrom(client, table) {
  verifyTable(table);
  return client.from(table);
}
