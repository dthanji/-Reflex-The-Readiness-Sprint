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
| Proof of delivery | Server-generated delivery code, scanned or typed (`html5-qrcode`, browser camera) | No native app needed; the code is validated server-side against the specific request and against reuse, not just recorded as arbitrary scanned text |
| Deployment | Docker, deployed to Render | Same container locally and in production; Render's Blueprint (`render.yaml`) wires the web service and Postgres together automatically |

## Data model

- `users` — id, name, phone, password_hash, role (retailer / dispatcher / rider)
- `delivery_requests` — the request itself: customer, address, item, and a server-generated `delivery_code` (unique, shown to the retailer at creation). **No status column.**
- `assignments` — which rider is/was assigned to which request, and by whom
- `status_events` — **append-only.** Every transition (REQUESTED → ASSIGNED → PICKED_UP → DELIVERED / FAILED / STUCK_IN_TRANSIT) is a new row with actor and timestamp. Current status is always *derived* from the latest row here, never mutated in place.
- `delivery_confirmations` — records of successful delivery-code confirmations at the point of delivery
- `rider_ratings` — one rating (1–5, optional comment) per delivered order, entered by the dispatcher who made the assignment
- `delivery_request_state` — a view joining the latest status, current rider, and delivery code onto each request, so the app never has to re-derive it in application code

## Delivery codes (proof of delivery)

Each request gets a unique, server-generated `delivery_code` at creation time, shown to the retailer. The rider enters or scans this code to confirm delivery. The confirm endpoint checks three things before accepting it: the code matches *this specific* delivery (not just any valid code), the code hasn't been used before, and the delivery is currently `PICKED_UP`. This replaced an earlier version that accepted any scanned text as "proof" — see `TRADEOFFS.md` for what's still not fully closed here.

## Rider ratings

After a delivery reaches `DELIVERED`, the dispatcher who made the original assignment can rate the rider (1–5, optional comment) — one rating per delivery, enforced at the database level (`UNIQUE` on `delivery_request_id`). Riders can see their own rating history; dispatchers can see any rider's average rating and count before assigning them a new delivery.

## Stuck-in-transit monitoring

A background job runs every 15 minutes and flags any delivery that's been sitting in `PICKED_UP` for 24+ hours without a delivery or failure event, writing a `STUCK_IN_TRANSIT` status event and broadcasting it. This is informational — see `TRADEOFFS.md` for a real gap this currently creates.

## Reassignment

If a rider reports `FAILED`, a dispatcher can reassign the same request to a different rider via a separate endpoint, which records the reassignment reason in the event's metadata rather than silently overwriting anything.

## Automatic schema initialization

On boot, the app checks whether its tables exist and runs `schema.sql` if not, then runs a fixed set of idempotent migration statements (`ensureSchemaUpgrades()`) covering everything added since the base schema — new columns, new tables, backfilling `delivery_code` for any pre-existing rows. This means a fresh database needs no manual `psql` step; pointing a clean Postgres instance at the app and starting it is enough. Re-running `schema.sql` directly (e.g. via the `.github/workflows/reset-db.yml` GitHub Action) is still supported for a full wipe-and-restart, and is compatible with the migration step since it re-runs safely on the next boot regardless.

## Why append-only status events, not a mutable status column

Three reasons, in order of how they'd come up under cross-exam:

1. **Audit trail for free.** "What happened and when" is answerable with a single indexed query, not reconstructed from logs or guessed at.
2. **Concurrency safety.** Two actors racing to update the same request can't silently clobber each other's write — both events land, in order, and the transition guard (see below) rejects illegal ones.
3. **Idempotent offline replay.** A rider's queued update carries a `client_event_id`; replaying it twice inserts the event once, because the log is the natural place to dedupe against.

## Flow

1. **Retailer** submits a request → `status_events: REQUESTED`, a `delivery_code` is generated and shown to the retailer, broadcast to all dispatchers.
2. **Dispatcher** sees open requests live, assigns to a rider (can see each rider's average rating first). The assignment row is locked with `SELECT ... FOR UPDATE` on the base table to prevent a race where two dispatchers assign the same request simultaneously → `status_events: ASSIGNED`, broadcast to that retailer and rider.
3. **Rider** sees their queue, marks `PICKED_UP`, then enters or scans the delivery code to confirm `DELIVERED` — the code is checked against this specific request and against prior use before the status changes. Each transition is checked against a `VALID_TRANSITIONS` map server-side — you can't jump from REQUESTED straight to DELIVERED, and you can't act on a request that isn't yours.
4. If a rider reports `FAILED` instead, a dispatcher can reassign the request to a different rider.
5. Once `DELIVERED`, the assigning dispatcher can rate the rider.
6. Every event broadcasts over WebSocket to whoever has a stake in it: dispatchers see everything, retailers see their own requests, riders see their own assignments.

## Edge cases handled

- **Concurrent assignment:** row-level lock on `delivery_requests` before an assignment write.
- **Duplicate status submission** (offline retry): `client_event_id` unique index dedupes.
- **Illegal transition** (e.g. marking DELIVERED before PICKED_UP, or acting on someone else's assignment): rejected with a 409/403 and a clear reason, not silently accepted.
- **Assigning an already-completed request:** blocked once status is DELIVERED or CANCELLED.
- **Reused or mismatched delivery codes:** rejected before any status change happens.
- **Duplicate ratings:** enforced at the database level, one rating per delivered order.

See `TRADEOFFS.md` for what's *not* handled and why — including a real gap introduced by the stuck-in-transit monitor.
