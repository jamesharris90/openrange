export const STALE_WINDOW_MS = 15 * 60 * 1000;

export type AlignmentIssue = {
  code: string;
  message: string;
};

export type AlignmentResult = {
  pass: boolean;
  uiCount: number;
  backendCount: number;
  staleDropped: number;
  issues: AlignmentIssue[];
};

export function isFreshTimestamp(value: unknown, now = Date.now()): boolean {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return false;
  return now - parsed <= STALE_WINDOW_MS;
}

export function dropStaleRows<T>(rows: T[], timestampSelector: (row: T) => unknown): { rows: T[]; dropped: number } {
  const fresh: T[] = [];
  let dropped = 0;
  for (const row of rows) {
    if (isFreshTimestamp(timestampSelector(row))) {
      fresh.push(row);
    } else {
      dropped += 1;
    }
  }
  return { rows: fresh, dropped };
}

export function requireFields<T>(rows: T[], requiredFields: string[]): AlignmentIssue[] {
  const issues: AlignmentIssue[] = [];
  rows.forEach((row, index) => {
    requiredFields.forEach((field) => {
      const value = (row as Record<string, unknown>)[field];
      if (value === null || value === undefined || String(value).trim() === "") {
        issues.push({
          code: "missing_field",
          message: `row ${index} missing ${field}`,
        });
      }
    });
  });
  return issues;
}

export function validateUiAlignment(params: {
  uiCount: number;
  backendCount: number;
  staleDropped: number;
  issues?: AlignmentIssue[];
}): AlignmentResult {
  const issues = params.issues || [];
  if (params.uiCount !== params.backendCount) {
    issues.push({
      code: "count_mismatch",
      message: `ui=${params.uiCount}, backend=${params.backendCount}`,
    });
  }

  return {
    pass: issues.length === 0,
    uiCount: params.uiCount,
    backendCount: params.backendCount,
    staleDropped: params.staleDropped,
    issues,
  };
}
