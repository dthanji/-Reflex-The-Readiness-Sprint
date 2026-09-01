# Reflex — Anticipated Cross-Exam Q&A
Prepared using State → Context → Evidence. Organized by the four panel categories.

---

## Category 1: Architecture

### Q: Why PostgreSQL instead of MongoDB or Firebase?
**State:** PostgreSQL, because the data model is strongly relational and I need transactional row-level locking.  
**Context:** A delivery request has fixed relationships (retailer → request → assignment → rider → status events). Transactions and `SELECT ... FOR UPDATE` let me prevent double-assignment races cleanly.  
**Evidence:** The assignment write locks the delivery request inside a transaction before checking its state, so competing assignment attempts cannot silently create two active assignments.

### Q: Why a WebSocket instead of polling or SSE?
**State:** WebSocket push, because the dashboards should update immediately when a delivery changes.  
**Context:** Polling adds repeated requests and visible lag. WebSockets give the app a single live channel for relevant status changes.  
**Evidence:** In the live workflow, the retailer/dispatcher/rider views update from server broadcasts without requiring a page refresh.

### Q: Why is there no `status` column on `delivery_requests`?
**State:** Status is represented by append-only `status_events`; current state is derived through `delivery_request_state`.  
**Context:** This preserves history, prevents silent overwrites, and gives offline replay a natural place to dedupe using `client_event_id`.  
**Evidence:** The schema contains the append-only event table and a state view/cache rather than a mutable status column on the request itself.

---

## Category 2: Trade-offs

### Q: Your WebSocket broadcast is single-instance. What happens when you need to scale?
**State:** It is a known pilot-scale trade-off.  
**Context:** A single process is simpler and sufficient for the current scope; adding Redis/pub-sub before multiple app instances are needed would add infrastructure without solving a current problem.  
**Evidence:** `TRADEOFFS.md` item #1 documents the scale-out path: move broadcast through Redis pub/sub when Reflex runs across multiple instances.

### Q: What if a rider is offline and the dispatcher changes the assignment?
**State:** The queued update is replayed and the server transition guard rejects a stale/illegal update rather than silently applying it.  
**Context:** Data integrity is protected, but the UX does not yet provide a rich reconciliation screen.  
**Evidence:** IndexedDB queues updates with `client_event_id`; the server validates the current state and actor before accepting a transition.

### Q: Does the delivery code prove the parcel reached the right person?
**State:** It provides a strong pilot-level confirmation signal, but it is not full chain-of-custody proof.  
**Context:** The server-generated code is tied to the specific request and is single-use, which is materially stronger than an unverified delivery message. It does not independently verify the recipient's identity.  
**Evidence:** The confirmation endpoint checks the code against the specific request and prevents reuse. A future production version could add photo, signature or customer OTP evidence.

### Q: Can a rider bypass the delivery code and simply mark an order DELIVERED?
**State:** No. The direct `DELIVERED` path is blocked; delivery completion must use the confirmation path with the request's delivery code.  
**Context:** This closes the earlier server-side bypass that relied on the frontend hiding the plain action.  
**Evidence:** The current transition guard rejects direct `DELIVERED` updates and the confirmation endpoint validates the code before writing the `DELIVERED` event.

---

## Category 3: Edge Cases

### Q: What happens if two dispatchers assign the same request at the exact same second?
**State:** Only one assignment should win; the other is rejected cleanly.  
**Context:** The assignment transaction locks the delivery request row with `SELECT ... FOR UPDATE` before checking the current state and inserting the assignment.  
**Evidence:** This protection is implemented in the assignment route and the database keeps assignment history rather than overwriting it.

### Q: What if a rider's phone queues the same status update twice?
**State:** The server dedupes it using `client_event_id`.  
**Context:** The PWA stores queued updates in IndexedDB and replays them after reconnect. The database has a unique index for non-null client event IDs.  
**Evidence:** The status route handles duplicate client event IDs and the schema defines `idx_status_events_client_event_id` as a unique partial index.

### Q: What if a rider tries to mark DELIVERED before PICKED_UP?
**State:** The server rejects it with a clear conflict response.  
**Context:** The `VALID_TRANSITIONS` map only permits legal state changes, and direct `DELIVERED` is intentionally not accepted by the plain status endpoint.  
**Evidence:** The current transition rules allow `ASSIGNED → PICKED_UP/FAILED`, `PICKED_UP → FAILED`, and require the delivery-code confirmation path for `DELIVERED`.

### Q: What if a rider tries to update someone else's assignment?
**State:** The request is rejected with a 403.  
**Context:** The server checks the authenticated rider against the request's current rider before accepting a rider transition.  
**Evidence:** Rider ownership is enforced in the status/confirmation routes rather than trusted from the browser UI.

### Q: What happens after a failed delivery?
**State:** A dispatcher can reassign a request that is in `FAILED`.  
**Context:** Reassignment is a separate operation and preserves the history instead of replacing the previous assignment.  
**Evidence:** This was verified live: Order 2 was moved to `FAILED`, reassigned by the dispatcher, picked up by the reassigned rider, and successfully delivered.

### Q: What happens if a delivery is flagged STUCK_IN_TRANSIT?
**State:** It is recoverable rather than terminal.  
**Context:** The current state machine permits `STUCK_IN_TRANSIT → FAILED` for intervention/reassignment, and the delivery-code confirmation path can also complete a valid in-transit delivery.  
**Evidence:** The transition map and confirmation endpoint explicitly include `STUCK_IN_TRANSIT` as a supported source state.

---

## Category 4: Candor

### Q: How do you prevent someone from registering as a fake dispatcher?
**State:** I do not yet have phone/OTP verification or an approval workflow for privileged registration.  
**Context:** The sprint prioritised the delivery coordination workflow. Production onboarding should separate public retailer registration from controlled dispatcher/rider provisioning.  
**Evidence:** `TRADEOFFS.md` item #4 records this as an intentional remaining gap and names SMS OTP plus controlled provisioning as the next step.

### Q: What is your recovery plan if the Postgres server goes down during a delivery?
**State:** I do not have automated database failover in this build.  
**Context:** The pilot uses a managed PostgreSQL instance; production scale would require explicit RPO/RTO targets and managed backup/failover architecture.  
**Evidence:** The application is designed around transactional writes, but infrastructure failover is outside this sprint's application scope.

### Q: How do you handle a rider who marks PICKED_UP but never delivers?
**State:** The build now detects long-running pickups and can flag them as `STUCK_IN_TRANSIT`.  
**Context:** The monitor runs on a 24-hour threshold. The state is recoverable through failure/reassignment or delivery-code confirmation, but richer alerts and SLA dashboards are still a roadmap item.  
**Evidence:** `ARCHITECTURE.md` documents the background monitor and the state-machine recovery path; `TRADEOFFS.md` item #5 explains the remaining operational gap.

---

## Current live evidence to cite

The latest production test verified two complete scenarios:

1. **Successful delivery:** retailer creates request → delivery code generated → dispatcher assigns rider → rider picks up → rider confirms with delivery code → `DELIVERED`.
2. **Failure recovery:** second request → rider picks up → rider marks `FAILED` → dispatcher reassigns → reassigned rider picks up → reassigned rider completes delivery.

These are the strongest current demo claims because they were observed in the deployed system rather than inferred from code.

---

## How to use this doc
1. Read each answer out loud until it sounds like your own words, not a script.
2. For every answer, have one concrete detail ready (a code path, a state transition, a test you actually ran, or a document reference).
3. If you get a question not on this list, default to: *"I don't know the exact answer to that, but here's how I'd find out..."* — then name the test, query, or document you would use.
