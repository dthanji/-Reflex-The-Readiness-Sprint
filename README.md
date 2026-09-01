# Reflex

Delivery coordination for small Kenyan retailers — a retailer logs a
request, a dispatcher assigns it to a rider, the rider updates status live
and confirms delivery with a server-generated code, with every transition
kept in an append-only log. Also includes rider ratings, automatic
stuck-in-transit detection, and reassignment on failed deliveries.

Power Learn Project · "Reflex" Readiness Sprint · Solo submission · Deployed on Render

---

## Start here (for a grader)

| Read this for... | File |
|---|---|
| The 5-slide-arc executive story | `Reflex_Executive_Deck.pptx` |
| Why each architecture decision was made | `ARCHITECTURE.md` |
| The weak points, named up front | `TRADEOFFS.md` |
| The scripted live demo, timed segment by segment | `Reflex_Demo_Script.docx` |
| Cross-exam prep, State→Context→Evidence | `ANTICIPATED_QA.md` |
| Rehearsal record — what's actually been practiced | `TIMING_LOG.md`, `CRITIQUE_TRACKER.md` |
| How every deliverable maps to the scoring rubric | `RUBRIC_SELF_CHECK.md` |
| The working code | `backend/`, `frontend/` |
| Production-hardening notes and deploy checklist | `DEPLOYMENT.md`, `Dockerfile`, `docker-compose.yml`, `backend/.env.example` |
| Automated test suite | `backend/test/` — run with `npm test` (see `backend/test/README.md`) |

## Running it

```bash
createdb reflex
cd backend
npm install
npm start
```

The app creates and migrates its own schema on first boot — no manual
`psql` step needed for a fresh database. (`backend/schema.sql` is still
there and still used, both by that first-boot check and as a full
wipe-and-reset option — see `.github/workflows/reset-db.yml` for a
no-local-install way to run it against a deployed database.)

Open `http://localhost:3000/`. Register one account each as `retailer`,
`dispatcher`, and `rider`, then run the flow from `Reflex_Demo_Script.docx`:
retailer logs a request → dispatcher assigns it → rider marks it picked up
and enters/scans the delivery code shown to the retailer to confirm
delivery → dispatcher rates the rider. Every screen updates live over
WebSocket as the others act.

Defaults connect to `postgres@localhost:5432/reflex` with password `reflex`
— override via `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, or
set a single `DATABASE_URL` instead (see `backend/.env.example`).

## Project structure

```
backend/
  schema.sql              — Postgres schema (append-only status_events log)
  src/
    server.js              — Express + WebSocket entry point, boot-time schema init/migration
    auth.js                — JWT signing/verification middleware
    db.js                   — Postgres connection pool
    routes/
      auth.js               — register/login endpoints
      deliveries.js          — create/list requests, audit history, delivery codes
      assignments.js         — dispatcher assigns/reassigns rider (row-locked)
      status.js              — rider status updates (idempotent), delivery-code confirm
      ratings.js              — dispatcher rates rider post-delivery
    websocket/hub.js        — broadcasts status events and assignment notifications
frontend/
  public/
    index.html, app.js, styles.css, idb-queue.js, service-worker.js,
    ratings.js/.css, retailer-tracking.js/.css, role-enhancements.js, stuck-status.js
```

## Deploying

See `DEPLOYMENT.md` for the full walkthrough (Render Blueprint, manual
Render setup, or plain Docker). `.github/workflows/reset-db.yml` gives a
way to wipe and reset the deployed database entirely from the browser, no
local tools required.

## Honesty note

`TIMING_LOG.md` and `CRITIQUE_TRACKER.md` reflect real rehearsal only — a
couple of segments practiced and cleaned up, plus one full run-through that
surfaced genuine gaps. The rest of those logs is intentionally blank,
waiting on real dry runs rather than filled with invented numbers. See
`RUBRIC_SELF_CHECK.md` for the full status against each rubric competency,
including what still needs to happen live before submission.
