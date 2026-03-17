# OpenRange Full Site Audit
Date: 2026-03-17
Scope: Read-only audit, no code changes
Goal: Determine why database data is not consistently appearing in frontend views, define a recovery plan, and provide a security and reliability hardening roadmap.

## 1) Executive Summary
This audit found a strong delivery-path risk between backend data and frontend rendering, even when database tables are populated.

Highest-probability failure pattern:
1. Frontend and backend role confusion on localhost port ownership.
2. Multiple Next API routes using a fallback backend base of http://localhost:3000.
3. Silent fallbacks in frontend data adapters that convert upstream failures into empty arrays or neutral states.
4. In-memory SSE event bus with no persisted replay, causing live stream to appear connected but data-empty.

Operational impact:
- UI can look healthy but show no data.
- Failures are often masked as market-closed or empty-state conditions.
- Troubleshooting takes longer because error propagation is weak.

## 2) Evidence Snapshot (Current As-Is State)
Observed runtime topology during audit:
- A Node process is listening on port 3000.
- No service listening on port 3001 at capture time.

Backend defaults and behavior:
- Backend default port is process.env.PORT or 3000.
- Intelligence summary endpoint returns success true with section-level fallbacks.
- Some endpoints intentionally return success with empty payloads on failure.

Frontend proxy behavior:
- Multiple Next API routes resolve backend base using OPENRANGE_API_BASE, BACKEND_API_BASE, SERVER_API_BASE, then fallback to http://localhost:3000.
- Client API base defaults to same-origin via NEXT_PUBLIC_API_BASE or empty string.

Interpretation:
If Next app is serving on 3000 and backend base also resolves to 3000, requests may loop to the wrong service or degrade into repeated internal errors, then get masked by empty fallbacks.

## 3) DB-to-Frontend Delivery Chain (Where Data Can Be Lost)
### Chain A: Dashboard summary
Frontend component -> client adapter -> Next API route -> backend intelligence summary -> database queries -> response mapping -> UI render

Potential drop points:
- Next route points to wrong backend base.
- Backend returns partial data with warnings but still success true.
- Frontend adapter returns default empty object when expected nested shape missing.
- UI banner logic treats no data as market-closed style state.

### Chain B: Opportunities and heatmap
Frontend query -> Next route normalization -> backend radar or opportunities endpoint -> mapped rows -> table/card render

Potential drop points:
- Route-level fetch errors converted to generic error envelope.
- Adapter-level fallback returns empty rows array on missing data shape.
- Broadcast side effects depend on successful route calls.

### Chain C: Stream updates (SSE)
EventSource /api/stream/market -> in-process listener set -> broadcast from selected route handlers

Potential drop points:
- Stream is connected but receives only heartbeats.
- No persisted event store or replay on reconnect.
- No guarantee of updates unless producer routes are called.

## 4) Root-Cause Hypotheses Ranked by Probability
1. Port and service-role ambiguity on localhost.
- Most likely. Both layers can target port 3000 by default.

2. Proxy base fallback misuse in Next routes.
- Very likely. Repeated backend base fallback pattern increases misrouting risk.

3. Silent-empty fallback behavior masks transport and contract failures.
- Very likely. Empty arrays and success envelopes hide true failure class.

4. Contract envelope mismatch between route wrappers and adapters.
- Moderate likelihood. Works in some paths, fails silently in others when nested keys differ.

5. SSE architecture does not guarantee data continuity.
- Moderate likelihood for live panels appearing stale despite backend activity.

6. Authorization/context drift across proxied requests.
- Lower but relevant. Header forwarding is present, but differing runtime modes can still break auth assumptions.

## 5) Strengths, Weaknesses, Opportunities, Threats (SWOT)
## Strengths
- Strong backend breadth: intelligence, opportunities, radar, metrics, alerts, user settings.
- CORS, security headers, request-id, and structured logging are implemented.
- Rate limiting exists for both general traffic and registration abuse.
- Backend has multiple resilience patterns and fallback responses.
- Frontend has centralized query policy and route-based proxy architecture.

## Weaknesses
- Backend base URL logic duplicated across many Next route files.
- Unsafe localhost fallback allows accidental same-port misrouting.
- Multiple endpoints and adapters treat failures as empty success-like payloads.
- Limited error surfacing from Next proxy handlers to frontend UX.
- SSE channel is ephemeral and in-memory without durability.
- Documentation does not clearly enforce single source of truth for dev port topology.

## Opportunities
- Introduce strict runtime topology contract: frontend port, backend port, and required env mapping.
- Add response contract validation at route boundaries.
- Distinguish no-data business state from transport or contract failure state.
- Add synthetic end-to-end health probes for key user journeys.
- Add observability dashboard for proxy latency, route error rate, and empty-result anomalies.

## Threats
- Production incidents where healthy DB appears empty to users.
- False confidence from success true envelopes that actually contain fallback empties.
- Regression risk from duplicated backend base resolution logic.
- Data trust and user confidence erosion from inconsistent terminal panels.
- Scalability limits for in-process event bus under multi-instance deployments.

## 6) Plan to Diagnose Why DB Data Is Not Rendering on Frontend
This is a no-code investigative plan.

Phase 1: Runtime topology proof
1. Confirm which process owns each port in every environment profile.
2. Record expected mapping table:
   - Frontend public host and port
   - Backend internal host and port
   - Next proxy backend base source variable
3. Verify active env values used by frontend runtime and Next API runtime.

