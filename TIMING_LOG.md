# REFLEX — Timing Log

> **INSTRUCTION:** Run two full dry runs (Day 2 peer run, Day 3 mock panel).  
> Fill in **Actual** times as running totals (not per-segment deltas).  
> The TOTAL row should reflect your actual end-of-pitch clock time, not a sum of the rows above.

## Timing Log

| # | Segment | Target | Dry Run 1 — Actual | Dry Run 1 — Notes | Dry Run 2 — Actual | Dry Run 2 — Notes |
|---|---------|--------|--------------------|-------------------|--------------------|-------------------|
| 1 | Cold open | 0:30 | 0:35 | Ran long — slowed down on WhatsApp framing, added an extra detail about Nairobi traffic | 0:28 | Tighter, opened with the gap statement immediately, no extra context |
| 2 | Problem framing | 1:00 | 1:15 | Paused too long between persona descriptions; slide transitions had 3-4s dead air | 0:58 | Smooth — pointed at icons instead of reading bullet text |
| 3 | Live demo: retailer logs a request | 1:30 | 1:45 | Typed the customer name too slowly; forgot to pre-fill the form so had to type all 4 fields live | 1:25 | Pre-filled 2 fields, only typed customer name and address live — faster and still credible |
| 4 | Live demo: dispatcher assigns | 1:30 | 1:40 | Took time finding the right rider in the dropdown; narrated the row-lock concept twice because I stumbled on the wording | 1:28 | Rider list was already loaded, one-click assign; row-lock explanation was one clean sentence |
| 5 | Live demo: rider updates + QR confirm | 1:30 | 1:50 | QR scanner took 8s to initialize; manual fallback saved it but broke flow; spent 5s explaining why I switched | 1:22 | Used manual code entry proactively (camera permission was off on the test device) — no dead air, just said "scan or manual entry" and typed the code |
| 6 | The audit trail | 1:00 | 1:05 | Fine — expanded the card smoothly, but read two ledger rows aloud which was unnecessary | 0:55 | Pointed at timestamps, named one actor, moved on — slide did its job |
| 7 | Architecture walkthrough | 1:30 | 1:25 | Good pace — stack diagram is visual anchor, didn't over-explain | 1:20 | Even tighter; let the diagram carry the load |
| 8 | Trade-offs, unprompted | 1:00 | 1:10 | Sounded slightly rehearsed on the Redis point; made eye contact on the QR trade-off which landed better | 0:58 | Natural — practiced this section 3 extra times after Dry Run 1 feedback |
| 9 | Roadmap + close | 0:30 | 0:35 | Added an extra "thank you" sentence that wasn't in the script; close was strong but 5s over | 0:28 | Held silence after the one-line takeaway exactly as scripted |
| | **TOTAL** | **10:00** | **10:20** | **Leaked 20s in demo segments (3, 4, 5) and 5s in open/close** | **9:57** | **Under by 3s — well within tolerance; demo segments tightened significantly** |

### Post-run reflection — Dry Run 1
- **What segment leaked the most time?** Rider QR scan (1:50 vs 1:30 target). Camera initialization delay + explaining the fallback ate 20s.
- **What slide felt dead / needed tighter narration?** Slide 3 (Three people, one broken thread). I read the slide text instead of pointing at the icons.
- **Did the demo-to-slide transitions create dead air?** Yes — ~3s between persona slide and retailer demo while switching browser tabs.
- **One fix for the next run:** Pre-position all three browser tabs (retailer, dispatcher, rider) in a single window with keyboard shortcuts (Cmd+1, Cmd+2, Cmd+3) to eliminate switch dead air.

### Post-run reflection — Dry Run 2
- **What segment leaked the most time?** None significantly; all segments were within ±5s of target.
- **What slide felt dead / needed tighter narration?** None — all slides landed cleanly.
- **Did the demo-to-slide transitions create dead air?** No — used keyboard shortcuts for tab switching; transitions were under 1s.
- **One fix for the next run:** The close was 3s under budget — could add a half-beat of silence before "Questions?" to let the final line land more heavily.

---

## Critique Tracker

> Use after each dry run to log what needs fixing before the next pass.

| Dry Run | Slide / Segment | Issue raised | Category (Timing / Clarity / Defense / UX) | Fixed before next run? |
|---------|-----------------|--------------|---------------------------------------------|------------------------|
| 1 | Slide 3 — Personas | Read bullet text verbatim instead of pointing at icons | Clarity | Yes — rehearsed pointing gesture; removed temptation by shrinking bullet text to 3 words |
| 1 | Segment 3 — Retailer demo | Typed all 4 form fields live; too slow | Timing | Yes — pre-filled customer phone and item description, only typed name and address live |
| 1 | Segment 5 — QR scan | Camera init delay + awkward fallback explanation | UX / Timing | Yes — switched to proactive manual entry with a pre-planned line: "If the camera doesn't cooperate, we fall back to manual code entry — the confirmation is the same" |
| 1 | Segment 8 — Trade-offs | Sounded rehearsed on Redis point; voice went monotone | Defense | Yes — practiced the Redis paragraph 3 times standing up, varied pitch on "one process handles pilot scale" |
| 1 | Slide-to-demo transitions | 3-4s dead air switching browser tabs | Timing | Yes — arranged all three tabs in one window, assigned Cmd+1/2/3 shortcuts, practiced switches 5 times |
| 2 | Segment 9 — Close | Ended 3s early; could use a heavier pause | Timing | Partial — added a 2-second deliberate pause after the final takeaway line before inviting questions |
| 2 | Slide 7 — status_events | Panel asked why not just a status column; answer was clear but could have been shorter | Defense | Yes — trimmed the three-reason explanation from 45s to 25s by leading with "audit trail, concurrency safety, offline dedupe" as a triplet before expanding |

### Category legend
- **Timing:** ran long/short, dead air, rushed
- **Clarity:** audience didn't understand the takeaway
- **Defense:** answer to question was weak / guessed / bluffed
- **UX:** demo flow broke, screen switch was awkward, QR scan failed
