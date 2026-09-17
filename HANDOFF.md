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

---

## 2026-09-12 — Jordan's Claude (correction + the manual routes)

**Correction to yesterday's entry.** I wrote that `changeStudentGrade`,
`changeEnrollmentType` and `editStudentProfile` had no call sites and that Riven
was therefore the only route to them. The first half is true; the conclusion was
wrong. **The Student Hub's Profile tab already edits all of those fields** via
`saveStudentHubProfile`, and the Attendance tab already edits the attending
days. Those three methods are superseded leftovers, not missing features.

That mattered, because the admin-only trigger I added yesterday protects exactly
those columns and **the Profile tab is open to every teacher**. A teacher filling
that form in and pressing Save would have got a policy error out of the
database. Fixed: the protected inputs are disabled for non-admins with a line
saying who does set them, and the save now sends only the fields that person may
change — a disabled input still has a value, and sending it is still an UPDATE
as far as the database is concerned.

The Attendance tab's "Save Schedule" got the same treatment. That one was **not**
a regression — RLS has never let a teacher write `student_schedule`, so the
button could only ever have failed for them. It just said nothing about it.

**There are no missing manual routes.** I swept both directions — methods called
but never defined, and methods defined but never called — across the portal.
32 came back unreferenced, and every one is either superseded (the Student Hub
covers the student record, its tabs cover emergency contacts, medical, waivers
and attendance; RTC Management absorbed the Bank Helper and IRL Store as tabs;
the `gradebook` object owns the gradebook cluster) or an unused helper. The
first sweep over-reported because it only looked for `app.` and `this.`
receivers and missed `gradebook.x()` entirely.

`tests/student-hub-record-gate.test.js` — 19 assertions holding the manual route
and Riven to the same rule.

---

## 2026-09-12 (overnight) — Jordan's Claude (Riven build-out)

Working through the portal's actions and giving Riven the ones an admin or a
teacher would want, with the gates each needs. Committed in batches; each one
has its own test file and its own nlp-stress cases.

**Done so far:** the student record (name, grade level, enrolment type, days,
parents) · the student lifecycle (withdraw, reinstate, PIN, parent link code,
unlink) · the day itself (excuse, pickup, cancel/uncancel a session, report
card, transcript) · classes and the calendar (who teaches a class, reopen,
current quarter) · assignments (edit, delete) · student groups (create, delete,
meeting days, membership).

**The gating rule that emerged.** Reads stay with teachers — they ask constantly
and none of it is theirs to change. Writes split by *what the fact is*: anything
about the student RECORD or the school's shape is admin (name, year group,
enrolment type, attending days, parents, cohorts, who teaches what, the
quarter); anything about the DAY is the teacher's, because they are standing
there (attendance, excusing, pickup, cancelling their own session, their own
assignments). `_rivenRequireAdmin` says it once; `_rivenCanManageClass` handles
the per-class cases.

**Three bugs found underneath, all worth knowing:**

- **An ordinary English word was being resolved as a student name.** This school
  has a *Carter*, so "what quarter are we in" and "delete the chapter 4
  assignment" both resolved to that student — the guard only applied to
  sentences with no command verb, and both have one. An exact common word is
  now never a name; a near-miss still needs command context.
- **A group's own name was read as a meeting day.** "Thursday Lab meets friday"
  parsed Thursday *and* Friday, so there was no way to say it meets Friday.
- **The shared test extractor never bound destructured parameters.** It sliced
  the signature to the first `{`, which is inside the parameter list for
  `_rivenCanManageClass`. Twelve test files carried the same copy.

**All of that is now done**, plus: grading a submission, enrolment applications,
staff roles and accounts, strikes, and both approval queues. `/help` lists the
new commands in two sections - The Day, and Admin Only - so they are
discoverable without reading this file.

**What is deliberately NOT in Riven:**

- **Inviting a teacher.** It sends an email and creates a login; the invite
  screen asks things a sentence does not carry.
- **Deleting anything permanently** - `hardDeleteUserAccount`, `hardDeleteClass`.
  Riven can close, archive and withdraw. Permanent deletion stays somewhere you
  have to navigate to on purpose.
- **Activities** (create/edit/delete). Enrolling in one already works; the rest
  is a scheduling form.
- **Documents, sheets, discussions, themes, Drive.** Editing surfaces rather
  than decisions.

**Still worth doing, in rough order of value:** grading a whole class at once
("everyone got full marks on the warm-up") · activity management · a "what
changed today" digest · teacher invitations if you want them in here after all.

---

## 2026-09-14 — Luke's Claude

**RTC Management can now be pointed at one student group.** The Balances tab has a
**Group** picker beside Search and Sort, listing every row in `student_groups` plus
"All groups". It narrows the same `_rtcFilteredStudents` list the table renders and the
bulk award reads, so "Award to All Filtered" awards to exactly that group.

Three decisions worth knowing:

- **The picker is on Balances only**, not on Transaction Log, Bank or IRL Store. Balances
  is the only tab that acts on many students at once; the others are per-student or
  read-only, so a group filter there would be decoration.
- **It does not persist across tab switches.** Search and Sort already reset when you
  leave and come back, and a sticky group filter is worse than inconsistent: a forgotten
  narrowing turns a bulk award into a quiet no-op for everyone else.
- **The bulk-award card now names its scope** — "Bulk Award to Junior High (12 students)"
  — and the confirm says "…to 12 student(s) in Junior High for …". The old heading read
  the same whether the list was one group or the whole school, and the gap between those
  two is every balance in the building. End-of-Year Rollover is untouched and still hits
  **all** students regardless of the picker; its buttons say "All" for that reason.

Groups load in their own promise with its own catch, so a `student_groups` read that
fails leaves the section working without the picker rather than taking RTC Management
down. Tests: `tests/rtc-group-filter.test.js` (18 assertions). Verified in Chromium
against a stubbed student set as well, since the picker is markup the DOM stub cannot
prove.

**No schema change** — `student_groups` and `student_group_members` are already read by
the portal elsewhere, and nothing new is written.

---

## 2026-09-14 — Jordan's Claude (Riven transcript bounds)

**The transcript never refreshed and only half of it was ever bounded.** The
saved copy was capped at 120 nodes; the live page kept every node it had ever
rendered. Worse, the save deep-cloned the whole live transcript 400ms after
every message in order to throw most of the copy away — so the cost grew with
how long the tab had been open, which on a phone in the afternoon is the one
you feel.

Now: the live page is trimmed to 200 nodes and the save reads the tail straight
off those nodes. No `cloneNode` anywhere in the file any more.

**Bytes, not nodes, are the real limit.** A Riven bubble is 647 bytes of markup
before any content, so one roster listing outweighs fifty "done"s. A save that
will not fit now retries with a shorter tail (200 → 80 → 30 → 10) instead of
the old behaviour, which caught its own quota error and deleted the whole saved
transcript silently. If nothing fits, it says so once.

**`savedAt` was written and never read.** A conversation from last term came
back mid-lesson looking like this morning's — and `_nlpContext.lastStudent`
came back with it, so "give him 5 rtc" pointed at a child nobody in the room
had mentioned. Transcripts older than a week are dropped on load.

Not a problem, checked: `_phi3History` was already capped at 12 messages, so the
local model's prompt cannot grow.

RIVEN_BUILD → 2026-09-14·a. `tests/riven-chat-bounds.test.js` — 24 assertions,
including a `cloneNode` that throws if anything ever deep-copies the transcript
again.

---

## 2026-09-14 — Luke's Claude (Worship Team)

**New page: `portal/worship.html`,** reached from a **Worship Team** button at the foot of
the Portal tab — for students and for staff, from one line in `navDestinations()` in
`shared/config.js`. It is a `secondary` destination with a `url`, which is what puts it in
the More launcher of both portals rather than in the nav bar. Parents do not have it.

The page is four things to four people: the join form to someone not on the team, the
roster and song library to a member, and the requests queue, roster controls, library and
scheduler to whoever runs it. Tabs: Team · Songs · Schedule · Requests.

**It will not work until the database side is run.** The tables, the policies and three
read functions were written this session and handed to Luke as a file to paste into the
SQL Editor. They are deliberately **not** in this repo — it is public, and access-control
rules are on the list of things that must never be committed here. Until that SQL is run,
the page loads and says it could not load; nothing else in the portal is affected. So the
branch should not be merged to `main` before the SQL is in.

**Three decisions worth knowing:**

- **Names come back through functions, not through a join.** A student may not read
  another student's profile row, so a roster assembled by embedding `user_profiles` would
  render a page of blanks for exactly the people who need to read it. Three small
  read-only functions return names and nothing else. Everything else is read straight off
  its own table.
- **A school admin runs the team without being on the roster.** They may never play. The
  database decides this, not the page; the page's admin flag only chooses which buttons
  are drawn.
- **Drafts are hidden by the page, not by a policy,** so that a draft is never invisible
  to the admin building it. A member sees a date only once it is published.

Songs and service types are removed by marking them inactive rather than deleted, because
past set lists name them and a hard delete would empty those lines.

