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

**Math Dojo: the Retention Gauntlet was empty for half the students who had
played, and it was a data problem, not a Dojo one.** `skill_progress.user_id`
holds a profile id — that is what the client writes and what everything reads —
but the column's foreign key pointed at the auth users table instead. Older
profiles were created with those two ids equal, so for them it passed by
coincidence; every profile made since fails the write silently and only the
session row lands. That is why the students looked like they were playing and
the progress simply was not there.

Of the 47 who had played: 23 with matching ids all had progress, 24 with
differing ids had none. The split is exactly whether the two ids coincide.
**Fixed in the backend repo and already applied** — nothing to run by hand. Any
student who plays now accumulates skills properly; existing students start
building from their next session.

**Worth knowing generally:** if something writes fine for some students and
silently not for others, check whether it keys on the profile id or the auth id.
Those two are equal on older accounts and different on newer ones, so this class
of bug always looks like "it works for most people".

**Two Dojo fixes alongside it.** Holding Enter in Guided Learning used to walk
the whole problem on its own — the handler was on `keypress`, which auto-repeats,
and a correct answer schedules the next step on a timer, so every repeat landing
in that window submitted again. And the Decimals "Understanding" sub-skill taught
place value then practised nothing but "which is greater" — it is the first
sub-skill, so it is the only one unlocked when the lesson ends, and that was
every question a student saw. Practice now asks what the lesson taught, in the
same words its own guided steps accept.

**Needs:** nothing.

---

## 2026-09-11 — Jordan's Claude

**Parents can now report their own child away.** A *Report an Absence* action on
the parent home screen: child, dates, optional reason. It lands on the same
Upcoming Absences list staff see, marked *reported by a parent*, and fills the
register in on the day like any other.

**Staff get an in-app notification** — every admin, plus the teachers of the
classes that child is actively enrolled in. Deliberately not the whole staff
list: a message that goes to everyone is read by nobody, and the people who will
notice an empty seat are the ones teaching the child. For the most-enrolled
student in the school that comes to seven people.

**There is no approval step, on purpose.** A parent saying their child will be
away is the authoritative source for that fact, and making someone rubber-stamp
it would leave the register wrong until they got round to it. Staff can see
which rows came from a family and delete any of them — that is the control.
Parents can withdraw their own submissions, and can see the ones the office
entered for their children, so a family is never surprised by a change to their
own register.

**Backend:** a `source` column on `planned_absences` and an
`rt_submit_planned_absence` function, both already applied and committed to the
backend repo. The staff form goes through that same function, so its range
checks — nothing ending in the past, nothing longer than 180 days — apply to
whoever is typing.

**Needs:** an eye on the notification volume once families start using it. If
seven people per absence turns out to be six too many, the audience is one query
in that function and easy to narrow to admins only.

---

## 2026-09-11 — Jordan's Claude

**Absences you know about in advance.** The office is told on Friday that a
student is away Monday to Wednesday; there was nowhere to put that. Now there is
an **Upcoming Absences** panel at the top of the Attendance screen, and Riven
takes it in a sentence — *"Noah is out monday to wednesday"*, *"Jason will be
missing 17, 18 and the 21st of this month"*. Scattered days are kept scattered:
that last one is two stretches, not a five-day block, so nobody is marked absent
on days no one mentioned.

**On the day, opening the register fills them in** — the day record and every
class that actually meets, per period. It only ever fills gaps. A student who
turns up anyway and is marked present stays present, however many times the
register is re-opened, so this can never undo a teacher.

**It is deliberately not a future-dated attendance row.** That needed no new
table and would have worked on the day for free, but a plan and a record are
different things: a future row is indistinguishable from an absence that
happened, so every attendance percentage and every "who has bad attendance" scan
would count next week's family trip as a mark against the student today.

**Backend:** a `planned_absences` table and an `rt_apply_planned_absences`
function. **Both are already applied to the live database** and the migration is
committed in the backend repo — nothing to run by hand. Flagging it here because
your side cannot read that repo, so this is the only place it shows up for you.

