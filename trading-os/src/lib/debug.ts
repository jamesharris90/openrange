export function debugLog(label: string, data: unknown) {
  if (process.env.NODE_ENV !== "development") return;
  console.log(`[DEBUG] ${label}`, data);
}