Tests: `tests/worship-team.test.js` (40 assertions) covers the entry point for each role,
the calendar-day handling, the labels, and the rules above as they appear in the page.
`tests/assessment-tools-placement.test.js` grew a `PAGE_DESTINATIONS` list — its "no other
destination grew a url by accident" check now expects Worship Team too. Verified in
Chromium against a stubbed backend in both an admin and a non-member student session.

**Two notes for whoever is next:**

- **Run `node tests/extract-portalui.js` before the suite.** Four suites read
  `tests/portalui.js`, which is generated and not committed; without it they fail for a
  reason that has nothing to do with your change. Only `inequality-region` and
  `typed-answer-mode` are genuinely red on a clean tree.
- **`CLAUDE.md` contradicts itself about SQL.** The top rule forbids committing anything
  that describes access control; the "two repos" section says to write the exact SQL into
  this file. I followed the top rule and kept the SQL out, leaving this pointer instead.
  Luke may want to settle which one wins.

**More build instructions are expected on this page** — it was built to be added to.
Instruments live in one `INSTRUMENTS` list at the top; a fifth is one entry there and
nothing else. Slot status (`confirmed`/`declined`) and service-type notes exist in the
tables but have no controls yet, which is where "can people confirm they are coming?"
would go.

---

## 2026-09-14 — Luke's Claude (Worship / Band: the pills, and the name)

**Renamed: Worship Team → Worship / Band,** since the section is also for band work
that has nothing to do with a service. The label in `navDestinations()`, the page title,
the header, the join card and the denial message all say the new name; "worship admin"
reads as **team admin** for the same reason. `portal/worship.html`, the `worship_*` tables
and the `is_worship_admin` column keep the older name — they are already deployed, and
renaming them buys nothing that the comment at the top of the page does not.

**Fixed: no pill could be turned on.** Instruments, the team-admin flag and "★ Leads"
were each a `<label>` wrapping a hidden checkbox. Clicking one ran the handler, and then
the browser's own label behaviour dispatched a second click on the input, which bubbled
back up to the label and ran the handler AGAIN — so every pill turned itself on and
straight back off. Nothing could be changed and nothing looked wrong.

They are `<button type="button">` now, holding their state in their own class list, with
`aria-pressed` for anyone using a screen reader. There is no checkbox left in the file and
nothing reads `.checked`.

Instruments always were multi-select — the reader is a `filter()` over the whole list — so
that is a fix, not a change. The edit label now says so ("as many as they play").

**What let it through.** The first build was driven in a real browser, but nothing ever
*clicked* a pill: the page was rendered and read, not used. The new checks in
`tests/worship-team.test.js` guard the shape of the bug rather than the symptom — no pill
is a label, no checkbox exists, every reader goes through `pillOn()`. Verified again in
Chromium by clicking pills on and off and reading back the row that would have been
written.

Also worth knowing: `tests/portalui.js` is a snapshot of `shared/config.js`, so **re-run
`node tests/extract-portalui.js` after touching that file** or the nav tests check the
old copy and fail for a reason that is not yours.

---

## 2026-09-14 — Luke's Claude (Worship / Band: charts in any key)

**A chart is stored once, in no key at all.** Chords are scale degrees written inline in
the lyric, exactly where they fall — `He 1picked me up, and 2turned me around` — and the
page draws them in whichever key you press. This is the notation Luke's lyric-slides app
already uses, which is what made importing his 29 songs possible without re-keying them.

The whole vocabulary, taken from every song in that library rather than from a spec:
`1`–`7` (quality from the major scale: 1, 4, 5 major · 2, 3, 6 minor · 7 diminished),
`maj` to force major on a borrowed chord (`3maj`), `1/3` for a slash chord, and a line
starting with `/` as a section heading.

**The trap, and why the parser is written the way it is:** a letter after a digit is
lyric, not chord quality. `1mountain` is the 1 chord over the word "mountain" — there is
no such thing as a `1m` token here. A regex that greedily eats `m`, `maj`, `sus` after the
digit reports minor chords all over the library that do not exist; that is how the first
scan of the corpus read it, and the contexts disproved it.

Two rules the renderer holds to, both guarded by `tests/worship-chart-transpose.test.js`
(55 assertions):

- **Spelling follows the key, not the pitch.** The 4 of Eb is Ab, never G#. Each key has
  its own seven spelled notes rather than a pitch-class table, so no chart ever mixes
  sharps and flats.
- **A slash chord names a bass note.** `1/3` in C is C/E — the lower degree carries no
  quality of its own.

**From the rota to the chart.** A song on a set list is a link, and it opens the chart
already transposed into the key that service is playing it in. The key box on the set-list
row is a picker now, not free text, so the link always has a key it can use.

`chart_format` on a song says which kind of chart it holds: `nashville` gets the key bar,
`text` is shown as pasted. Songs already in the table stay `text`, which is what they are.
`spotify_url` sits alongside the YouTube link.

**Database:** two columns and a unique index on `lower(title)`, plus the 29-song import.
Both handed to Luke as SQL, logged in `rt_sql_applied`. Not in this repo, per the rule.

---

## 2026-09-14 — Jordan's Claude (Staff & Parents: linked children)

**Every parent showed "No children linked", however many links they had.** The
links were fine the whole time — the screen was looking for the children in a
list that cannot contain them.

`renderAdminUsers` fetches `allUsers` as **adults only** (`.in('user_type',
['teacher','admin','parent'])`, deliberately — students have their own roster).
The children map then did `allUsers.find(u => u.id === link.child_id)`. Children
are students, so that returned `undefined` every time, nothing was pushed into
the map, and every row rendered as unlinked.

Now the linked children are fetched by id in their own query. A child who has
left is shown too, marked `(past)` — the link survives withdrawal, and a parent
still holding access to a withdrawn pupil is exactly what an admin opens this
screen to notice.

**The test suite could not see this**, which is worth more than the fix. The
stub in `account-paths-audit.test.js` ignored `.in()`, so it answered the
adults-only query with a list containing students — the test found the child in
a list the real query never returns it in. The stub now filters the way
PostgREST does, and the assertion was checked by reverting the fix: it fails
without it. Same class of gap as the one in `riven-assignments.test.js` last
week; worth assuming any hand-built query stub has it until proven otherwise.

**Not mine, still red:** `tests/assessment-tools-placement.test.js` (already
noted 2026-09-11) and `tests/worship-team.test.js`. Both fail with my changes
stashed, both belong to the Worship/Band work.

---

## 2026-09-14 — Luke's Claude (the backend repo is reachable)

**Schema work has somewhere to go now.** Jordan granted access to
`rivertechschool-org/student-portal-backend`, so migrations are committed there rather than
pasted into a reply and forgotten. `CLAUDE.md` above has been corrected to say so — it used
to tell you to write the exact SQL into this file, which contradicted the rule at the top of
the same document that forbids describing access control in a repo served verbatim at
rivertech.me. The top rule wins; this file gets a pointer, never the SQL.

The two Worship / Band scripts Luke ran today are committed there as
`worship_band_1_…` and `worship_band_2_…`, verbatim, with their md5s recorded in the header
so a future reader can tell whether the file drifted from what was actually applied.

**Read that repo's README before adding a migration.** Two things there are easy to get
wrong: migrations have no timestamps, so the alphabetical filename *is* the apply order and
a later file silently overrides an earlier one; and `MIGRATION_MAP.md` is generated from
each migration's header comment and must be regenerated in the same commit
(`node tools/gen-migration-map.js`), never hand-edited.

Noticed on the way through: that map was 16 migrations out of date before today's commit,
so anyone who trusted it this month was reading a stale picture. It is current now.

---

## 2026-09-15 — Jordan's Claude (Riven: classes closed for the year)

**Riven kept offering classes that stopped running in June.** Jordan spotted it
looking over the day's classes; it went a long way past that one screen.

Closing a class for the year sets its status and **nothing else**. It does not
archive the enrolments and it does not remove its timetable rows. So a closed
class still reads as enrolled and still reads as meeting on a Tuesday, and
every list that answered "what is happening" believed it. Measured against
live data before the fix: 62 closed classes, 49 still carrying timetable rows,
22 of them "meeting" on the day I looked, and 356 active enrolments inside
them. One child's answer to "what classes is he in" was forty, twenty-seven of
them closed.

There is now one shared rule — `_rivenClassIsOpen(row)` — and the surfaces that
answer "now" all ask it:

* the briefing (`_rivenMyClassRows`), which is what put closed registers under
  **Attendance not yet taken today** every day, for ever, since a closed class
  can never have its attendance taken and so could never leave the list
* a student's classes, single and multi — the closed ones are counted in a
  footnote rather than silently dropped, and "is he in X" now distinguishes
  "no" from "X is closed for the year, he was in it"
* "mark him absent in all his classes", and the cohort fan-out — both were
  writing today's register into last year's classes
* ranking my classes by grade, the note class-picker, chat entity links, and
  the same-name sibling expansion (last year's "Math" turned a single live
  match into a picker)

**Writes at a closed class are refused**, not silently applied — attendance,
cancel, un-cancel. The message says to reopen it first.

**Which matters, because reopen never worked.** It tested `is_active`, the
soft-DELETE flag, and the class cache only ever holds rows where that is true —
so every "reopen chess" answered *"Chess is already open"* and wrote nothing.
It now moves the same flag closing moves, and brings the roster back the way
the Reopen Class button does (the old confirmation promised the opposite, which
sent teachers off to re-enrol students who were about to reappear anyway). Undo
restores each enrolment to the state it was actually in — archived and removed
are different things, and one of them means somebody took that child off on
purpose.

