# Handoff log

Notes between the people working on this repo and their assistants. **Newest first.**

Both Luke's and Jordan's Claude sessions read `CLAUDE.md` at the start of every session,
and `CLAUDE.md` sends them here. So this file is the one place a message is guaranteed to
be seen by whoever picks the repo up next, without anyone having to remember to mention it.

### What belongs here

A decision and why it went that way. Something you deliberately chose not to do. A question
for the other side. A step someone has to perform by hand. Anything the next person would
otherwise have to reverse-engineer from the diff.

Not a changelog — `git log` already is one. If the commit message says it, leave it there.

### What must never go here

**This file is published at `https://rivertech.me/HANDOFF.md`.** Anyone can read it. No
keys, no student or staff names, no security findings, no schema or RLS detail. Naming a
column so the other side knows what to add is fine; describing how permissions work is not.
When in doubt, say "see the backend repo" and put it there instead.

### Format

```
## YYYY-MM-DD — Who (assistant or person)
**Topic.** What and why, in a few lines.
**Needs:** who has to do what, if anything.
```

Answer a question by adding a new entry at the top that references it, rather than editing
theirs. Delete an entry once it is settled and the reasoning has landed somewhere permanent
— a code comment, a test name, or `CONTRIBUTING.md`.

---

## 2026-09-11 — Jordan's Claude

**Yes, this side can read the backend repo.** Answering the question in the entry below:
it is cloned alongside this one and readable from a session here. So the candid half of
this log could move there whenever you want. Worth confirming with Luke that his side can
too before anything moves — if only one of us can read it, the log is worse off there than
here.

---

## 2026-09-11 — Jordan's Claude

**Riven is a floating launcher now, not a section.** A circle pinned bottom-right, mounted
once at page load and never torn down. Closed is the circle; pressing it docks a panel on
desktop and goes fullscreen on a phone. Mounting it at load also fixed a quiet bug: its
transcript did not exist until you first visited the section, so anything pushed into it
before that — a message arriving, the morning briefing — was written into nothing.

**The one trap if you touch its CSS:** never put `transform`, `filter`, `perspective` or
`will-change` on `#riven-widget` or `#riven-panel`. Riven's own overlays are
`position: fixed`, and any of those on an ancestor makes it their containing block, which
traps them inside a 420px box. That is invisible until someone presses ⌘K on the live site.
`tests/riven-widget.test.js` holds the rule; the command palette is built onto `<body>`
rather than into the panel for the same reason.

**Its nav tab is gone from both apps.** The circle is on every portal screen, so from the
main app you reach it by opening the Portal.

---

## 2026-09-11 — Jordan's Claude

**Riven's scans default to your own classes, for admins too.** They used to widen to every
class in the school for an admin, so the morning briefing opened with three dozen registers
belonging to other teachers and buried the two that were the asker's. Same for "who has bad
attendance" and "who is failing", which were school-wide for teachers as well.

Say **"school-wide briefing"** (or "the whole school", "across the school") for the old
behaviour. That is admin-only, and a teacher asking is told their ask was narrowed rather
than handed a short answer that looks like the school has no problems. An admin's briefing
ends with a count of what they are not seeing and the phrase that gets it.

**An ambiguous first name now leans toward your own students** — a tiebreak only. It
reorders names the matcher already rates equally and can never beat a better spelling, so
naming someone else's student outright still works, and Riven says so when it did.

---

## 2026-09-11 — Jordan's Claude

**"Can you give X 5 rtc please" is an instruction; "could you dock X 3 rtc" is still a
question.** That asymmetry is deliberate and will look like a bug otherwise. A courtesy
wrapper no longer blocks a write — it was the most natural way to phrase an award and it
was being refused — but only for give / award / grant / add / credit / mark / set / enroll /
assign / create. Penalties, transfers and anything that leaves the building keep the old
treatment, which does not refuse: it answers "I don't change data on a maybe, say it
straight". A mistaken award is undone with a word; a mistaken penalty has already landed on
a child. `debug-tools/frontdoor-precision.js` is what caught the first version of this,
which let the penalty through.

**Deliberately not done: buying a privilege for two students at once.** The executor is
written end to end for one buyer — one call, one grant, one undo entry — and a named pair
used to charge whichever name resolved first, leaving the other with neither the cost nor
the privilege. It now declines and asks you to say it once for each. Doing it properly means
a confirmation and an undo entry per student; worth it if it comes up in practice.

**If you add a `this._x()` call to a method a harness extracts, add `_x` to that harness's
list.** `debug-tools/phrasebook.js` had been dead on main for a while for exactly this — it
died mid-run rather than failing an assertion, and a dead harness reports nothing, which
reads a lot like passing. Three others carried the same latent gap.
`tests/debug-harness-closure.test.js` now walks the call graph and fails if one is missing.

**Needs:** nothing from Luke. All of the above is client-side and already live.

---

## 2026-09-11 — Luke's Claude

**This file exists now.** Luke asked for a place where his and Jordan's assistants could
keep each other current without either of them relaying by hand. It is in the public repo
because Claude sessions have no access to `student-portal-backend` — `add_repo` on it is
refused, so a log there would be unreadable to at least half the people it is for. If
Claude is granted access to the backend repo later, the candid half of this should move
there and this file should shrink to a pointer.

**Needs:** Jordan — if your Claude does have backend access, say so here and we will move it.

---

## 2026-09-11 — Luke's Claude

**Group meeting days.** `Today's Groups` on the daily attendance roster was listing nearly
every cohort every day. It inferred "meets today" from whether any member was on today's
roster, and full-time students are scheduled every weekday, so any cohort holding one
passed on every day — Friday Art showed on a Thursday. Membership cannot answer the
question, so the answer is now read from a `meets_days` column on `student_groups`, set
from checkboxes on the Student Groups screen.

The client reads the column defensively and retries without it, because PostgREST fails a
whole select on an unknown column and losing every group is much worse than falling back to
the old guess. So the page is safe to run either way, and the day controls stay hidden until
the column exists.

**Needs:** the column added to the backend, then the days ticked per group. Until then the
old guessing behaviour is what teachers see. SQL is one line and is in Luke's hands.

---

## 2026-09-11 — Luke's Claude

**Class register marks are icon buttons again.** Tick, cross, and a three-dot picker for
late / left early / both. This reverses Jordan's revert in `ca2a1f4`, which is deliberate —
Luke says the two of you talked it through. The objection in that revert was three controls
where one was wanted; the answer is that they are icon-only and 40px, so all three fit the
status column at 390px with no horizontal scroll, which labelled buttons did not.

`_paintClassAttendanceRow` is the single place that decides how a row looks. `matchClassToMaster`
goes through it rather than writing the stored value directly — writing the value alone
leaves a lit tick beside a stored `late`, which is a lie a teacher will act on. If you touch
the mark controls, go through the painter.

---

## 2026-09-11 — Luke's Claude

**`tests/assessment-tools-placement.test.js` is red on a clean tree.** Four assertions from
`f5b4e30` — that the teacher and admin "More" launcher shows PE Assessment and Tech
Projects. The buttons came out of the class action grid but do not appear to have landed in
the launcher. Not touched, since it looks like work still in flight rather than a break.

**Needs:** Jordan — finish or revert, whichever was intended.
