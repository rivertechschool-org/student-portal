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

Claude sessions generally have access to **this repo only**. When work needs a schema
change, write the exact SQL into your reply and into `HANDOFF.md`, and say who has to run
it. Do not commit migrations here.

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
for f in tests/*.test.js; do node "$f" || echo "FAILED $f"; done   # the suite
node debug-tools/nlp-stress.js                                     # Riven, after any Riven change
```

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