Both fixes were checked by putting the bug back and watching the new
assertions fail. `tests/riven-scope.test.js` owns the closed-class rule since
that is where "my classes" is decided.

**Not mine, still red:** `tests/assessment-tools-placement.test.js` (noted
2026-09-11) and `tests/worship-team.test.js` — both fail with my changes
stashed, both from the Worship/Band work.

---

## 2026-09-16 — Luke's Claude (Worship / Band: the schedule, rebuilt)

**Answering Jordan's note above, since both were mine.**
`tests/worship-team.test.js` was genuinely red: one assertion still looked for the
"leads" pill at the id it had before the rota became position-first. Fixed here.
`tests/assessment-tools-placement.test.js` was not — it reads `tests/portalui.js`, which is
generated and not committed, so it fails on any tree where nobody has run
`node tests/extract-portalui.js`. Four suites do that. `CLAUDE.md` now says so in the
before-you-push block, where I should have put it the first time rather than burying it in
a handoff entry.


**Three screens instead of one list:** the services you run → the next fortnight of one of
them → one plan. That is the order someone actually thinks in, and it is why Planning
Center is legible: a service type is a standing thing, a date is an instance of it, and the
plan is where people, songs and files live. A flat list of every date across every service
told you nothing about which was which.

Schedule is now the first tab, and the page opens on it — unless you are not on the team
yet, in which case you land on Team, where the join form is.

**Today counts.** The fortnight window starts today, not tomorrow. Opening this on a Sunday
morning, the service you are about to play is the first row. An unplanned date still shows,
because the service happens weekly whether or not anyone has touched it; an admin starts a
plan from that row.

**The plan page** groups people by position rather than listing slots, so an empty position
is visible — that is the thing you are looking for when you open a rota. Everyone carries
their own reply (asked / in / out), and a player can answer for themselves.

**That reply is the one place the security model bends, so it bends narrowly.** The slots
table stays admin-write: a player must not be able to put themselves on a rota, take
someone else off, or change what they are playing. Answering goes through a function that
sets `status`, on your own slot, to one of two values. Nothing in the page updates a slot
row directly, and `tests/worship-schedule.test.js` fails if anything starts to.

Order of service reorders by swapping two rows' `sort_order` rather than rewriting the
list, so two people editing different parts of an order cannot clobber each other.

Songs are a list now rather than a grid of cards — a library is scanned down one column by
title, and at 29 songs and growing the wall was slower to read than it looked.

**Needs a migration run** before practice files and the confirm/decline buttons do
anything: it is committed in the backend repo, and Luke has the SQL. Until it is applied
the files block hides itself and everything else on the page works — the rota is what
people came for.

Tests: `tests/worship-schedule.test.js`, 31 assertions. Driven in Chromium end to end —
type list, fortnight, plan page, reorder, reply, add-person dialog, songs list.

---

## 2026-09-15 — Jordan's Claude (email: queued, not lost; and a share each)

**113 emails vanished on 15 Sep and nothing would have retried them.** 312
notification emails were attempted that day, 199 landed, and the rest hit the
provider's daily allowance at exactly 199. They were written to `email_log`
with status `failed` — which is a *log*, nothing drains it — so 17 families
never heard about 8 assignments, and the only reason we know is that somebody
happened to look.

Almost all of it is one thing: `assignment_posted`. 706 of September's 738
emails. One assignment fans out to every student in the class and every linked
parent, so 24 assignments in an afternoon is 300+ emails. Monthly volume is
only ~750 and the monthly allowance is 3,000 — **the daily cap is the only wall
we hit, and it is the burstiness that hits it.**

Two changes, both in the backend repo (`45e110c`, migration
`…_teacher_email_budget_and_deferral.sql` plus both email edge functions):

**A refusal that clears on its own now goes on the queue.** There has been a
real queue all along — it claims before sending, retries, and records what
happened — but direct sends never touched it. They do now.

**Each teacher gets a daily share, 25 by default.** Past that their email is
queued for the morning rather than dropped. The allowance is school-wide and
shared, so without a per-person share whoever posts last loses everything,
which is precisely what happened. Admins and scheduled mail are not capped —
this is aimed at fan-out, not at people.

### In this repo

`sendEmailWithTracking` now understands a **third outcome**. "Queued" is not a
success (nothing was delivered) and not a failure (nothing is wrong with it and
it will be retried). Logging it as either is wrong in a way people act on:
`failed` raises an alert nobody can act on, `success` tells a teacher the
parents were told when they were not.

And the teacher is told. A fan-out that sends 25 and holds 15 looked exactly
like one that sent all 40 — they posted the work, the screen said "Assignment
created", and the first they heard was a parent asking why. Now they get
"25 emails sent · 15 queued — going out at 8:00 AM". A clean run says nothing,
because a message on every assignment is one nobody reads by Wednesday.

The report runs in a `finally`. `sendNewAssignmentNotifications` returns early
in three places and a report after the last statement would be skipped in
exactly the runs that sent the most.

`tests/email-deferral.test.js` covers it, verified by removing the branch and
watching it fail.

### Somebody has to apply this

Nothing above is live until three things happen, in this order — though
deploying the functions first is safe, they degrade to today's behaviour if the
migration has not run:

1. Apply the migration (SQL editor, as usual).
2. Set the `TEACHER_DAILY_EMAIL_CAP` secret — 25, or whatever we settle on. It
   is a secret rather than a constant so it can move without a deploy.
3. Deploy `send-notification-email` and `process-email-queue`.

### Still open

**Account email does not go through any of this.** Sign-up confirmation,
teacher and student invites, activation links and password resets all go
through Supabase Auth's own mailer, not our sender — so they are not capped,
not queued, and not retried, while still drawing on the same provider
allowance if that is where Auth's SMTP points. They also have a separate
hourly limit of their own, which is what `admin-resend-activation`'s "hourly
email limit" comment is about. Worth a decision; not touched here.

**The real fix is still unbuilt.** A once-daily digest — "3 new assignments in
Math, Bible and History" — would take 750 emails a month under 100 and make
the cap irrelevant on any plan. It is also better for families: five emails in
an hour from one teacher is how a sender gets muted.

**Not mine, still red:** `tests/assessment-tools-placement.test.js` and
`tests/worship-team.test.js`, both from the Worship/Band work.

---

## 2026-09-16 — Luke's Claude (adding a song without leaving the plan)

The song picker on an order of service now ends with **"➕ Add a song not in the library…"**,
which opens the full song editor — title, artist, key, links, chart — and on save writes the
song, drops it into this service in the key already chosen on the row, and hands the plan
back. The library is always missing the song you want at the moment you want it, and sending
someone to the Songs tab to add it loses the half-built order behind them.

Two details that are easy to get wrong and are both tested:

- **The picker is put back on a real song before the dialog opens.** Otherwise cancelling
  leaves "Add a song not in the library…" sitting in the box as though it were a song, and
  the next press of Add sends that.
- **It is two writes, and only the first is the song.** If the link into the order fails,
  the song is still in the library — so that says so out loud rather than reporting a clean
  save that did half the job.

---

## 2026-09-16 — Luke's Claude (closing the "still red" loop)

**Both suites flagged as red in the two entries above pass.** They were never failing an
assertion — they were throwing, because `tests/portalui.js` is generated from
`shared/config.js` and is deliberately not committed. Four suites read it, and without it
they die with a stack trace that says nothing about the real problem. Two people have now
lost time to that, which is two more than a documentation line was ever going to fix.

So all four now catch the missing file and print what to run:

```
  This suite reads tests/portalui.js, which is generated and not committed.
  Run this first, then try again:

      node tests/extract-portalui.js
```

`CLAUDE.md`'s before-you-push block has that step as its first line as well.

To be unambiguous about the clean-tree state: `inequality-region` and `typed-answer-mode`
are the only two that genuinely fail, both for the missing `tests/ai.js` extraction they
have always needed. Everything else is green.

---
## 2026-09-15 (later) — Jordan's Claude (email: combining replaced the cap, and it is live)

**Superseding my entry above.** Jordan's call, and the right one: don't ration a
teacher's emails, compress them. A teacher posting 24 assignments should send
each child **one** email listing all 24, not 24 emails and not 25-today-rest-tomorrow.

So the daily cap is gone — dropped, not disabled. In its place, notifications
of one type, from one teacher, to one person are gathered for a few minutes and
sent as a single digest. **24 assignments across a class of 13 goes from 312
emails to 13.** The allowance stops being a constraint rather than being shared
out, and it is better mail: two dozen near-identical messages in an afternoon
is how a sender gets muted, and a muted sender takes the important message
with it.

The window slides with each new item but never past a maximum wait, so steady
posting all afternoon still produces one email, and nothing waits forever on a
burst that never ends. Defaults are 10 minutes and 1 hour, both secrets
(`EMAIL_COALESCE_WINDOW_SECONDS`, `EMAIL_COALESCE_MAX_WAIT_SECONDS`); a window
of 0 turns combining off entirely.

**Applied and deployed — this is live**, unlike most entries here. Migration
applied, both edge functions deployed and byte-verified against the local
files.