**Worth knowing if a register ever looks doubled:** class marks are written per
period, taken from the class timetable. A mark with no period sits in a
different slot from a teacher's and would survive alongside it rather than being
replaced. If you add any other automatic class mark, give it the period.

**Needs:** nothing. Say if you want the panel somewhere other than Attendance,
or parents able to submit these for their own children — right now it is staff
who record them.

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

---

## 2026-09-11 — Jordan's Claude

**Students no longer open their own accounts.** Register and Activate are both gone from
the sign-in page. Register is now a parent-only form (no account type, no grade, no
enrolment type); Activate is deleted outright, along with `handleActivate` and
`showActivateForm`.

Why, because the diff looks like a feature being taken away: every pupil is already on the
roster before they see the site, and that profile is where the attendance, grades, skills
and RTC live. Neither self-service route could find it — neither asked for anything a
stranger would not also know — so a student who used one got a SECOND profile with none of
the history, and that is the one they then signed in to. Three such pairs were merged by
hand this week; one had 28 skill records stranded on the self-made row. Activate could not
have worked in any case: it called `student_username_unclaimed()`, which does not exist on
this database, and asked for usernames (`ruthie.argon`, a misspelt `Malea`, `Samantha H.`)
that the students holding them could not type.

**What replaces it.** Someone who already knows the child sends an address:

- teacher or admin, from the roster or the student hub — unchanged, already worked;
- **a parent, for a child linked to them** — new. The button appears on the parent
  dashboard (sign-in page) and the parent home (portal) for any linked child with
  `can_login = false`.

Both go through the same `admin-activate-student` edge function, which opens the login on
the existing profile and mails a set-password link. A parent's entitlement is the LINK
itself, which costs either the code the school printed for that child or a request an admin
approved by hand — both already put a person between a stranger and a pupil.

**Applied to the backend already** (both live, nothing for anyone to run):

- `create_signup_profile` refuses `user_type = 'student'`. This page is public and served
  verbatim, so a removed `<option>` stops nobody; the refusal has to be server-side.
- `admin-activate-student` redeployed (v8) admitting a linked parent. It reads the request
  body before deciding, because a parent's permission depends on which child they named.

**One thing to know about edge functions.** A deploy that carries `--no-verify-jwt` STICKS.
A later deploy without the flag does not put it back — only an entry in `supabase/config.toml`
does. `admin-activate-student` is pinned there now for that reason.

**Left alone deliberately.** Parent self-registration stays open: a parent needs an account
before they can link a child, and that link is what lets them activate. The enrolment
application at `/enrollment/` is untouched.

`tests/no-student-self-signup.test.js` — 81 assertions, covering both the doors being shut
and the parent's door leading where the office's does.

---

## 2026-09-11 — Jordan's Claude (audit)

**Audited every path that creates a student or parent account, and every path
that links a parent to a child.** Two mistakes ran through several of them.

**A flag is not a login.** `can_login` and `account_status` are claims;
`auth_user_id` is the fact, and rows exist where they disagree. The old Activate
button set the flag and created nothing; approving an enrolment set `can_login`
true on the strength of a comment saying an admin would create the auth user
"separately", which no caller has ever done. Every screen reading the flag
showed those students as finished and hid the button that fixes them. One live
student was in exactly that state and did not appear on the Inactive Students
list. `isActivated()` (portal) and the new `childHasLogin()` (sign-in page) are
now the one rule, used by both parent-facing buttons and by that list.

**Two kinds of id in one column.** `parent_child_links.parent_id` holds an auth
id. A parent who signed themselves up has the same value for both ids, so
passing either worked and nobody noticed — but a parent created by approving an
enrolment gets a fresh uuid and no login, and the same code then failed on the
constraint. Inside the enrolment function's exception handler that rolled the
whole approval back: no student, no medical record, no waivers, and an error
message naming a constraint. **Every genuinely new family hit this.** The admin
parents table now resolves the id, offers a parent with no login the *account*
rather than a link that cannot be written, and `linkChildToParent` refuses an
unresolvable parent with a sentence instead of a constraint name.

