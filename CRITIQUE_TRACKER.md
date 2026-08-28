# Reflex — Critique Tracker

> Log every issue raised during dry runs here. Fix before the next run.

| Dry Run | Slide / Segment | Issue raised | Category (Timing / Clarity / Defense / UX) | Fixed before next run? |
|---------|-----------------|--------------|---------------------------------------------|------------------------|
| 1 | Slide 3 — Personas | Read bullet text verbatim instead of pointing at icons | Clarity | Yes — rehearsed pointing gesture; removed temptation by shrinking bullet text to 3 words |
| 1 | Segment 3 — Retailer demo | Typed all 4 form fields live; too slow | Timing | Yes — pre-filled customer phone and item description, only typed name and address live |
| 1 | Segment 5 — QR scan | Camera init delay + awkward fallback explanation | UX / Timing | Yes — switched to proactive manual entry with a pre-planned line: "If the camera doesn't cooperate, we fall back to manual code entry — the confirmation is the same" |
| 1 | Segment 8 — Trade-offs | Sounded rehearsed on Redis point; voice went monotone | Defense | Yes — practiced the Redis paragraph 3 times standing up, varied pitch on "one process handles pilot scale" |
| 1 | Slide-to-demo transitions | 3-4s dead air switching browser tabs | Timing | Yes — arranged all three tabs in one window, assigned Cmd+1/2/3 shortcuts, practiced switches 5 times |
| 2 | Segment 9 — Close | Ended 3s early; could use a heavier pause | Timing | Partial — added a 2-second deliberate pause after the final takeaway line before inviting questions |
| 2 | Slide 7 — status_events | Panel asked why not just a status column; answer was clear but could have been shorter | Defense | Yes — trimmed the three-reason explanation from 45s to 25s by leading with "audit trail, concurrency safety, offline dedupe" as a triplet before expanding |
| 2 | General — Eye contact | Looked at the screen too often during trade-offs segment | Delivery | Yes — placed a sticky note on the monitor edge at eye level as a reminder to look up |

### Category legend
- **Timing:** ran long/short, dead air, rushed
- **Clarity:** audience didn't understand the takeaway
- **Defense:** answer to question was weak / guessed / bluffed
- **UX:** demo flow broke, screen switch was awkward, QR scan failed
- **Delivery:** body language, eye contact, voice projection

### Summary of fixes applied between Run 1 and Run 2
1. **Tab switching:** Moved all three personas (retailer, dispatcher, rider) into a single browser window and practiced Cmd+1/2/3 switches until they were under 1s.
2. **Form pre-fill:** Pre-filled 2 of 4 fields in the retailer form so live typing only takes ~10s instead of ~25s.
3. **QR fallback:** Switched from "try camera, fail, explain fallback" to "here's the scan — and if the camera doesn't cooperate, manual entry works the same." Eliminated the 8s camera init risk.
4. **Trade-off delivery:** Rehearsed the Redis paragraph standing up, recording myself, until it sounded conversational rather than read.
5. **Slide 3 text:** Reduced persona descriptions from full sentences to 3-word labels ("Logs voice note", "Juggles calls", "No handoff record") so I can't read them even if I try.

### Open items for final submission
- [x] Timing log complete (2 dry runs logged)
- [x] Critique tracker complete (all items fixed or planned)
- [x] Demo script rehearsed to under 10:00
- [x] Anticipated Q&A rehearsed out loud (all 4 categories)
- [ ] Final tech check: confirm Postgres running, backend started, three accounts pre-registered before panel day
