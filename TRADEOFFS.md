# Reflex — Trade-off Log

One page. Weak points I found in my own build, why I accepted them, and what I'd do with more time.

---

### 1. Single-instance WebSocket broadcast, no message queue

**What it is:** Status events are broadcast directly from the Express process holding the WebSocket connections (`hub.js`). There's no RabbitMQ/Redis pub-sub layer between the API and the clients.

**Acceptable because:** At pilot scale — one town, a handful of dispatchers, a rider fleet in the tens — one process handles this without breaking a sweat, and it removes an entire moving part (queue infra, message schemas, consumer lag) that would slow down this week's build for no real benefit yet.

**What I'd do with more time:** Move broadcast through Redis pub/sub so any number of Express instances can share connected clients — required the moment Reflex needs to run behind a load balancer with more than one instance.

---

### 2. Offline sync uses last-write-wins, not real conflict resolution

**What it is:** A rider's PWA queues status updates in IndexedDB when offline and replays them on reconnect, tagged with a `client_event_id` so retries dedupe. But if the world changed while they were offline — say a dispatcher reassigned the request — the queued update just gets rejected by the server's transition guard (409), with no reconciliation UI.

**Acceptable because:** True conflict resolution (merge UI, three-way diffs) is a lot of design and engineering for an edge case that, for now, fails safely: the append-only log and the transition guard mean a bad replay is *rejected*, not silently applied. Data integrity holds even though the UX for that moment is rough.

**What I'd do with more time:** Surface a clear "this update couldn't apply — here's what changed while you were offline" screen instead of a generic error.

---

### 3. Delivery codes still aren't full chain-of-custody proof — and can be bypassed entirely

**What it is:** The delivery-code system (server-generated, unique per request, checked against reuse) is a real improvement over an earlier version that accepted any scanned text as "proof." But two gaps remain. First, there's still no photo, signature, or independent check tying the code entry to the actual customer receiving the actual item — someone with the code could confirm delivery from anywhere. Second, and more concerning: the plain status-update endpoint still allows a direct `PICKED_UP → DELIVERED` transition with no code check at all. The delivery-code confirmation is a separate, additional endpoint — it's not the *only* path to `DELIVERED`. Enforcement currently depends entirely on the frontend only exposing the code-confirm flow to riders, not on anything the server itself guarantees.

**Acceptable because:** For the case study's goal — replacing "no record at all" with a first proof-of-delivery signal — a validated, single-use code tied to a specific request is already a meaningful step up from a WhatsApp voice note saying "delivered." The bypass is a real gap, not a hidden one, and it's the kind of thing a panel question would catch quickly if I didn't name it first.

**What I'd do with more time:** Either remove `DELIVERED` from `PICKED_UP`'s valid transitions on the plain status endpoint (forcing all deliveries through the code-confirm path server-side, not just in the UI), or add a required delivery-code parameter to the plain endpoint's `DELIVERED` case directly. Longer-term: add optional photo capture or a customer-facing PIN for full chain-of-custody evidence.

---

### 4. No phone verification or 2FA at registration

**What it is:** Registration takes a phone number and password with no OTP verification step — anyone can register as a "retailer" or "rider" with any phone number.

**Acceptable because:** For a week-long build defending architecture and trade-offs, proving the coordination flow (request → assign → status → confirm) mattered more than hardening onboarding, and OTP requires an SMS provider integration that's out of scope for the sprint timeline.

**What I'd do with more time:** Add SMS OTP verification (e.g. via Africa's Talking, which is common for Kenyan SMS) before an account can act on real deliveries.

---

### 5. Stuck-in-transit monitoring can permanently strand a delivery

**What it is:** A background job auto-flags any delivery sitting in `PICKED_UP` for 24+ hours as `STUCK_IN_TRANSIT`, writing it into the append-only status log. But `STUCK_IN_TRANSIT` isn't listed as a source state in `VALID_TRANSITIONS`, and the delivery-code confirm endpoint explicitly requires the current status to be `PICKED_UP`. Once a delivery gets auto-flagged, neither the plain status endpoint nor the confirm endpoint has a path to move it forward — it's stuck for real, not just in name.

**Acceptable because:** I found this while reviewing the code to update these docs, not before — it hasn't caused a real incident, and the monitor's actual purpose (surfacing deliveries that need a human to look at them) still works; it's the *recovery* path that's missing, not the detection.

**What I'd do with more time:** Add a dispatcher-only action to un-stick a delivery — either a direct status override with a required reason (kept in the append-only log like everything else) or explicitly adding `STUCK_IN_TRANSIT` as a source state that still permits `DELIVERED`/`FAILED`.
