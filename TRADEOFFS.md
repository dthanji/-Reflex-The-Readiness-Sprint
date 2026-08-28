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

### 3. QR scan confirms a scan happened, not that the right parcel reached the right person

**What it is:** `delivery_confirmations` records that a rider scanned a QR code at delivery — but there's no photo, signature, or independent verification tying that scan to the actual customer receiving the actual item.

**Acceptable because:** For the case study's goal — replacing "no record at all" with a first proof-of-delivery signal — a scan is already a big step up from a WhatsApp voice note saying "delivered." Getting to full chain-of-custody evidence is a v2 problem, not a v1 blocker.

**What I'd do with more time:** Add an optional photo capture and/or customer PIN confirmation at the point of delivery, stored alongside the QR scan.

---

### 4. No phone verification or 2FA at registration

**What it is:** Registration takes a phone number and password with no OTP verification step — anyone can register as a "retailer" or "rider" with any phone number.

**Acceptable because:** For a week-long build defending architecture and trade-offs, proving the coordination flow (request → assign → status → confirm) mattered more than hardening onboarding, and OTP requires an SMS provider integration that's out of scope for the sprint timeline.

**What I'd do with more time:** Add SMS OTP verification (e.g. via Africa's Talking, which is common for Kenyan SMS) before an account can act on real deliveries.
