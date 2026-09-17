# Working in this repo

Read this first, then **read `HANDOFF.md`** — that is where the other people working on
this repo and their assistants leave notes for you, and where you leave yours.

`CONTRIBUTING.md` is the long version of everything below. Read it before your first
substantial change.

---

## The rule that shapes everything else

**This repo is public and GitHub Pages serves every file in it verbatim.** Anything
committed to `main` is readable by anyone at `https://rivertech.me/<path>` within about 25
seconds. There is no build step and no allow-list. That includes markdown.

So nothing here may contain:

- keys, tokens, credentials, connection strings
- security findings, audit notes, or any description of an unpatched weakness
- student, family, or staff data — names, grades, addresses, health or behavioral notes
- database schema, RLS policies, or anything describing how access control works

Those belong in the private `student-portal-backend` repo. **If a change affects what the
database allows or stores, it is not a change to this repo** — write the SQL, explain it in
plain language, and hand it over rather than committing it here.

## The two repos

| | `student-portal` (here) | `student-portal-backend` |
| --- | --- | --- |
| Public — served at rivertech.me | Private |
| Pages, games, curriculum data, client JS | Schema, RLS, functions, migrations |
| Push to `main` → live in ~25s | Migrations applied to Supabase by hand |

A Claude session can reach the backend repo now (ask for it by name if it is not already
attached). When work needs a schema change, **the migration goes there**, under
`supabase/migrations/`, following that repo's own rules — read its README first: filenames
are the apply order, the header comment feeds a generated map, and the map is regenerated
in the same commit.

Applying is still by hand: there is no CI and no staging, so hand Luke the SQL to paste
into the Supabase SQL editor, and commit the file either way so the repo is the record.

In `HANDOFF.md` here, leave a plain-language pointer only — never the SQL, and never a
description of a policy. That would put the access-control model on a public web page,
which the rule above forbids.

## Stack

Vanilla JS, HTML and CSS. No framework, no bundler, no npm, no build step. Every page is
one self-contained HTML file with its JS embedded, which has two consequences worth
holding onto:

- `portal/index.html` is ~40k lines. **Grep it, never read it whole.**
- A stray backtick in a template literal silently breaks a whole page. Always syntax-check
  before pushing (below).

## Before you push

Nothing here runs in CI, so these are on you. All of them are plain `node`, no install:

```bash
node tests/extract-portalui.js                                     # FIRST: four suites read its output
for f in tests/*.test.js; do node "$f" || echo "FAILED $f"; done   # the suite
node debug-tools/nlp-stress.js                                     # Riven, after any Riven change
node debug-tools/attendance-matrix.js                              # 326 attendance phrasings
node debug-tools/name-resolution.js                                # 83 ways to name a student
```

`attendance-matrix.js` is the grid, not a sample: every way of asking who is or was
away, crossed with every way of saying when. Five bug reports in one afternoon were
that same question phrased differently, each fixed with one more regex, each followed
by another report. If you are about to add a regex to an attendance intent, add the
phrasing to the grid first and see how much else is already broken.

`tests/portalui.js` is generated and deliberately not committed. Skip that first line and
the nav suites read a stale copy, or none at all, and fail for a reason that has nothing to
do with your change.

Syntax-check any page you edited — this catches the broken-template-literal class of bug
that the tests cannot:

```bash
node --input-type=module -e "
import fs from 'fs';
const s = fs.readFileSync('portal/index.html','utf8');
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m, n = 0; while ((m = re.exec(s))) { n++; try { new Function(m[1]); }
  catch (e) { console.log('BROKEN: ' + e.message); } }
console.log(n + ' inline scripts checked');"
```

Two suites fail on a clean tree for reasons unrelated to any current work —
`inequality-region` and `typed-answer-mode`, both missing a `tests/ai.js` extraction step.
Compare against a clean checkout before assuming you broke something.

Chromium is available for a real smoke test: serve the repo with
`python3 -m http.server 8765` and drive `http://localhost:8765/portal/index.html` with
Playwright at `/opt/pw-browsers/chromium`. The page loads fully offline; only the Supabase
calls fail, which is expected. Do this for any visible UI change — it catches what a
DOM stub cannot.

## Beta-test it yourself, end to end

**Before handing a feature over, walk the whole journey in a browser as each person who
uses it** — not the function you changed, the journey: the student who asks to join, the
admin who plans a service from an empty date, the player who opens it on Sunday morning.
Luke should not be the one who finds out that step four does not reach step five.

Unit tests hold single functions honest. Journeys hold the SEAMS honest — the places where
a render, a write and a reload have to agree — and every bug that has reached Luke on this
page has lived in a seam, not in a function.

Write it as a harness, not a one-off click-through, so the next change re-runs it:

```bash
python3 -m http.server 8765 &
node debug-tools/worship-journeys.mjs        # the pattern to copy
```

Two things that harness learned the hard way, both worth copying:

- **Give the stub the schema's column defaults.** A stub without them is *stricter* than
  Postgres: the page rightly omits a defaulted column on insert, reads the row back, and
  the stub reports a bug that cannot happen. Cry wolf twice and the harness stops being
  read.
- **Hand back copies of rows, not the rows themselves.** A real client cannot reach into
  your page's state. A stub that shares object references lets a write appear to take
  effect on data the page is still holding, which is neither how it behaves nor how it
  fails.

## Conventions

- **Comment what you write, and why.** Match the density of the code around you. Leave
  other people's code alone.
- Tests here extract the real method out of the HTML and run it against a hand-built DOM
  stub. Follow that pattern — see `tests/attendance-search.test.js`.
- Client-side `if (admin)` is a UX affordance, not a control. Real security is RLS, which
  lives in the other repo.
- Some Supabase queries cap at 1000 rows. Paginate full fetches.
- Bump `RIVEN_BUILD` on any change to the Riven page, so Luke can confirm at a glance that
  he is seeing the latest deploy.

## Leaving the repo

**Append an entry to `HANDOFF.md` before you finish** whenever you did something the next
person would otherwise have to reverse-engineer: a decision and its reasoning, something
you deliberately did not do, a question you need answered, or a step someone has to take by
hand. Skip it for routine work that speaks for itself in the diff.
