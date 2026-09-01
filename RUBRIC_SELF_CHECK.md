# Reflex — Rubric Self-Check

Run through before submission. Each row maps a rubric competency to the specific place in the deliverables where it's satisfied.

---

## Synthesis & Narrative (target: 5)

*"Every slide lands one takeaway; a non-technical stakeholder would follow the whole story."*

| Slide | One takeaway |
|---|---|
| 1. Title | Reflex replaces fragmented WhatsApp/phone coordination with one shared, live delivery record |
| 2. The coordination gap | The problem is missing shared state, not simply moving parcels |
| 3. Three people, one broken thread | Retailer, dispatcher and rider each lose something different in the current process |
| 4. One shared record, live for everyone | Reflex gives every role the right view of the same delivery state |
| 5. From request to doorstep | A clear state machine gives each step one owner and blocks illegal jumps |
| 6. Built for spotty connectivity | The stack is intentionally small, relational, real-time and offline-capable |
| 7. The status column that doesn't exist | Current status is derived from an append-only event log rather than overwritten |
| 8. Live when connected, safe when it's not | WebSockets provide live updates while IndexedDB + idempotency protect offline replay |
| 9. What we simplified — and why | The pilot accepts bounded infrastructure and onboarding trade-offs instead of hiding them |
| 10. Where real systems break | Delivery-code enforcement, stuck-in-transit recovery and failed-delivery reassignment are explicit system paths |
| 11. What's next | The next gains are role-controlled onboarding, scale-out messaging, richer proof and better offline UX |
| 12. Ready for cross-exam | The build is live, the important flows are verified, and remaining gaps are named honestly |

**Current deck status:** the previous deck was written before the delivery-code enforcement, stuck-in-transit recovery, and dispatcher reassignment work. It should be replaced with the updated 12-slide deck so the presentation matches the current build.

**Self-assessment:** the narrative remains a 5-band structure when the deck is updated to these current takeaways. The story is still problem → solution → architecture → trade-offs → roadmap, but the evidence now includes the completed delivery-control and recovery paths.

---

## Defense & Cross-Exam (target: 5)

*"Uses State→Context→Evidence consistently; says 'I don't know, here's how I'd find out' when appropriate instead of bluffing."*

- The **Demo Script** (`Reflex_Demo_Script.docx`) remains the presentation handoff into cross-exam and should be kept aligned with the current demo order.
- The **trade-off log** (`TRADEOFFS.md`) should describe the current gaps, not previously fixed vulnerabilities.
- The architecture gives concrete evidence to defend: append-only status events, server-side transition guards, server-generated delivery codes, single-use confirmation records, reassignment after failure, and idempotent offline replay.
- **Live production evidence verified during the latest test session:**
  - Retailer created an order and received a server-generated customer delivery code.
  - Dispatcher assigned the order to the rider.
  - Rider moved the order to `PICKED_UP`.
  - Rider completed delivery using the customer delivery code, producing `DELIVERED`.
  - A second order was deliberately taken through `FAILED`.
  - Dispatcher successfully reassigned the failed order.
  - The reassigned rider then picked it up and completed delivery successfully.

**Important honesty boundary:** this live session verified the core delivery lifecycle and failure/reassignment recovery. It did **not** constitute two timed presentation dry runs, so the timing requirement remains open.

---

## Delivery & Presence (target: 5)

*"Hits time exactly, transitions between presenters are invisible, visuals support rather than repeat the speech."*

- **Timing:** the demo script is budgeted to the second across 9 segments totaling exactly 10:00. The timing log remains the correct place to record actual stopwatch results.
- **Current evidence:** the application workflow has now been rehearsed live in production, including both successful delivery and failed-delivery reassignment.
- **Still outstanding:** two full timed presentation dry runs have not been completed. This cannot honestly be marked complete until the presentation is actually delivered against a stopwatch.
- **Visuals:** the updated deck should use short claims and simple diagrams rather than reproducing the implementation details in paragraph form.
- **Solo delivery:** no presenter handoffs are required; the main risk is pacing and screen-switch dead air.

**Gap to close yourself:** complete two full timed runs and record the real numbers. Do not invent timing evidence.

---

## Deliverables checklist — current status

| Item | Status |
|---|---|
| Frozen build / documented design | ✅ Current build is deployed to Render and the core delivery lifecycle has been verified live. The build includes delivery codes, server-side delivery confirmation enforcement, rider ratings, stuck-in-transit handling, dispatcher reassignment after failure, offline idempotency, WebSocket updates, and automatic schema initialization/migrations. |
| Deck (Problem→Solution→Architecture→Trade-offs→Roadmap, one takeaway/slide) | ⚠️ Current source content has been reworked here, but `Reflex_Executive_Deck.pptx` must be regenerated so it no longer describes the earlier pre-enforcement/pre-reassignment build. |
| One-page trade-off log, 3+ weak points, "acceptable because…" | ⚠️ `TRADEOFFS.md` must be kept aligned with the current implementation; the old entries describing a direct delivery-code bypass and an unrecoverable `STUCK_IN_TRANSIT` state are no longer accurate. |
| Demo script | ⚠️ Keep `Reflex_Demo_Script.docx` aligned with the current successful delivery-code and failed-delivery reassignment flow. |
| Timing log from ≥2 dry runs | ⚠️ Not complete — still requires two real timed presentation rehearsals. |

---

## Current implementation evidence

The production workflow now supports and has been manually verified end-to-end:

1. Retailer creates a delivery request.
2. Server generates a unique customer delivery code.
3. Dispatcher assigns a rider.
4. Rider picks up the request.
5. Rider completes delivery through the delivery-code confirmation path.
6. A rider can report a failed delivery.
7. Dispatcher can reassign a failed request.
8. The reassigned rider can pick up and complete the request.

The key state-machine protections are server-side: direct `DELIVERED` bypasses are rejected, and `STUCK_IN_TRANSIT` can recover through `FAILED` or delivery-code confirmation.

---

## Format: solo

Defense is solo. Every slide, every question, every segment of the demo is yours — no ownership split and no question routing to plan. The deck and demo should remain in first-person singular throughout. The full 10-minute budget is your pacing to own end to end, so practice the segment transitions (demo → slide → demo) without creating dead air while switching screens.
