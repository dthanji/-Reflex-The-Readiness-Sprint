# Reflex — Complete Submission Bundle

Power Learn Project · "Reflex" Readiness Sprint

## What's in here

| File | What it is |
|---|---|
| `Reflex_Executive_Deck.pptx` | 12-slide defense deck — Problem → Solution → Architecture → Trade-offs → Roadmap, one takeaway per slide |
| `Reflex_Demo_Script.docx` | Second-by-second script for the 10-minute live demo |
| `Reflex_Timing_Log.xlsx` | Timing log template — fill in during your two required dry runs |
| `TRADEOFFS.md` | One-page trade-off log — 4 weak points, each with an "acceptable because…" |
| `ARCHITECTURE.md` | Full design rationale — stack, data model, flow, edge cases handled |
| `RUBRIC_SELF_CHECK.md` | Maps every deliverable to the scoring rubric, flags what still needs live rehearsal |
| `backend/` | Node/Express + PostgreSQL API, WebSocket broadcast, schema |
| `frontend/` | PWA — retail-styled UI, offline queue, QR scan confirmation |

## Before you submit — what YOU still need to do

Everything that can be built ahead of time is done and verified working.
Two things in the rubric can only be produced by you, live:

1. **Run the timing log for real.** `Reflex_Timing_Log.xlsx` has target times
   pre-filled; it needs your actual dry-run numbers in the yellow cells —
   at least two runs, per the Day 2 and Day 4 schedule.
2. **Rehearse the cross-exam answers out loud**, not just read them. The
   demo script gives you the words; Delivery & Presence is scored on how it
   lands live.

## Quick start (for your own rehearsal / the panel's benefit if they ask to see it run)

```bash
createdb reflex
psql -d reflex -f backend/schema.sql
cd backend && npm install && npm start
```
Then open `http://localhost:3000/`, register a retailer/dispatcher/rider account each, and run the flow from the demo script.

See `RUBRIC_SELF_CHECK.md` for the full breakdown against the scoring rubric.
