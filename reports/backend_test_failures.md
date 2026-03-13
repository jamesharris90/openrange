# Backend Test Failures

Date: 2026-03-13
Command: `cd server && npm test`

## Summary
- Test suites: 1 failed, 4 passed (5 total)
- Tests: 1 failed, 30 passed (31 total)

## Failed Test
- Suite: `tests/usage.test.js`
- Test: `Usage persistence -> records and aggregates usage events`
- Assertion:
  - Expected: `2`
  - Received: `"2"`
- Failure location: `tests/usage.test.js:28`

## Error Excerpt
```text
expect(received).toBe(expected) // Object.is equality
Expected: 2
Received: "2"
```

## Notes
- This appears to be a type mismatch (string vs number) in usage aggregation output.
- Frontend build completed successfully in this run.