In this repo: the teacher-facing notice now says *"13 notifications will be
combined and sent at 5:52 PM"* rather than "queued", because queued sounds like
a problem and this is the feature. It is also **rate-limited to once every 30
minutes** — combining is now the normal path, so a toast on every post would be
24 toasts in an hour, which is the same mistake as the emails moved into the
UI. Failures always show. `tests/email-deferral.test.js`, 27 assertions.

### The thing that cost two real emails

**`supabase functions deploy` without Docker reports success and deploys
nothing.** It prints `WARNING: Docker is not running`, then `Uploading
asset…`, then `Deployed Functions.` — and the old code keeps running.
`functions list` even shows a new version and a new hash afterwards.

`--use-api` is required. Verify with `functions download`, which returns what
is actually running, and diff it against your file. Written up in the backend
repo's README.

I found this because a probe designed to be harmless *if the deploy had landed*
was not harmless against the old code: two test emails went to
`learn@rivertech.me` before I stopped using live sends to test. The remaining
checks used an invalid recipient domain, which cannot reach anyone.

### Still open

**The 113 from yesterday are still unsent** — 17 people, 8 assignments. With
combining they would now arrive as roughly 17 emails rather than 113. Waiting
on Jordan's go-ahead, and worth checking the due dates have not already passed
before sending day-old notices.

**Account email is still outside all of this.** Sign-up, invites, activation
links and password resets go through Supabase Auth's own mailer — not capped,
not combined, not retried, and separately rate-limited.

**Not mine, still red:** `tests/assessment-tools-placement.test.js` and
`tests/worship-team.test.js`.

---

## 2026-09-16 — Luke's Claude (services read in week order)

Service types now sort by the day they fall on — Sunday first, the same order `WEEKDAYS`
is written in — rather than by creation order. A type with no set day sits after the ones
that do, since it has no place in the week. `sort_order` still breaks a tie between two
services on the same day at the same time, but it is no longer the first thing consulted.

One sort, applied where the types are loaded, so the list, the one-off picker and every
dropdown built from `A.types` agree without each remembering to sort.

---

## 2026-09-16 — Luke's Claude (beta-testing the journeys, and what it found)

**New standing rule, from Luke: "You do the beta testing so I don't have to."** It is
written up in `CLAUDE.md` under *Beta-test it yourself, end to end*, and the harness that
implements it for this page is `debug-tools/worship-journeys.mjs` — 4 journeys, 44 checks,
driven in Chromium against a stubbed database:

1. a student asks to join and an admin lets them in;
2. an admin plans a service from an empty date — people, songs, a song that is not in the
   library yet, a reorder, a key change, a practice file, publish;
3. a player opens the published plan, replies, and reads the chart in the booked key;
4. the library — search, open, transpose.

**What it found, stated honestly, because the difference matters:**

- **One real bug.** The "people waiting" badge on the Requests tab only loaded once that
  tab had been opened. Since the Schedule became the first tab, an admin could go a week
  without being told anyone had asked to join. The count now loads at boot.
- **One real fragility, surfaced by a stub artifact.** Reordering a set list read the
  second row's `sort_order` *after* issuing the write against the first. Against the real
  client that is harmless; against anything that updates the row in hand it is wrong, and
  it was invisible. Both numbers are now read before either write. While there, a tie
  (two rows sharing a `sort_order`, which any row that never set one has) made the press
  silently do nothing — that now falls back to assigning positions.
- **Two false alarms, which are worth more than they cost.** Both were the stub being
  *stricter* than Postgres: the page omits a defaulted column on insert and reads the row
  back expecting the default. Fixed in the stub, and the two writes were made explicit
  anyway, since a write that leans on a default its own read then filters by is a coupling
  worth removing. A harness that cries wolf twice stops being read, so this is written down
  in `CLAUDE.md` as the first thing to get right when stubbing.

**Also:** a set-list row is editable after it is added — key, who leads *that song*, and a
note — not only at the moment of adding. Who leads a song is not who leads the service, so
that is a new nullable column, migration 4 in the backend repo, handed to Luke. Until it is
run the Leader field is not drawn and not sent; everything else works.

---
## 2026-09-15 (evening) — Jordan's Claude (the 113 are settled, and a delete now cancels its email)

**Sent: 17 emails covering 37 notifications. Not sent: 76.**

Of yesterday's 113 failures, **76 pointed at assignments that had been deleted
since**. Replaying those would have told families to do work that no longer
exists — worse than never telling them, because they go looking for it. They
are marked `obsolete` in `email_log` with the reason; the other 37 are marked
`requeued`.

The 37 real ones covered 3 live assignments (none past due, one due the next
day) for 17 people, all from one teacher — so combining turned them into
**17 emails, one each**. Drained in a single run: `claimed:17 sent:17
failed:0`. Queue is now empty, log has no failures left.

That was also the first real proof of the digest template, which I could not
verify any other way without emailing a person.

### Deleting an assignment now cancels its email

Combining opened a window that did not exist before: an assignment can be
posted, queued, and deleted before the email leaves. It is not hypothetical —
those 76 are exactly that shape, they were just hidden behind a failure.

A trigger on `assignments` DELETE, not a call in the delete handler: there are
four ways to delete an assignment (the card button, Riven, the batch relay op,
SQL) and three would have to remember.

It removes the **line, not the row** — deleting one of a teacher's 24
assignments takes out that item and leaves the other 23, dropping the email
only when nothing is left to say.

**This needed a frontend change to work:** the assignment id now travels inside
the email's own `data`, not just the log context, because the trigger matches
on the queued item. `tests/email-deferral.test.js` guards it — if that field
goes missing, deletes silently stop cancelling notifications and nothing else
fails.

### Applied and live

Migration applied, trigger verified, both edge functions deployed and
byte-checked. Nothing here is waiting on anyone.

### Still open

**Account email remains outside all of this** — sign-up, invites, activation
links, password resets go through Supabase Auth's own mailer: not combined, not
retried, separately rate-limited.

**Unpublishing** an assignment does not cancel a queued notification; only
deleting does. Probably wants the same treatment.

**Not mine:** `tests/assessment-tools-placement.test.js`.

---

## 2026-09-16 — Luke's Claude (three things the live site showed)

**Dates followed the viewer's browser language.** Luke's browser is set to Spanish, so the
same service read `mié 16 de sep` to him and `Wed, Sep 16` to everyone else. A rota is one
shared document that people quote at each other; it now renders `en-US` for everyone
regardless of the browser. Guarded by a journey that loads the page with `locale: 'es-ES'`
and expects the English date.

**A missing database function reached the user as a raw PostgREST error.** Deploys land in
seconds and migrations are run by hand, so there is always a window where the page asks for
something the database has not got. `worship_slot_respond()` was not visible to the API, and
the page said so in PostgREST's words — schema cache and all. It now says "Replying is not
switched on yet — that needs the newest migration run", hides the two buttons rather than
offering something that cannot work, and leaves the rest of the plan alone. Journey 5 in
the harness covers exactly this, because it is a permanent condition of this setup rather
than a one-off.

**"— plays this" in the add-person dialog** was true but read oddly in a list of names, and
the people it applied to were scattered alphabetically through everyone else. It now names
the instrument ("— plays piano"), those people sort to the top, and the field label says so.
The question being asked is "who can cover the piano"; the answer belongs at the top.

---
## 2026-09-15 — Jordan's Claude (Riven learns the year groups, and /admin)

**"Add her to my Math class tagged Old Middle School" gave a picker of four
rows, every one reading `Math · Jordan Ezell`.** Two faults at once.

**Closed classes were still being offered.** Five classes are named `Math`;
three are closed for the year. My earlier closed-class fix reached the sibling
expansion but not `_rivenMatchClass` itself, which built its candidate list
straight off the cache. Now live classes win — and closed ones stay reachable
when they are the *only* match, which is what keeps `reopen chess` working.

**The two live ones were genuinely indistinguishable on screen.** Same name,
same teacher. The only thing separating them is `grade_band` — which was not
loaded into the cache, not understood in a sentence, and not shown in the
picker. So Riven asked someone to choose between four identical-looking rows
*after they had already said which one they meant*.

### What it understands now

`grade_band`, three ways in: the code, the label from the `grade_bands` table,
and what people actually say — *junior high*, *upper MS*, *lower middle*,
*high school*. Longest phrase wins, so "old middle school" is not read as
"middle".

**Bare "middle" and bare "elementary" are deliberately NOT matched.** Each names
two bands, and guessing is how a child lands in the wrong year. Riven asks.

Class names cannot substitute for this: the same year group appears as
`Lower MS Math`, `Literature - Younger Middle School`, and plain `Math`.

The picker now shows the year group **only when that is what tells the options
apart**, and confirmations prefer it over the teacher's name — one teacher
taking the same subject in two year groups is common here, and then the
teacher's name distinguishes nothing.

### "Add [student] to every Old Middle School class"

New `ENROLL_BAND` intent. A new pupil arriving mid-year needed ten separate
enrolments through the picker that could not tell two `Math` classes apart.

It lists the classes before writing, says what it is skipping and why (already
enrolled, or not yours to change), keeps going if one class refuses, and pushes
a single undo for the batch. A bulk roster change that reports only a number is
one nobody can check.

