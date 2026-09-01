# Reflex — Anticipated Cross-Exam Q&A
Prepared using State → Context → Evidence. Organized by the four panel categories.

---

## Category 1: Architecture

### Q: Why PostgreSQL instead of MongoDB or Firebase?
**State:** PostgreSQL, because the data model is strongly relational and I need row-level locks.  
**Context:** A delivery request has fixed relationships (retailer → request → assignment → rider → status events). Transactions and `SELECT ... FOR UPDATE` let me prevent double-assignment races cleanly.  
**Evidence:** In `assignments.js`, the assignment write is wrapped in a transaction that locks the `delivery_requests` row before checking state. I tested this by opening two browser tabs as dispatchers and clicking assign simultaneously — one succeeds, the other gets a clean 409, not a duplicate assignment row.

### Q: Why a WebSocket instead of polling or SSE?
**State:** WebSocket push, because the dispatcher dashboard must update instantly when a retailer submits a request.  
**Context:** Polling at 5-second intervals would mean 120 requests per minute per connected dispatcher. In a pilot with 3 dispatchers and 20 riders, that’s unnecessary load and perceptible lag. SSE is one-way; I needed bidirectional for the rider’s offline-sync handshake later.  
**Evidence:** The demo shows the retailer submitting a request and the dispatcher screen updating without a refresh — that’s the `broadcastNewRequest` call in `hub.js` firing over the same socket.

### Q: Why is there no `status` column on `delivery_requests`?
**State:** Status is always derived from the latest row in `status_events`; there is no mutable status column.  
**Context:** Three reasons: (1) Audit trail is free — one indexed query gives the full history. (2) Two actors racing to update can’t clobber each other; both events land, and the transition guard rejects the illegal one. (3) Offline replay is naturally idempotent — the same `client_event_id` dedupes against the log.  
**Evidence:** The `delivery_request_state` view in `schema.sql` derives current status with a lateral join. I deliberately replayed the same `client_event_id` twice in a test; the second insertion returned 200 with `deduped: true` instead of creating a duplicate event.

---

## Category 2: Trade-offs

### Q: Your WebSocket broadcast is single-instance. What happens when you need to scale?
**State:** It’s a known weak point; I accepted it because pilot scale is one process, and I named it before the panel could.  
**Context:** Moving to Redis pub/sub adds a moving part (infra, message schemas, consumer lag) that would have consumed build time for a problem I don’t have yet. The trade-off is logged with a concrete next step.  
**Evidence:** `TRADEOFFS.md` item #1 documents this, and `hub.js` has a design comment explaining exactly what would change. I can quote the line: "If Reflex scaled to multiple instances, this would need to move to Redis pub/sub."

### Q: What if a rider is offline and the dispatcher reassigns their delivery?
**State:** The queued update is replayed, the server’s transition guard rejects it with a 409, and data integrity holds — but the UX is rough because there’s no reconciliation screen yet.  
**Context:** True three-way merge UI is a lot of design for an edge case. I chose safe failure over silent corruption. The rider sees a generic error today; with more time I’d surface a "this changed while you were offline" screen.  
**Evidence:** `TRADEOFFS.md` item #2. In testing, I marked a request `PICKED_UP` offline, then marked it `DELIVERED` from another session, then reconnected — the queued `PICKED_UP` was rejected cleanly, and the append-only log shows no illegal transition.

### Q: A delivery code doesn't prove the right person got the parcel — and can it even be bypassed?
**State:** Both are true. The code is validated against the specific request and against reuse, which is real, but there's still no photo or independent check tying it to the actual customer — and the plain status endpoint still allows a direct `PICKED_UP → DELIVERED` transition with no code check at all, so enforcement currently depends on the frontend, not the server.
**Context:** I found the bypass gap myself while updating these docs against the actual code, not from a panel question — which is exactly the posture I want walking in: I'd rather be the one who found it.
**Evidence:** `TRADEOFFS.md` item #3. The fix is small and specific: either drop `DELIVERED` from `PICKED_UP`'s valid transitions on the plain endpoint, or require the code there too — not a redesign, a few lines.