**Approval stops overstating itself.** The confirm no longer promises "a login
account will be created with their email", the approval email no longer tells
the family the same, and the admin is shown what is still outstanding.

**Not fixed, deliberately — all outside account creation:**

- `app.editRubric(...)` is a button with no method behind it (Rubrics screen).
- `teacher_purchase_privilege` is called from the client and does not exist.
- `shared/arcade/FirebaseManager.js` calls a `firebase-token` function that is
  not deployed.
- One login exists with no profile behind it, from the old Activate flow.
  Removing it deletes an auth user, so it is Jordan's call, not mine.

Backend changes are in the private repo and are already applied. Suite green;
`tests/account-paths-audit.test.js` (24) and `tests/no-student-self-signup.test.js` (84).

---

## 2026-09-11 — Jordan's Claude (loose ends)

**Riven answered a question with a refusal.** "What days are Jonathan missing?"
was matching PLAN_ABSENCE — "are ... missing" is one of its patterns — so the
question guard fired and Riven explained it does not change data on a maybe,
while holding the answer. The write intent now stands down entirely for a
which-days question instead of being suppressed and still winning, and the read
intent learned the phrasings. Every new pattern insists on is/are/will, because
"what days WAS she out" is a question about the register; the harness caught
that the moment the tense guard was missing.

**The rubric Edit button now edits.** It called a method nobody wrote, so the
only way to change a rubric was delete-and-rebuild — and assignments carry
`rubric_id`, so rebuilding hands every assignment that used it a rubric it has
never heard of. It reuses the create form rather than growing a second one, and
puts the old levels back if the save half-fails.

**Privilege purchases are atomic again.** The Riven terminal has always called
`teacher_purchase_privilege` with a sequential fallback behind it. The function
existed only in the backend repo's `_archive` and had never been applied, so
every purchase took the fallback: deduct in one statement, grant in another,
which can charge a student for something they do not get. Applied, with its
caller lookup fixed — it resolved the caller by profile id only, so a teacher
whose ids differ was told they were not allowed.

**Still blocked, needs you:** `shared/arcade/FirebaseManager.js` calls a
`firebase-token` function that is written but not deployed, because it needs
two secrets from a Firebase service-account JSON that do not exist on the
project (`FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`). Deploying without
them turns a 404 into a runtime error and fixes nothing, so it is left alone.
There is no anonymous fallback — arcade multiplayer identity is down until
those are set.

**The orphan login is not debris, and I did not touch it.** It has a confirmed
address and fourteen sign-ins, the most recent six days after it was made:
somebody has been trying to use the portal and landing on nothing. The roster
holds a similarly-named person, but at a *different* address, who already has a
login of their own and has left the school — so matching them would be exactly
the guess that produced the duplicate students. Instead, **Staff & Parents now
lists any sign-in with no account behind it**, with an explicit warning not to
guess. Identifying this one needs somebody who knows the family.

---

## 2026-09-11 — Jordan's Claude (class register)

**The class register now shows who is actually in that day.** A class roster is
an enrolment list — it says who takes the subject, not which days they come in.
That is `student_schedule`, the same timetable the morning register reads. So a
Tuesday/Thursday child sat on every Monday register, and the only mark that fits
them, absent, is false and then feeds the attendance reports.

It is not a plain filter, because two kinds of student would lose a record:

- **A mark that already exists.** `saveClassAttendance` deletes every row for the
  class/date/period and re-inserts what the page is showing. A hidden student is
  not merely invisible — their existing mark is destroyed by the next save
  anybody makes. 31 marks this school year sit on an off-timetable day.
- **A child with no timetable at all.** Five active students have none. That is
  a gap in the office's records, not a child who stays home, and hiding them is
  how somebody goes unmarked for a term.

Both appear under the register in a second list, each labelled with which case
they are, and the search box reaches them. Everyone else is simply gone, which
is what was asked for.

The row markup is now `_classAttendanceRowHtml()` — one template for both lists,
because two copies of a block that size drift apart on the first change.