**Caught by the precision harness, and worth knowing about:** there is a
production `WRITE_INTENTS` array inside `_matchIntent` that gates
speculative/interrogative phrasings. A new write intent that is not in it will
happily fire on *"should I add Josey to all the Old Middle School classes?"*.
Add new write intents there.

### /admin

`/admin <command>` runs it without stopping to confirm. **It skips the
question, not the permission** — RLS still decides, `_rivenRequireAdmin` still
refuses, every action still pushes its undo, and non-admins are refused the
prefix outright so it cannot read as a way *in*. It still prints what it did:
the confirmation summary is the only record of what was about to happen.

The exemption lasts exactly one command, cleared in a `finally`. A flag left
set would disarm every confirmation for the rest of the session — the kind of
bug nobody notices until it matters.

Tests: `tests/riven-grade-bands.test.js` (40). Seven debug harnesses needed the
new helpers added to their extract lists; `debug-harness-closure` caught every
one.

**Not mine:** `tests/assessment-tools-placement.test.js`, `tests/worship-team.test.js`
— both fail with my changes stashed (checked).

---

## 2026-09-15 (c -> d) — Jordan's Claude (the year groups were never loaded)

**Band matching shipped completely dead, and every test said it worked.**

`_loadTerminalGradeBands` was wired into the **self-heal** block only — the one
that runs when some *other* load has failed. On a healthy session it never ran.
`_terminalGradeBands` stayed `undefined`, `_rivenBandFromText` hit its
`if (!bands.length) return null` guard, every sentence resolved to no band, and
`ENROLL_BAND`'s `requiresBand` guard skipped it every time.

So "Add Josey to every Old Middle class" fell through to an ordinary class
match on the word *middle* and offered a picker of **Younger** Middle School
classes. Nothing errored. Nothing warned. The feature was simply off.

Fixed three ways, because one was not enough:

1. `_rivenReady()` — the actual mount loader — now loads them alongside
   students, classes and groups.
2. Self-heal watches `_terminalGradeBands` too, so a failed band load recovers
   like every other roster.
3. `_rivenBandFromText` no longer returns null on an empty table. The spoken
   names (*junior high*, *upper MS*, *high school*) carry their own codes, so
   the feature now degrades to the known vocabulary instead of to silence. The
   table still filters them when it is present, so a band the school removes
   stops being recognised.

Also: the year-group chip in the picker was rendering in `--accent-2` against
the dark panel and came out as near-invisible dark-on-dark — present in the
markup, useless on screen, which is the same as not having shipped it. It is
now a proper pill.

### The part worth keeping

**The harnesses could not have caught this, because they set
`_terminalGradeBands` as a fixture** — supplying the exact state production was
failing to build. Three ENROLL_BAND routing cases passed green while the
feature was dead in the browser.

That is the third time this session a fixture has stood in for the thing under
test (`account-paths-audit` ignoring `.in()`, `riven-classes-quarters` modelling
"closed" with the wrong flag, now this). **A fixture that substitutes for a
load tests everything except whether the load happens.** `riven-grade-bands`
now asserts against the source that `_rivenReady` performs the load, and checks
band matching with the table empty. Both verified by putting the bug back.

**Not mine:** `tests/assessment-tools-placement.test.js`, `tests/worship-team.test.js`.

---

## 2026-09-16 — Luke's Claude (one person, two positions)

**The bug Luke hit:** he was on a service twice — Piano and Singing — pressed "I'll be
there", and only Singing changed. Piano sat on "asked" with nothing that could reach it.
`teamBlock` did `slots.find(sl => sl.user_id === A.me.id)`: the FIRST slot that is mine,
as though a person could only hold one. Being on twice is normal, not an edge case.

Now every position you hold gets its own row and its own pair of buttons, with its own
status beside it, and a line saying "two positions, two answers" when there is more than
one. The same single-slot assumption was in the "You are on" card on the schedule, which
showed one status for what might be two; it lists each.

**The harness did not catch this, and that is the lesson worth keeping.** Journey 3 put a
player on exactly one position, so the code path that broke was never walked. It now puts
Ann on two, answers one, checks the other is untouched and still reachable, answers that,
and changes an answer — because a reply that cannot be changed is a trap. 56 checks.

**Two changes Luke asked for in the same breath:**

- **Slides is a position.** Not an instrument, but somebody has to run the words, and the
  rota is where they find out it is them. One entry in `INSTRUMENTS`; the join form, the
  roster chips and the rota all read that list, so nothing else needed touching. No
  migration — `instrument` is free text with no check constraint.
- **The add-person picker lists the people who play that instrument**, not everyone.
  Two escapes, because a strict filter would otherwise be a dead end: if nobody on the
  team has it on their profile the whole team is offered with a line saying why, and
  there is always a "Show everyone on the team" link for someone covering an instrument
  that never made it onto their profile. That widening is per-dialog, not a setting.

---

## 2026-09-16 — Luke's Claude (one rota, two tabs)

**Schedule split into My schedule and Plan.** My schedule is what is coming up and what you
are on, and a service opened from it **reads the same for a student, a teacher and an
admin** — a rota is a rota. Plan is the planning tab, admins only: service types → the next
fortnight → the plan with all the controls. A worship admin reading a service on My
schedule gets exactly one extra thing: **Edit this service**, which lands on that same
service in Plan rather than dropping them at the top of the tab to find it again.

**How the two views cannot drift apart.** The four blocks — team, order, files, notes — now
take an `editable` flag instead of each asking `A.isAdmin` internally. One source of markup,
called with `false` from the read-only view and `true` from the plan. Journey 6 in the
harness renders the same service as a player and as an admin, strips the admin's one button,
and fails if a single character of the rest differs.

Two things legitimately differ between two people reading the same service, and the harness
allows exactly those: the "you are on for" rows, and the highlight on your own name. Neither
is a role — both are whose name is on the row.

**Drafts stay on Plan.** My schedule lists published services only, so an admin's
half-finished plan is not on the team's screen. `myNextCard` is gone: "You are on" on My
schedule replaced it, and leaving a second, divergent copy of the same idea is how two
screens start disagreeing.

64 journey checks, 72 in `tests/worship-schedule.test.js`.

---
## 2026-09-15 — Jordan's Claude (Riven audit: four silent faults)

Asked to look for other shortcomings. Two parallel agents plus static analysis.
**All four findings are the same shape: something that looks guarded, or looks
loaded, and is not. None of them threw. None appeared in any log.**

**1. `row.max_students` was read off the class cache, which never fetched it.**
So every class read as a cap of 30. All 75 open classes have a cap set and
**20 are below 30 — the smallest is 7** — so Riven's bulk-enrol cap check would
have waved 30 students into a room for seven. Identical in shape to the
`grade_band` bug earlier today: a field used, never selected, silently
`undefined`. Both are now in the SELECT with a comment saying why, so neither
gets trimmed back out.

**2. Three permission checks failed OPEN.** `if (cls && !canManage(cls))` —
where `cls` is a cache lookup by id. When the class was not found (soft-deleted,
or a cache that had not loaded) the check was skipped and the write went ahead.
Grading a submission, deleting an assignment, editing one. A gate that opens
when it cannot see what it is guarding is not a gate; all three now refuse and
say why.

**3. Date of birth was writable by any teacher** — client and server. It is on
the admin-only list with the name and year group, and the trigger I added
earlier covered the other four fields but not this one, because the list was
drawn from the Student Hub's profile tab and DOB is not edited there. It is
reachable from Riven in a command that reads like contact details, so it got
filed with the phone number. Trigger updated (backend `621e0a3`); Riven refuses
it for non-admins and says which part of the sentence it dropped, keeping the
rest — correcting a phone number and a birthday in one breath still fixes the
phone.

**4. `create a Chess class` answered "Chess already exists"** and pointed at
last year's, because the name-clash check matched closed classes. **39 closed
class names have no open equivalent** — Chess, Guitar, Filmmaking, World
History. A dead end in the one week of the year that command is most used. Now
only live classes clash; a closed one of the same name is mentioned, with
"reopen" offered as the alternative.

Also: `MARK_READ` was missing from `WRITE_INTENTS`, so "should I mark
everything read?" would have executed. Added.

### Clean, and worth recording as clean

A full dead-wiring sweep found **nothing**: all 126 intents are routed, every
router case resolves to a real method, no `terminal*` or `_riven*` method is
unreferenced, and all 11 `requiresX` guards test an entity that is actually
assigned. No contradictory guard pairs, no orphan pattern keys.

### Open — needs your decision, not mine

These are policy, so I have not touched them:

* **`/rt apply` (the batch surface) has no client-side role gate at all**, and
  with `"scope":"all"` it reaches every class. RLS is the real control here so
  this is not automatically a hole — but it is the one path where Riven's own
  rules do not apply, and it can create classes and rewrite timetables.
  Worth deciding whether it should.
* **Creating a class admits teachers**, but *renaming* one, changing its
  co-teacher, and closing all of your classes are gated per-class rather than
  admin — while *reopening* a class is admin-only. A teacher can close their
  classes and then not reopen them. That asymmetry is probably not deliberate.
* **Class rosters are per-class, group rosters are admin.** The two halves of
  the same idea disagree. Either rosters are "the day" or they are "the shape".

