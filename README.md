# Reflex

Delivery coordination for small Kenyan retailers — a retailer logs a
request, a dispatcher assigns it to a rider, the rider updates status live,
with every transition kept in an append-only log.

Power Learn Project · "Reflex" Readiness Sprint · Solo submission

---

## Start here (for a grader)

| Read this for... | File |
|---|---|
| The 5-slide-arc executive story | `Reflex_Executive_Deck.pptx` |
| Why each architecture decision was made | `ARCHITECTURE.md` |
| The three weak points, named up front | `TRADEOFFS.md` |
| The scripted live demo, timed segment by segment | `Reflex_Demo_Script.docx` |
| Cross-exam prep, State→Context→Evidence | `ANTICIPATED_QA.md` |
| Rehearsal record — what's actually been practiced | `TIMING_LOG.md`, `CRITIQUE_TRACKER.md` |
| How every deliverable maps to the scoring rubric | `RUBRIC_SELF_CHECK.md` |
| The working code | `backend/`, `frontend/` |

## Running it

```bash
createdb reflex
psql -d reflex -f backend/schema.sql
cd backend
npm install
npm start
```

Open `http://localhost:3000/`. Register one account each as `retailer`,
`dispatcher`, and `rider`, then run the flow from `Reflex_Demo_Script.docx`:
retailer logs a request → dispatcher assigns it → rider marks it picked up
and scans a QR code to confirm delivery. Every screen updates live over
WebSocket as the others act.

Defaults connect to `postgres@localhost:5432/reflex` with password `reflex`
— override via `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`.

## Project structure

```
backend/
  schema.sql              — Postgres schema (append-only status_events log)
  src/
    server.js              — Express + WebSocket entry point
    auth.js                — JWT signing/verification middleware
    db.js                   — Postgres connection pool
    routes/
      auth.js               — register/login endpoints
      deliveries.js          — create/list requests, audit history
      assignments.js         — dispatcher assigns rider (row-locked)
      status.js              — rider status updates (idempotent), QR confirm
    websocket/hub.js        — broadcasts status events to connected clients
frontend/
  public/
    index.html, app.js, styles.css, idb-queue.js, service-worker.js
```

## Honesty note

`TIMING_LOG.md` and `CRITIQUE_TRACKER.md` reflect real rehearsal only — a
couple of segments practiced and cleaned up, plus one full run-through that
surfaced genuine gaps. The rest of those logs is intentionally blank,
waiting on real dry runs rather than filled with invented numbers. See
`RUBRIC_SELF_CHECK.md` for the full status against each rubric competency,
including what still needs to happen live before submission.
