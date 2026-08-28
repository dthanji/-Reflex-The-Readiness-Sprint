# Reflex — Rubric Self-Check

Run through before submission. Each row maps a rubric competency to the specific
place in the deliverables where it's satisfied.

---

## Synthesis & Narrative (target: 5)

*"Every slide lands one takeaway; a non-technical stakeholder would follow the whole story."*

| Slide | One takeaway |
|---|---|
| 1. Title | Reflex replaces WhatsApp coordination with one shared, live record |
| 2. The coordination gap | No visibility today — the problem, stated plainly |
| 3. Three people, one broken thread | Every persona loses something different in the current process |
| 4. One shared record, live for everyone | The core solution concept, one sentence |
| 5. From request to doorstep | The four-step flow, one owner per step |
| 6. Built for spotty connectivity | The stack, and why each piece was chosen |
| 7. The status column that doesn't exist | The single architecture decision worth defending hardest |
| 8. Live when connected, safe when it's not | Real-time + offline sync in one picture |
| 9. What we simplified — and why | Trade-offs surfaced before being asked |
| 10. Where real systems break | Edge cases named and how they're handled |
| 11. What's next | Roadmap, three concrete next steps |
| 12. Ready for cross-exam | The close — invites questions rather than avoiding them |

Check: no slide carries two ideas. Verified by re-reading each slide's title —
each is a single claim, not a list of claims.

**Self-assessment: meets the 5-band description.** A non-technical reader can
follow problem → solution → architecture → trade-offs → roadmap without
technical background, because each slide only asks them to hold one idea
before moving on.

---

## Defense & Cross-Exam (target: 5)

*"Uses State→Context→Evidence consistently; says 'I don't know, here's how I'd
find out' when appropriate instead of bluffing."*

- The **Demo Script** (`Reflex_Demo_Script.docx`) ends with an explicit
  cross-exam handoff instructing State → Context → Evidence for every answer,
  and models the "I don't know, here's how I'd find out" response.
- The **trade-off log** (`TRADEOFFS.md`) is written in exactly that structure
  for all four weak points: what it is (state) → why accepted (context) →
  what a real number/decision looked like (evidence).
- Live-tested evidence is available to cite under questioning, not just
  claimed: the full request→assign→pickup→deliver→confirm lifecycle was
  run against a real Postgres database; the idempotent dedupe on
  `client_event_id` was tested by deliberately replaying the same event
  twice; the row-lock against concurrent assignment was verified; the
  WebSocket broadcast was confirmed live between two connected clients.
  These aren't assumptions — they're things you watched happen, so if asked
  "did you test that" the answer is "yes, here's what I ran."

**Gap to close yourself:** State→Context→Evidence only scores a 5 if you
*deliver* it that way live, under real pressure. The script gives you the
structure; Day 2's dry run and Day 3's mock panel are where you prove you
can hold it without reading off a card. Practice the trade-offs section
(8:30–9:30 in the script) until it doesn't sound rehearsed.

---

## Delivery & Presence (target: 5)

*"Hits time exactly, transitions between presenters are invisible, visuals
support rather than repeat the speech."*

- **Timing:** the demo script is budgeted to the second across 9 segments
  totaling exactly 10:00. The `Reflex_Timing_Log.xlsx` workbook is ready for
  you to log actual times against that budget across at least two dry runs
  (Day 2 peer run, Day 3 mock panel) — **this is the one rubric item that
  can't be completed by me on your behalf, since it requires you to actually
  rehearse out loud against a clock.** Fill it in as you go.
- **Visuals support, don't repeat:** deck slides use short claims and
  diagrams (persona icons, status-flow arrows, architecture blocks) rather
  than paragraphs — the narration in the demo script carries the explanation,
  the slide carries the anchor point.
- **Transitions:** solo presentation — no handoffs to coordinate, so this
  competency reduces to keeping your own pacing steady and not letting the
  demo-to-slide switches create dead air.

**Gap to close yourself:** this competency is scored on live delivery, not
on what's written down. Two rehearsed dry runs, timed, are what earns the 5 —
the log just gives you a place to prove it happened.

---

## Deliverables checklist — status

| Item | Status |
|---|---|
| Frozen build / documented design | ✅ Full working repo — backend, PWA, live-tested |
| Deck (Problem→Solution→Architecture→Trade-offs→Roadmap, one takeaway/slide) | ✅ `Reflex_Executive_Deck.pptx`, 12 slides |
| One-page trade-off log, 3+ weak points, "acceptable because…" | ✅ `TRADEOFFS.md` |
| Demo script | ✅ `Reflex_Demo_Script.docx` |
| Timing log from ≥2 dry runs | ⚠️ Template ready (`Reflex_Timing_Log.xlsx`) — **actual timed numbers require you to run it out loud twice; this can't be fabricated on your behalf without misrepresenting work you haven't done yet** |

---

## Format: solo

Defense is solo. Every slide, every question, every segment of the demo is
yours — no ownership split, no question routing to plan. The demo script
and deck are already written in first-person singular throughout, so no
changes were needed there. The only implication for rehearsal: since there's
no second presenter to share the 10 minutes with, the full budget in
`Reflex_Timing_Log.xlsx` is your pacing to own end to end — practice the
segment transitions (demo → slide → demo) so they don't create dead air
while you're switching screens or windows solo.