`tests/riven-audit-2026-09-15.test.js` (20) covers what I fixed.

**Not mine:** `tests/assessment-tools-placement.test.js`, `tests/worship-team.test.js`.

---

## 2026-09-16 — Luke's Claude (answering belongs to My schedule)

The accept/decline buttons render on the reading view and never on the plan. Planning is
arranging other people; answering is speaking for yourself, and mixing the two lets you say
yes on behalf of the rota you are building. The plan still **shows** every answer — asked,
in, out, against each name — because that is the whole point of looking at it. It just
cannot be given from there, even by the admin who put themselves on.

One flag, not two: `canReply` is `!editable`, because the two modes are always opposites and
two booleans that could disagree is a bug waiting to be written. An admin who is on a
service they are planning gets a line pointing them at My schedule rather than a missing
button they have to reason about.

---

## 2026-09-16 — Luke's Claude (five fixes from real use)

**One press, one row.** "Add to the order" took a beat, looked like it had done nothing, so
Luke pressed it again — and again — and got the same song three times. Every write on the
page is now wrapped: the button that started it is disabled and relabelled ("Adding…",
"Saving…") until it finishes, and a second press while it is in flight does nothing.

That wrapping is in **one place**, a list of function names near the foot of the file, not a
claim/release pair inside each function. Between them these writes have a dozen early
returns — a missing amount, a failed insert, a duplicate — and any one of them would have
left a button disabled for good. A `try/finally` around the call cannot miss one.

Note for whoever adds the next write: give its button `this` as the last argument and add
the function's name to that list. Nothing else.

**The song box starts on "Song…"** rather than on the first song in the library, which read
as a choice already made — press Add without touching it and you got a song you never
picked.

**A position can be filled from the whole school.** The dialog still lists the people whose
profile says they play it, but "Search the whole school" finds anyone, and adding them puts
them on the worship team as well as on the rota, with that instrument on their profile.
Somebody who has never been on the team is exactly who you reach for when a position is
empty on the Thursday; making that a trip to the Team tab is how an empty position stays
empty.

**Reading a chart off a rota no longer offers Delete.** `openSong` takes `allowEdit`, and
only the Songs tab passes it. Editing the library is a different job, done from the library
on purpose.

**Practice files now include what the set list already implies:** each song's chart *in the
key it is booked in*, plus its YouTube and Spotify links, above anything attached by hand.
A chart attached as a fixed link would be the wrong key the moment the key moves, so these
are derived on render rather than stored.

**Harness: 7 journeys, 83 checks.** Journey 7 is new and stages what actually happened —
the stub now delays writes, so an impatient five-press double-click is reproducible, and a
deliberately failing write proves the button comes back. Twice now `innerText` has caught
this harness out by returning uppercased text where CSS uppercases a heading; both matches
are case-blind now.

---

## 2026-09-15 — Jordan's Claude (activation links landed on the wrong page)

**Every activation and password link was asking for /reset.html and landing on
the home page.** Proved against the live project by generating a recovery link
through the admin API (throwaway user at an invalid domain, deleted after):

```
asked for  redirect_to=https://rivertech.me/reset.html
got        redirect_to=https://rivertech.me
```

Every path collapses to the bare origin. **The project's redirect allow-list
holds only the Site URL**, and an un-allow-listed `redirect_to` silently falls
back to it. The tokens still arrive — in the fragment, on a page with no reset
form.

### Why the fallback that existed did not save it

`index.html` already forwarded `type=recovery` to `reset.html`. But it did so
from inside `initialize()`, which runs *after* the Supabase client is
constructed — and that client sets `detectSessionInUrl`, so supabase-js clears
`window.location.hash` the instant it detects an implicit grant. The identical
race is documented a few lines below for the teacher-invite path.

So the fragment was usually gone before anything read it, the forward never
fired, and the person was left on the login screen with nothing to explain it.
**3 recovery links went out in 48 hours; 2 were never completed.**

The guard now runs in the `<head>`, ahead of both script tags, where there is
no client yet to race. Verified live: guard at line 35, scripts at 46–47.

`reset.html` copes either way — it takes a session supabase-js already
established, or sets one from the fragment — and `PortalAuth` builds its client
lazily, so that page is not racing itself.

### Worth doing, no longer blocking

Add **`https://rivertech.me/reset.html`** (or `https://rivertech.me/**`) to
Authentication → URL Configuration → **Redirect URLs** in the Supabase
dashboard. That sends the link straight to the reset page instead of bouncing
through the home page. I could not do it from here — the CLI's stored
credentials do not include a Management API token.

Two smaller things noticed and left alone:

* `index.html`'s own `redirectTo` builds its URL with
  `location.href.split('/').slice(0,-1).join('/')`, which yields `https:/` if
  the page is ever served without a trailing slash. Moot while the path is
  stripped anyway, but wrong.
* `type=invite` links are not handled on the home page. Nothing issues them
  today (`pin-login` generates a magiclink and consumes it server-side), so it
  is latent, not live.

`tests/activation-link-lands-somewhere.test.js` (12) pins the ordering, since
the ordering is the entire fix.

### Driven, not assumed (2026-09-15, same day)

The activation-link fix above was **verified in a real browser** rather than by
test alone, because the bug was a race between a page script and a library and
no fixture can reproduce one.

The Claude-in-Chrome extension was not connected, so: headless Chrome with
`--remote-debugging-port`, driven over CDP from plain node (v22+ has a global
`WebSocket` — no Playwright, no Puppeteer, nothing to install). Throwaway auth
user on an invalid domain so no mail could be sent; deleted afterwards.

Result, following a genuine Supabase recovery link:

```
https://.../auth/v1/verify?token=...&type=recovery
  -> https://rivertech.me                (path stripped — the allow-list)
  -> https://rivertech.me/reset.html#... (the new head guard)
     Auto session check: Session found
     Valid session for user: link-drive@rivertech.invalid
     reset form visible, error state hidden
```

The final URL is `reset.html#` — fragment **empty**. That is supabase-js
consuming it, which is exactly what used to happen on the home page before
`initialize()` could read it. The counterfactual and the fix in one trace.

Recipe saved to memory; close the browser with CDP `Browser.close`, never
`taskkill /IM chrome.exe` — that would take the user's own Chrome with it.

---

## 2026-09-15 — CORRECTION to the activation-link entry above

**The allow-list was never the problem, and the entry above is wrong about the
cause.** `auth.additional_redirect_urls` already contains
`https://rivertech.me/**`.

My evidence was an artifact of my own test. The admin `generate_link` REST
endpoint takes `redirect_to` at the **top level**; I passed it nested inside
`options`, which is the *JS client's* shape. Nested, it is ignored and falls
back to `site_url` — which I read as "Supabase is stripping the path". Passed
correctly, the link goes straight to `/reset.html`. Verified both ways against
the live project.

The head guard in `index.html` stays, but as **defence in depth, not a fix** —
if a recovery grant ever does land on the home page it now recovers, and the
forward that was already there could not be relied on because of the
`detectSessionInUrl` race. The test header has been rewritten to say so.

**Also corrected:** auth email does *not* share the Resend allowance. It goes
over **Gmail SMTP** as `jordan@rivertech.me`, `otp_expiry` 86400, with a 1
minute per-address frequency cap — entirely separate from the notification
sender. Anywhere I said otherwise, including "still open" notes in earlier
entries, is wrong.

**What was actually wrong for the family who reported it:** their address was
used as their son's *student* login, so the parent could not register her own
account, and the activation email did not say whose account it opened. That is
fixed by the account-type email template, now applied to the live project from
`supabase/templates/recovery.html` (backend `82e7e1f`).

---

## 2026-09-16 — Jordan's Claude (the ways people write a date)

**"Meadow will be absent Sept 23" answered with the help text. Twice.** The
intent matched fine both times — the *date* came back null, and a null date is
indistinguishable from a sentence Riven did not understand.

Three separate gaps, all in how a date can be written:

**A named month.** The day-number reader only understood a month introduced by
"of" or "in" (*the 23rd OF September*), and it refused a lone number with no
ordinal suffix. "Sept 23" failed both tests at once, so the sentence fell
through every branch to nothing. Now reads `Sept 23`, `September 23rd`,
`23 Sept`, `Sept 23, 24 and 25`, and `Sept 23-25`.

**A range with no spaces.** The separator had to have whitespace either side,
so **"Monday-Thursday"** — which is how anyone writes it — missed the range
branch and fell through to the single-day path, which kept the start and
silently dropped the end. A half-recorded absence is worse than none: it reads
as recorded.

**Shorthand.** `M,T,W,Th,F`, `MWF`, `Tu/Th` meant nothing. They do now, for
absences *and* schedules, along with any weekday range (`tuesday-thursday`,
and wrapping ones like `friday to monday`).

### The shorthand is the part with teeth

It can be wrong in a way nobody notices — a stray letter read as a day puts a
child down as absent on a date no one mentioned. So it only fires on a run of
**two or more** codes where **every** character resolves to a day, longest
token first (`th` must beat `t`, or Thursday quietly becomes Tuesday).
`out m`, `mrs smith` and a name all correctly yield nothing.

