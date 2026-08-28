# Reflex — Architecture

## Problem
Small Kenyan retailers coordinate deliveries over WhatsApp and phone calls — no record of who's assigned, no status visibility, no proof of delivery.

## Solution
Reflex gives three roles a shared, live view of every delivery: a retailer logs a request, a dispatcher assigns it to a rider, and the rider updates status as it moves — with every step recorded in an append-only log, not overwritten.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js + Express | Fast to build a REST API; same runtime as the WebSocket layer, one deploy unit |
| Database | PostgreSQL | Relational fits fixed entities (users, requests, assignments); transactions + row locks (`FOR UPDATE`) prevent double-assignment races |
| Real-time | `ws` WebSocket server | Dispatcher/retailer/rider dashboards update live without polling |
| Frontend | PWA (installable, vanilla JS) | Works like an app on a rider's phone with no app-store install; service worker caches the shell for spotty-connectivity areas |
| Offline sync | IndexedDB queue + idempotent replay | Riders lose signal mid-route; updates queue locally and sync via a `client_event_id` the server dedupes on |
| Proof of delivery | QR scan (`html5-qrcode`, browser camera) | No native app needed for a scan-based confirmation step |

## Data model

- `users` — id, name, phone, password_hash, role (retailer / dispatcher / rider)
- `delivery_requests` — the request itself: customer, address, item. **No status column.**
- `assignments` — which rider is/was assigned to which request, and by whom
- `status_events` — **append-only.** Every transition (REQUESTED → ASSIGNED → PICKED_UP → DELIVERED / FAILED) is a new row with actor and timestamp. Current status is always *derived* from the latest row here, never mutated in place.
- `delivery_confirmations` — QR scan record at the point of delivery
- `delivery_request_state` — a view joining the latest status and current rider onto each request, so the app never has to re-derive it in application code

## Why append-only status events, not a mutable status column

Three reasons, in order of how they'd come up under cross-exam:

1. **Audit trail for free.** "What happened and when" is answerable with a single indexed query, not reconstructed from logs or guessed at.
2. **Concurrency safety.** Two actors racing to update the same request can't silently clobber each other's write — both events land, in order, and the transition guard (see below) rejects illegal ones.
3. **Idempotent offline replay.** A rider's queued update carries a `client_event_id`; replaying it twice inserts the event once, because the log is the natural place to dedupe against.

## Flow

1. **Retailer** submits a request → `status_events: REQUESTED`, broadcast to all dispatchers.
2. **Dispatcher** sees open requests live, assigns to a rider. The assignment row is locked with `SELECT ... FOR UPDATE` on the base table to prevent a race where two dispatchers assign the same request simultaneously → `status_events: ASSIGNED`, broadcast to that retailer and rider.
3. **Rider** sees their queue, marks `PICKED_UP`, then scans a QR at the door to confirm `DELIVERED`. Each transition is checked against a `VALID_TRANSITIONS` map server-side — you can't jump from REQUESTED straight to DELIVERED, and you can't act on a request that isn't yours.
4. Every event broadcasts over WebSocket to whoever has a stake in it: dispatchers see everything, retailers see their own requests, riders see their own assignments.

## Edge cases handled

- **Concurrent assignment:** row-level lock on `delivery_requests` before an assignment write.
- **Duplicate status submission** (offline retry): `client_event_id` unique index dedupes.
- **Illegal transition** (e.g. marking DELIVERED before PICKED_UP, or acting on someone else's assignment): rejected with a 409/403 and a clear reason, not silently accepted.
- **Assigning an already-completed request:** blocked once status is DELIVERED or CANCELLED.

See `TRADEOFFS.md` for what's *not* handled and why.
