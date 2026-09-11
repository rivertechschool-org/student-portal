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