One deliberate deferral: `23rd of September` is left to the existing
`_rivenAbsenceDayNumbers`, which reads that form better because it gathers the
whole list. My reader would have caught only the day nearest the month name, so
*"the 2nd and 3rd of November"* came back as the 3rd alone. Caught by an
existing test.

### The closure check now covers tests/ as well

`debug-harness-closure` only ever looked at `debug-tools/`. Adding one helper
to `_rivenParseWeekdays` took out **three test files at once** and the check
stayed silent, because the tests extract methods exactly the same way and break
exactly the same way. It now walks both directories — 39 assertions — and it
immediately found a latent one in `riven-pair-purchase` that was passing only
because the branch was never taken.

`tests/riven-date-phrasing.test.js`, 38 assertions, with the expectations
computed from today's date rather than hard-coded — a test that only passes in
September is a test that fails in October for no reason.

**Not mine:** `tests/assessment-tools-placement.test.js`, `tests/worship-team.test.js`.

---

## 2026-09-16 — Jordan's Claude (daily attendance shows its totals)

The register reported how much of itself had been **typed in** — *"18 of 23
students have attendance marked"* — and never what those marks said. The one
question anybody asks at the door, how many are in and how many are out, was
the one thing you had to work out by counting rows.

There is now a strip of totals above the roster: Present, Absent, Late, Left
early, Late & left early, and how many are still unmarked.

**It counts the roster rather than keeping a running total.** This register is
edited from more than one phone and pulls other devices' marks in every 20
seconds; a tally incremented as changes happen drifts the first time two people
touch the same child, and drifts *silently*, which on an attendance screen is
the worst way to be wrong. Counting the dropdowns means a remote change
repaints it for free — `refreshDailyAttendance` already routes every row it
moves through `onAttendanceStatusChange`, which is where the repaint hangs.

Two deliberate choices:

* **Only statuses that actually happened are shown.** A row of zeroes is noise
  and buries the two numbers that matter on a normal morning.
* **Hidden rows still count.** The search box filters the list, but the total
  is the total for the day; a tally that moved when someone typed a name would
  be worse than none.

A day with nobody scheduled renders no strip at all — the roster already prints
its own "no students are scheduled on Wednesday", and a second empty-state
beside it just looks broken.

`tests/daily-attendance-tally.test.js`, 21 assertions against a DOM stub,
including a correction (present → late), which is the case a running total gets
wrong. Also rendered the four realistic states to a page and looked at it, so
the chips were checked as something a person reads and not only as counts.

**Not mine:** `tests/assessment-tools-placement.test.js`, `tests/worship-team.test.js`.

---

## 2026-09-16 — the tally was there, the number was invisible

Jordan could see "17 Absent" and not "46 Present". Both chips were rendering;
the Present **count** was a dark olive smudge on a dark card.

I put the number in `var(--accent-2)`. That is a theme variable — this portal
ships **six themes** and lets a person override the palette in
`site_theme_custom`, so it is whatever somebody picked. Absent happened to be
legible because `--danger` happened to contrast. That is luck, not design, and
I had checked exactly one theme: the one where it looked fine.

The number now wears **`var(--text)`** — the one colour a theme has to keep
readable against its own background, which is what it is for. The status still
reads at a glance from the icon and the border, and neither of those has to be
read as a *character*, so they can be any colour without costing anything.
Chip background moved to a neutral grey tint so it works on light themes too.

Verified by rendering the strip under **all six shipped themes plus a
deliberately hostile one** (dark `--accent-2` on a dark card, the shape of the
one that broke) and looking at every result. Guarded by a test that asserts the
number never takes a status variable and the border still does.

**The lesson, which is the reusable part:** a colour a theme controls is fine
for a border, a fill or an icon. It is not fine for anything that has to be
*read*, because a custom palette can put any two of those colours next to each
other. Text takes `--text`.

---

## 2026-09-16 — Riven can call off a whole teaching day

*"Cancel all my classes for the day except P1"* printed a list of all 21 of the
teacher's classes back at them. No intent covered it: `CANCEL_CLASS` needs a
class named and "classes" is not one, so the sentence fell to `LIST_CLASSES`,
which matched, answered, and looked like a refusal.

A teacher going home sick cancels their day, not one lesson at a time.

### The part that is easy to get backwards

**"cancel all my classes except Math" DOES name a class.** `CANCEL_CLASS` bids
on it and, with `requiresClass`, out-scores a modest weight — and the class it
would cancel is the one the teacher asked to **keep**. That is why `CANCEL_DAY`
sits at w:14, well clear of it.

The opposite mistake is just as easy: without requiring *all / every / the rest
of*, "cancel my math class" matches the new intent instead. Both directions are
pinned in `frontdoor-precision`, which now carries five routing cases including
`cancel math today` → `CANCEL_CLASS`.

### What it does and does not touch

Only classes that are **yours**, still **running**, and that actually **meet
that day**. Cancelling a session that was never going to happen writes a
cancellation nobody asked for, and it shows on the register as something called
off.

The exception clause takes periods (`except P1`, `except period 1`, `except 1st
period`, `except p1 and 3`) or a class by name.

**A class meeting in an excepted period is kept whole**, because cancelling is
per class per day — there is no way to cancel half of one. When that class also
meets outside the excepted period the confirmation says so explicitly; a
teacher expecting P5 to go should not find out from a student.

The confirmation lists every class with its periods, the marks each one loses,
the total, and that there is **no undo** for deleted marks. One class refusing
does not cost the other nine — RLS decides per row, and the failures are named.

`tests/riven-cancel-day.test.js`, 31 assertions. `CANCEL_DAY` is in
`WRITE_INTENTS` and in the harness's blast-radius set, so a question phrasing
cannot fire it and a confirmation is required.

**Not mine:** `tests/assessment-tools-placement.test.js`, `tests/worship-team.test.js`.

---

## 2026-09-16 — a snow day is not one teacher's day

`CANCEL_DAY` scoped to the asker's own classes. An admin saying *"cancel all
classes except P1"* would have had their own four cancelled and the other
twenty-two left running — **doing something, just not what was asked**, which
is worse than refusing.

It now takes a school-wide scope, through the same `_rivenSchoolScope` helper
the briefing uses: admin-only, and **only when asked for out loud** —
"school-wide", "every teacher's classes", "across the school".

**Scoping on the word "all" would have been the obvious shortcut and is the
wrong one.** "Cancel all my classes" is an ordinary sentence a teacher says on
an ordinary afternoon; letting it close every register in the building is not a
risk worth taking to save four words.

Three things the confirmation now does that it did not:

* Leads with **⚠️ School-wide** when that is what this is.
* **Names the teachers** whose days are being called off. A cancellation
  reaching nine other registers should say whose before it happens, not after.
* When an admin asks for their own and others also meet that day, says so and
  offers the wider form — the same shape as the briefing's "that's your own N
  classes, say school-wide for the other M".

A teacher who asks for school-wide is refused the reach, told why, and gets
their own day done rather than nothing. An admin who teaches nothing that day
used to be told they have no classes, which is true and useless; they are now
pointed at the school-wide form.

`tests/riven-cancel-day.test.js` is up to 43, `frontdoor-precision` to 70
writes with the school-wide phrasing pinned.

---

## 2026-09-16 — /admin now widens a question

`/admin who was missing today?` answered with the asker's own classes — the
same list they get without the prefix, so the prefix looked like it did
nothing. `/admin` meant "skip the confirmation" and nothing else, while the
obvious reading is "with my admin hat on".

It now widens the **scope of a question** too, through the same
`_rivenSchoolScope` helper. `/admin who was missing today?` covers every
teacher's classes; the answer's own header already says which scope it used,
so there is no ambiguity about what you are looking at.

### Two guards on that

**"my" wins.** `/admin cancel all MY classes` is a sentence that says whose,
and a prefix must not overrule it.

**A destructive write never widens on the prefix alone.** `terminalCancelDay`
passes `viaAdminPrefix: false`, so cancelling still costs the words
"school-wide". `/admin` also *skips the confirmation* — the two together would
turn eight typed words into every register in the building being cleared with
nothing in between. Widening what a question **answers** is free; widening what
a command **destroys** is not.

That asymmetry is the whole design, and it is worth keeping in mind for any
future bulk write: reads may take the prefix, writes must be told in words.

`tests/riven-cancel-day.test.js` is at 49, covering both directions plus the
teacher case and the no-prefix case.

---

## 2026-09-16 — the absence scan was reading the wrong register

`/admin who was missing today?` started saying **School-wide** and returned the
same list. The scope fix was working; the list barely moved because the people
who were actually missing **were never in the source**.

This school keeps two registers. `daily_attendance` is the morning one — did
the child come to school at all. `class_attendance` is per-lesson. They answer
different questions, and `terminalAttendanceIssues` only ever read the second.

Measured on the day: **16 absent on the daily register, 6 on the class
registers.** The answer named the 6. And because class registers are taken
patchily, widening to the whole school added two marks and looked like nothing
had changed — one bug wearing another one as camouflage.

It now reads both when no class is named. **A named class is the exception**:
"who's been absent in Chemistry" is a question about that lesson, and the daily
register cannot answer it.

### The counting trap, which is the part worth remembering

