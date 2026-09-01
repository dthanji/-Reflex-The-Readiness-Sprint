# Reflex — Trade-off Log

One page. Weak points I found in my own build, why I accepted them, and what I'd do with more time.

---

### 1. Single-instance WebSocket broadcast, no message queue

**What it is:** Status events are broadcast directly from the Express process holding the WebSocket connections (`hub.js`). There is no Redis/RabbitMQ pub-sub layer between API instances and clients.

**Acceptable because:** At pilot scale — one town, a handful of dispatchers and a rider fleet in the tens — one process is simpler and sufficient. Adding queue infrastructure now would add operational complexity before the product needs it.

**What I'd do with more time:** Move broadcast through Redis pub/sub when Reflex needs multiple application instances behind a load balancer.

---

### 2. Offline sync rejects stale conflicts rather than providing rich reconciliation

**What it is:** A rider's PWA queues status updates in IndexedDB when offline and replays them on reconnect using a `client_event_id`. If the world changed while the rider was offline — for example, a dispatcher reassigned the request — the server rejects the stale update through the transition guard instead of silently applying it. There is not yet a dedicated reconciliation screen explaining exactly what changed.

**Acceptable because:** Data integrity is more important than pretending the stale update is valid. The append-only log and transition guard fail safely: the bad replay does not corrupt the delivery history.

**What I'd do with more time:** Surface a clear "this update couldn't apply — here's what changed while you were offline" screen and guide the rider to refresh their assignment state.

---

### 3. Delivery codes are meaningful proof, but not full chain-of-custody evidence

**What it is:** Each delivery gets a unique server-generated code. The retailer can see it after assignment, and the rider must use the code-confirmation path to complete delivery. The server validates that the code belongs to the specific request and has not already been used. There is still no photo, signature, or independent customer identity check.

**Acceptable because:** For a one-week case-study build, a server-validated, single-use code is a meaningful improvement over an unverified WhatsApp message saying "delivered." The remaining limitation is explicit rather than hidden.

**What I'd do with more time:** Add optional photo/signature evidence or a stronger customer-facing PIN/OTP flow for higher-value deliveries.

---

### 4. No phone verification or 2FA at registration

**What it is:** Registration currently accepts a phone number and password without OTP verification. The public registration flow also permits the three application roles.

**Acceptable because:** The sprint prioritised proving the delivery coordination workflow over onboarding infrastructure. SMS verification requires an external provider and a separate identity/role-provisioning design.

**What I'd do with more time:** Add SMS OTP verification and restrict creation of privileged dispatcher/rider accounts to an approved onboarding process rather than open self-registration.

---

### 5. Stuck-in-transit is detected, but the response is deliberately a controlled recovery path

**What it is:** A background job can flag a request that has remained in `PICKED_UP` for 24+ hours as `STUCK_IN_TRANSIT`. The current state machine now explicitly supports recovery from that state: the request can move to `FAILED`, allowing dispatcher intervention/reassignment, or it can be completed through the delivery-code confirmation path.

**Acceptable because:** Automatic detection should not silently deliver or reassign a parcel. Flagging the state first preserves the audit trail and gives the dispatcher a clear intervention point.

**What I'd do with more time:** Add explicit dispatcher alerts, SLA dashboards and a reasoned recovery action so long-running deliveries become an operational workflow rather than simply a flagged state.