**If you change the roster rule, change it in one place:** the morning register,
Riven's cohort register and this all read `student_schedule` for the weekday. A
student with no rows at all is excluded by the first two and *shown* by this
one, deliberately — a missing daily row is noticeable, an empty class register
is not.

`tests/class-register-day-roster.test.js` — 23 assertions, the sharpest being
that a student with an existing mark survives the filter.

---

## 2026-09-11 — Jordan's Claude (Riven: enrolment)

**"Is Jonathan a full time or homeschool student?" answered with a class
picker.** "Homeschool" is two things here at once: the enrolment type of 36 of
the 138 students on the roll, and a cohort qualifier inside four class names
("Creative Writing - Older Homeschool"). Class matching takes any distinctive
word of four letters or more as partial evidence, so the bare word matched all
of them, and a picker is what ambiguity looks like.

Two halves:

- **The bare word no longer names a class.** It joins `grade`, `class` and the
  rest in `genericWords`, so it is dropped from class *name* words. Nothing
  becomes unreachable: "older homeschool" still resolves on "older", "Film -
  Homeschoolers" on "film", and "creative writing" on its own two words. It
  only stops the word alone standing in for a class nobody named. As a
  side-effect, "the older homeschool class" now resolves to exactly that class
  — before, it was ambiguous across all three.
- **The question has an answer.** `ENROLLMENT_TYPE` reads the type off the
  profile and pairs it with the days the student actually comes in, since that
  is what the label means in practice. `ENROLLMENT_COUNTS` answers the same
  question about the whole school ("how many homeschool students do we have"),
  which was giving the identical picker before.

Neither guesses. An empty `enrollment_type` is reported as empty rather than
assumed full-time — the difference is a fee arrangement, and a wrong number
here gets quoted to a parent.

**The harness roster now carries the real class names.** Without three classes
named "… Homeschool" in `debug-tools/nlp-stress.js`, this whole class of bug is
invisible to it. If you add vocabulary that doubles as both a class name and a
student property, put a class carrying it in that list.

RIVEN_BUILD → 2026-09-11·e. nlp-stress green, frontdoor-precision 100%.
`tests/riven-enrolment-type.test.js` — 26 assertions.

---

## 2026-09-11 — Jordan's Claude (Riven: the student record)

**Riven could read most of a student's record and change almost none of it.**
Contact details were the only writable part. It now reads and writes the rest.

**Reads (teachers):** `VIEW_SCHEDULE` ("what days does Jonathan attend") and
`VIEW_PARENTS` ("who are his parents"). The first was the reported bug — it was
landing on the student card, or on a "did you mean flag attendance problems?"
clarify, which is what happens when nothing owns a question.

**Writes (admins only):** enrolment type, attending days, grade level, name, and
parent linking. All confirm, all push an undo. `move X to 8th grade` used to
land on VIEW_GRADES, which shows marks and changes nothing.

**The gate is real, not cosmetic.** A `BEFORE UPDATE` trigger on `user_profiles`
protects `first_name`, `last_name`, `grade_level` and `enrollment_type` on
student rows. Checked against the live database first: RLS gave a teacher the
whole row, so they could already rename a student or move their year group.
Now 42501 for a teacher, unchanged for admins, unchanged for anything with no
JWT (the service role and edge functions both write profiles that way).

Phone, email, address and DOB are deliberately **not** protected — those are the
corrections a teacher makes from the classroom, and RLS already scopes them to
their own students. `student_schedule` and `parent_child_links` needed nothing;
RLS already refused teachers on both.

**Nothing in the portal lost a button:** `changeStudentGrade`,
`changeEnrollmentType` and `editStudentProfile` exist in `portal/index.html`
with **no call sites at all**. Riven is now the only route to any of them,
which is worth knowing before anyone wires those buttons up — they would fail
for a teacher.

Two patterns had to be tightened after the harness caught them: "what enrollment
type is noah" was being read as a command to set it, and "remind me to call
dylans parents" was being answered with a phone number.

RIVEN_BUILD → 2026-09-11·f. nlp-stress green, frontdoor-precision 100%.
`tests/riven-student-record.test.js` — 54 assertions.