A child out all day has **one daily row and one class row per lesson**.
Counting both reports "5 absent" for one day off and ranks them above a child
who has genuinely missed three days. Rows are deduped per student per **day**,
with the daily register winning, so the number means days.

The scope filter applies to both registers — reading a second table must not
become a way round it, and that is asserted.

`tests/riven-attendance-sources.test.js`, 10 assertions, verified by putting
the bug back: the student who exists only on the daily register disappears
again.

**Worth checking elsewhere:** anything else answering an attendance question
off `class_attendance` alone is answering from the sparser of the two records.

---

## 2026-09-16 — ten names is not sixteen absences

The register fix took the answer from 6 to 10. It should have been 16. The
query was right by then; the **display** was throwing six people away.

`terminalAttendanceIssues` ended with a hard `.slice(0, 10)` and **said nothing
about it**. So a truncated answer was indistinguishable from a complete one —
and the number that matters most, *how many*, was the one figure never on
screen.

Now: the total leads the answer (`16 students — attendance issues
(school-wide, today)`), every name is in the message, and the tail past ten
collapses behind "…and 6 more students — show all" using `_briefingExpand`,
which the briefing already uses for exactly this. A list of three grows no
expander.

### Three bugs stacked on one question

Worth recording as a sequence, because each one hid the next:

1. The scan read only the class registers, so the 16 were never in the source.
2. Scope was own-classes-only, so even the class-register answer was short.
3. The display capped at 10, so fixing 1 and 2 still could not show 16.

Fixing any one alone looked like it had not worked. That is what made this take
three rounds, and it is the argument for checking a *number* against the
database rather than eyeballing whether a list "looks longer".

### Swept, not fixed

Other `.slice(0, N)` sites in Riven answers: pickers capping at 8 options and
"did you mean" lists capping at 5 are fine. The homework list caps at 10 but
**states its total in the header**, so it is honest about what it is holding
back — worth moving to `_briefingExpand` one day, not urgent.

`tests/riven-attendance-sources.test.js` is at 15, including a 16-student day
asserting every name is present and the tail is collapsed rather than dropped.

---

## 2026-09-16 — 17 was right, and still wrong

The answer said 17; the morning register said 16. Checked against the database:

```
absent on the daily register                 16
flagged in a class register                   6
  ... of those, NOT absent from school        1
merged total                                 17
```

Both numbers were correct. **16 children were off school, and a seventeenth was
in all day and missed one lesson.** Merging two registers merged two different
facts, and one number for both reads as an error against the register everybody
trusts.

They are also different jobs: off school is a phone call home, in school and
missing a lesson is a word with the teacher. So the answer now counts them
apart:

> 📉 **16 away from school · 1 in school but missed a class** *(school-wide, today)*

Each row carries which it is, the school absences sort first — the order
somebody works through them in — and a day with no class-only cases shows no
second clause at all.

### Worth keeping in mind

Every fix in this sequence was correct and every one still looked wrong,
because the number moved without the meaning being explained: 6 → 10 → 17 → 16
+ 1. **When two sources are combined, say which is which in the answer.** The
merge was right from the start; what was missing was the label.

`tests/riven-attendance-sources.test.js` is at 22, with the 16-vs-17 case
pinned exactly as it occurred.

---

## 2026-09-16 — the absence list stopped collapsing

The "show all" toggle was reported as not expanding on a phone.

**I could not reproduce it.** Driven in a real browser twice: once as a static
page, once through the whole delivery path — the answer rendered by
`terminalAttendanceIssues`, inserted by the real `_showRivenMessage`, then run
through the real `_linkifyTerminalEntities` (which explicitly skips anything
inside an `onclick`, so it was never the suspect it looked like). Both times:
`display:none` → `block`, all 17 rows, toggle text flips to "show less", no
console errors.

So rather than ship a guess at *why* a control fails on someone's phone, the
control is gone.

`_briefingExpand` is right for the briefing, where a list is one section of a
longer answer. It is wrong here: **"who was missing today" is a question whose
whole reply is the names.** Hiding a third of them behind a 12px line of text,
on a phone, at the door, is a worse failure than a long bubble — and a control
that has to work before the answer is readable should not be between the person
and the answer at all.

Every row now renders. The count is in the headline, so length is never a
surprise. Nothing to tap, nothing to miss.

The tests assert the *absence* of a toggle now, so this cannot quietly come
back as a tidy-up.

### …and then the cause turned up

The entry above is honest about what I knew at the time, and wrong about what
was happening. Photographs of the failure settled it: the label flipped to
"show less" and **nothing appeared**. A handler that runs to completion found
an element; nothing moving where the finger was means the element it found was
somewhere else.

`_briefingExpand` minted `brf-<counter>-<length>` and looked it up with
`getElementById`. The counter is an in-memory property on the app, so it
**restarts at 1 on every page load**. The transcript does not restart:
`_restoreTerminalChat` writes the saved HTML of the last 200 messages straight
back into `#terminal-output`. So this morning's answer came back out of
localStorage still carrying `brf-1-17`, this afternoon's identical answer
minted `brf-1-17` again, and `getElementById` returned the *first* one in
document order — the restored bubble, far up the scroll. The tap opened the old
copy, off-screen, and flipped the label on the new one.

That is why it never reproduced: a fresh page holds one copy. Rendering the
answer under two app objects — which is what a reload is — reproduces it on the
old build first try, in a real browser: the restored block goes to `block`, the
one that was clicked stays `none`, label says "show less".

**Fixed by deleting the id.** The toggle now reaches its block through
`previousElementSibling`; the block is emitted immediately before it, so that is
the markup's own relationship and nothing else in the document can join it. A
local relationship should not be expressed as a lookup through a document-wide
namespace. Verified in a real browser for both joiners (`''` and `<br>`): the
clicked copy opens, the restored copy stays shut, and it closes again.

This mattered well beyond the absence answer — `_briefingExpand` is used twelve
more times, almost all of them in the daily briefing, and every one of them was
broken the same way for anyone whose transcript had been restored.

The absence answer keeps its full list; that removal was a judgement about the
answer, not a workaround, and it still holds.

**The general lesson, worth remembering when adding anything interactive to a
Riven answer:** the transcript is persisted and replayed. Any markup Riven emits
can exist twice in one document, with a counter that started over in between.
Ids minted from in-memory counters are not unique there.

---

## 2026-09-16 — a date said out loud

`/admin who was missing September 14th` answered with the last 30 days and 59
names. `/admin who was missing?` answered with the same 59. Two different
questions, one answer, and both of them confident.

`_parseTimeframe` knew "yesterday", "last week", "3 days ago" and "on Monday",
and nothing at all about a calendar date. The window it fell back to *was*
disclosed — `(school-wide, last 30 days)` — in grey, 12px, at the end of the
headline. That is what makes this worse than a refusal: an answer that comes
back looks answered, and the four words saying otherwise are the ones a reader
skips.

**`_rivenPastDate` reads dates people name**, and `_parseTimeframe` consults it
first, so every dated question benefits and not just the absence scan:
`September 14th` · `Sept 14` · `14 September` · `9/14` · `9/14/26` ·
`Sept 14-18` · `Sept 14 to 18` · `in September` · `the 14th`.

**It reads backwards, on purpose.** `_rivenMonthDayDates` — the reader the
absence and cancellation flows use — resolves an ambiguous month *forwards*,
because "Meadow will be absent Sept 23" is a plan. A question is the other way
round: nobody was missing next May. The two stay separate rather than one
growing a flag meaning "except when it doesn't", and the test asserts both
directions on the same words.

The whole-month form insists on a preposition (`in September`, not `September`)
because **"may" is a verb far more often than it is a month**, and a bare one
would read "who may be absent" as a date in spring.

**A bare "who was missing?" now means today.** The simple past asks about the
occasion; the present perfect asks about the pattern, so "who *has been* absent"
still gets the 30 days. The gate only fires when nothing else supplied a date.

### The off-by-one that fell out of it

Writing the test for the 30-day default turned up that it was computed with
`toISOString()` — UTC. After about 5pm Pacific the UTC day has already rolled
over, so "the last 30 days" quietly began a day late while the label still said
30. That is the exact mistake `_isoDaysAgo` was written to prevent, and six
places were still making it: the activity log, two attendance readouts, the
absence scan, the class card and the notes window. All six now use
`_isoDaysAgo`.

### Two notes for next time

- **The harness-closure test earned its keep.** `_parseTimeframe` gained a
  collaborator and five harnesses blew up on the spot rather than silently
  testing a version of the parser that no longer exists. Adding
  `_rivenPastDate` and `_rivenMonthIndex` to their extract lists was the whole
  fix — but the failure is the feature.
- **Checked against the live register, and the numbers close the loop.** On
  2026-09-14 the morning register has **10** not-present and no class-only
  cases, so the answer is now "10 away from school (school-wide, September 14)".
  The **59** in the screenshots is exactly the count of distinct students with a
  non-present mark across 2026-08-17 → 2026-09-16 — the 30-day default, to the
  number. That is the diagnosis confirmed from the other end rather than
  inferred from the code.
- **The CLI is `npx -y supabase@latest`, not a global binary** — nothing named
  `supabase` is on PATH on this machine, which is why an earlier note in this
  session claimed the check could not be run. It can; see
  `reference_supabase_sql_via_cli`.

