## Plan: Delivery Path Audit Report

Produce a proof-only technical audit of the current localhost:3000 delivery chain, showing what is currently wired end-to-end (frontend client -> Next API proxy -> backend endpoint -> frontend selector/render), and identify concrete weaknesses without making code changes.

**Steps**
1. Build runtime topology map from code (*foundation for all later steps*): document default ports, env fallback order, and which process each layer expects on localhost:3000.
2. Trace dashboard delivery chain (*depends on 1*): map request/response contracts for `/api/intelligence/dashboard` from client adapter through Next route wrapper to backend `/api/intelligence/summary`, including fallback behavior at each layer.
3. Trace opportunities and heatmap chains (*parallel with 2 after 1*): map `/api/intelligence/opportunities` and `/api/intelligence/heatmap` request/response normalization plus where empty arrays are produced.
4. Trace SSE market stream behavior (*parallel with 2 and 3 after 1*): document event source endpoint, in-memory bus lifecycle, and when stream can remain active but data-empty.
5. Build failure-mode matrix (*depends on 2, 3, 4*): enumerate observable UI outcomes for backend unreachable, wrong base URL, route-level exception, and genuine no-data market state.
6. Produce the “as-is” weakness report (*depends on 5*): present weaknesses ranked by operational impact, each tied to specific file/function evidence and whether it is configuration-risk, architectural-risk, or observability gap.
7. Add non-invasive verification checklist (*depends on 6*): list exact HTTP checks and expected payload signatures that prove where delivery terminates, without proposing or applying fixes.

**Relevant files**
- `/Users/jamesharris/Server/server/index.js` — backend default port binding and intelligence summary endpoint contract.
- `/Users/jamesharris/Server/trading-os/src/lib/api/client.ts` — client API base behavior (same-origin default).
- `/Users/jamesharris/Server/trading-os/src/app/api/_lib/proxy.ts` — shared proxy base fallback and backend unreachable handling.
- `/Users/jamesharris/Server/trading-os/src/app/api/intelligence/dashboard/route.ts` — dashboard proxy wrapper and error response envelope.
- `/Users/jamesharris/Server/trading-os/src/lib/api/intelligence/dashboard.ts` — summary extraction and zero-data fallback object.
- `/Users/jamesharris/Server/trading-os/src/app/api/intelligence/opportunities/route.ts` — opportunities normalization and broadcast side effects.
- `/Users/jamesharris/Server/trading-os/src/lib/api/intelligence/opportunities.ts` — opportunities empty-array fallback at client adapter.
- `/Users/jamesharris/Server/trading-os/src/app/api/intelligence/heatmap/route.ts` — heatmap normalization path and error envelope.
- `/Users/jamesharris/Server/trading-os/src/lib/api/intelligence/heatmap.ts` — heatmap empty-array fallback at client adapter.
- `/Users/jamesharris/Server/trading-os/src/app/api/stream/market/route.ts` — SSE endpoint and heartbeat behavior.
- `/Users/jamesharris/Server/trading-os/src/lib/server/market-event-bus.ts` — in-process event bus persistence limits.
- `/Users/jamesharris/Server/trading-os/src/components/terminal/dashboard-view.tsx` — UI empty-state/banner logic and user-visible symptom.

**Verification**
1. Confirm static topology from code references: backend default port and frontend proxy env fallback order.
2. Compare payload shapes for each chain: backend raw response shape versus Next route envelope versus client extraction path.
3. Validate empty-state generation points by reading fallback returns in API adapters and UI rendering logic.
4. Validate stream dependency by confirming SSE route has no persistent source replay and depends on in-process broadcasts.
5. Assemble final evidence table with endpoint, expected payload, actual wrapped payload, and first drop/masking point.

**Decisions**
- Scope is proof-only and report-only: no edits, no migrations, no runtime config changes.
- Focus on current architecture as implemented now, not target-state redesign.
- Include weaknesses even if they do not fail every run, as long as code shows plausible failure modes.

**Further Considerations**
1. Runtime-process proof may require active port/process inspection commands if a live verification addendum is requested later; current plan remains code-evidence-first.