Phase 2: Endpoint-by-endpoint trace
1. Execute direct backend calls for:
   - /api/intelligence/summary
   - /api/radar/summary
   - /api/opportunities
2. Execute same calls through Next routes:
   - /api/intelligence/dashboard
   - /api/intelligence/heatmap
   - /api/intelligence/opportunities
3. Compare payload shape and status for each pair.
4. Identify first layer where rows become empty or envelope changes unexpectedly.

Phase 3: Frontend adapter and render-state proof
1. For each critical panel, map expected response keys and fallback behavior.
2. Record whether adapter returns empty arrays on missing nested keys.
3. Confirm whether UI shows market-closed style messaging for actual transport failures.

Phase 4: Stream path proof
1. Connect to stream endpoint and log event types for 5 to 10 minutes.
2. Trigger producer routes and verify event arrival.
3. Verify behavior after reconnect and after route inactivity.

Phase 5: Findings closeout
1. Build a defect matrix:
   - Layer
   - Failure trigger
   - User-visible symptom
   - Severity
   - Recommended fix owner
2. Approve remediation order by impact and effort.

## 7) Recommendations to Restore Full Functionality
Priority 0 (Immediate)
1. Freeze and document a single dev topology standard.
2. Remove ambiguity in runtime ops: one process per declared port role.
3. Validate critical user journey manually after restart sequence:
   - dashboard summary
   - opportunities grid
   - heatmap
   - signals

Priority 1 (Reliability)
1. Centralize backend base resolution policy in one shared runtime configuration path.
2. Enforce fail-fast behavior when backend base is missing or self-referential.
3. Standardize route response envelopes and include explicit failure reason fields.
4. Separate empty-business-state from data-delivery-error state in UI.

Priority 2 (Observability)
1. Add per-route telemetry: upstream target, status, latency, response-size.
2. Add counters for empty fallback activations by endpoint.
3. Add correlation IDs from browser request to backend query logs.
4. Add synthetic probes for key terminal views every few minutes.

Priority 3 (Data continuity)
1. Move SSE from in-memory event bus toward durable broker or persisted cache replay.
2. Provide initial snapshot endpoint for stream consumers before live updates.
3. Add stale-data indicators with explicit timestamps.

## 8) Site Hardening Plan
## Hardening Track A: Configuration and Environment
1. Define environment contract matrix for local, staging, production.
2. Enforce required variables at startup for frontend and backend runtimes.
3. Add startup validation report and block boot on unsafe topology.

## Hardening Track B: API Contract and Error Hygiene
1. Publish canonical contract for each frontend-consumed endpoint.
2. Add contract validation tests between Next route wrappers and backend payloads.
3. Require explicit error classes: upstream_unreachable, auth_failed, contract_invalid, no_data.

## Hardening Track C: Security and Access Controls
1. Remove insecure defaults in production mode.
2. Review x-api-key fallback behavior and rotate keys regularly.
3. Tighten CSP and CORS origin governance with environment-driven allowlists.
4. Add audit logging for administrative and sensitive actions.

## Hardening Track D: Resilience and Performance
1. Establish timeout and retry policy per endpoint criticality.
2. Add circuit-breaker behavior for unstable upstream dependencies.
3. Cache strategy review: avoid stale-empty cache poisoning.
4. Introduce graceful degradation with transparent user messaging.

## Hardening Track E: Operations
1. Create runbooks for startup, health checks, rollback, and incident triage.
2. Add pre-release gate for end-to-end data path verification.
3. Define SLOs:
   - freshness
   - API success rate
   - dashboard render completeness
4. Schedule monthly reliability review and quarterly security review.

## 9) Success Criteria for Recovery
The site can be considered fully functional when all are true:
1. Backend direct and frontend-proxied endpoints return equivalent non-empty datasets during market-active periods.
2. UI differentiates no-market-data from delivery failure with clear messaging.
3. Stream consumers receive initial snapshot plus live updates with measurable freshness.
4. Error rates and empty-fallback rates stay below agreed thresholds for 7 consecutive days.
5. Port topology and environment checks pass in local, staging, and production.

## 10) Suggested Implementation Sequence (No-Code Planning View)
Week 1
1. Topology lock-in and environment contract sign-off.
2. Endpoint pair tracing and defect matrix completion.
3. Restore visibility with operations checklist and health probes.

Week 2
1. Route and adapter contract standardization plan approval.
2. Observability instrumentation specification and dashboard design.
3. Reliability and fallback policy updates approved.

Week 3 to 4
1. Stream durability design decision.
2. Security and hardening controls rollout plan.
3. Production readiness review with go-live criteria.

## 11) Appendix: High-Value Audit Targets
Backend
- server/index.js
- server/app.js
- server/middleware/rateLimit.js

Frontend
- trading-os/src/lib/api/client.ts
- trading-os/src/app/api/_lib/proxy.ts
- trading-os/src/app/api/intelligence/dashboard/route.ts
- trading-os/src/app/api/intelligence/opportunities/route.ts
- trading-os/src/app/api/intelligence/heatmap/route.ts
- trading-os/src/app/api/intelligence/markets/route.ts
- trading-os/src/lib/api/intelligence/dashboard.ts
- trading-os/src/lib/api/intelligence/opportunities.ts
- trading-os/src/lib/api/intelligence/heatmap.ts
- trading-os/src/app/api/stream/market/route.ts
- trading-os/src/lib/server/market-event-bus.ts
- trading-os/src/components/terminal/dashboard-view.tsx