---

## Category 3: Edge Cases

### Q: What happens if two dispatchers assign the same request at the exact same second?
**State:** Only one wins; the other gets a 409. No double-booking.  
**Context:** I use `SELECT ... FOR UPDATE` on the base table inside a transaction. Postgres serializes the two transactions; the second sees the updated state and is blocked.  
**Evidence:** `assignments.js` lines 14-25. I tested this by clicking "Assign" on two dispatcher tabs simultaneously — one returned 201, the other returned 409 with the message "Cannot assign a ASSIGNED request."

### Q: What if a rider’s phone queues the same status update twice?
**State:** The server dedupes it using `client_event_id`. The second replay returns 200 with the original status, and only one row is written.  
**Context:** The rider’s PWA stores updates in IndexedDB with a UUID. On reconnect, `flushQueue` replays them. The database has a partial unique index on `client_event_id` that rejects duplicates.  
**Evidence:** `status.js` checks for existing `client_event_id` before insert. `schema.sql` has `CREATE UNIQUE INDEX idx_status_events_client_event_id`. In a test, I manually called the API twice with the same `client_event_id`; the second call returned `deduped: true`.

### Q: What if a rider tries to mark DELIVERED before PICKED_UP?
**State:** The server rejects it with a 409 and a clear reason.  
**Context:** The `VALID_TRANSITIONS` map in `status.js` defines legal moves: `ASSIGNED → [PICKED_UP, FAILED]`, `PICKED_UP → [DELIVERED, FAILED]`. Anything else is illegal.  
**Evidence:** `status.js` lines 10-11. I tested this by sending `DELIVERED` on a request that was still `ASSIGNED`; the API returned `Cannot move from ASSIGNED to DELIVERED`.

### Q: What if a rider tries to update someone else’s assignment?
**State:** 403 — "This request is not assigned to you."  
**Context:** The status endpoint checks `current.rider_id !== req.user.id` before allowing any transition.  
**Evidence:** `status.js` line 45. Tested by authenticating as Rider A and posting a status update for a request assigned to Rider B — returned 403.

---

## Category 4: Candor (questions with no clean answer in the current build)

### Q: How do you prevent someone from registering as a fake dispatcher?
**State:** I don’t yet — registration takes any phone number with no OTP verification.  
**Context:** OTP requires an SMS provider integration (e.g., Africa’s Talking for Kenya) that was out of scope for a one-week sprint focused on the coordination flow.  
**Evidence:** `TRADEOFFS.md` item #4. If I had more time, I’d add SMS OTP before an account can act on real deliveries. I can show the exact provider I’d use and why.

### Q: What’s your recovery plan if the Postgres server goes down during a delivery?
**State:** I don’t have automated failover in this build.  
**Context:** The pilot assumes a single managed Postgres instance. For production, I’d move to a managed service with automated backups (e.g., AWS RDS or Supabase) and a read replica for the dashboard queries.  
**Evidence:** This is not in the current repo because it’s infrastructure, not application code. I’d find out by benchmarking the RPO/RTO requirements with the pilot users and picking a provider that meets them.

### Q: How do you handle a rider who marks PICKED_UP but never delivers?
**State:** The current build records the transition but has no automated escalation.  
**Context:** A real system would need a timeout rule (e.g., auto-flag if PICKED_UP → no DELIVERED within 2 hours) and an alert to the dispatcher. That’s in the roadmap under analytics.  
**Evidence:** The append-only log gives me the data to build that report — I can query `status_events` for any request stuck in `PICKED_UP` longer than a threshold. I haven’t built the alert yet, but the data model supports it.

---

## How to use this doc
1. Read each answer out loud until it sounds like your own words, not a script.  
2. For every answer, have one concrete detail ready (a line number, a test you ran, a number you measured).  
3. If you get a question not on this list, default to: *"I don't know the exact answer to that, but here's how I'd find out..."* — then name the test, the query, or the doc you’d read.
