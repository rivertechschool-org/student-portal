# Contributing

This repo is owned by the **River Tech School** org (`rivertechschool-org`) and powers the
live student portal at **rivertech.me**. It moved here from a personal account in August 2026;
if you have an old clone pointing at `RiverTech-devs/student-portal`, repoint it:

```bash
git remote set-url origin https://github.com/rivertechschool-org/student-portal.git
```

---

## The one rule that changes how you work here

**This repository is public, and GitHub Pages publishes _every file in it_ verbatim.**

There is no build step and no allow-list. If a file is committed to `main`, it is readable by
anyone at `https://rivertech.me/<path>` — including SQL migrations, config, tooling, and any
markdown you drop in the root. Assume every commit is a press release.

That means **this repo is not the place for**:

- API keys, tokens, service-role credentials, or connection strings
- Security notes, audit findings, or anything describing an unpatched weakness
- Student, family, or staff data — real names, addresses, grades, health or behavioral notes
- Internal planning docs, review checklists, or working notes

Internal engineering and review docs used to live in this repo's root. They were removed in
August 2026 precisely because they were being served to the public. Keep that kind of material
in a **private** repo, a shared drive, or GitHub Issues on a private tracker — not here.

If you find a security problem, **do not open a public issue and do not write it into a file
here.** Contact a repo admin directly.

---

## The two repos

The portal is split across two repositories. They deploy separately, by different
mechanisms, and only one of them is public.

| | `student-portal` (you are here) | [`student-portal-backend`](https://github.com/rivertechschool-org/student-portal-backend) |
| --- | --- | --- |
| **Visibility** | **Public** — every file is served at rivertech.me | **Private** |
| **Holds** | Everything the browser loads: pages, games, curriculum data, viewers | Database schema, RLS policies, functions, edge functions |
| **Deploys by** | Push to `main` → GitHub Pages, ~25s, live | Applying migrations to Supabase by hand |
| **Breaking it** | Wrong page content, broken layout | Wrong data, wrong permissions, locked-out users |

They meet at exactly one seam: **`shared/config.js`**, which holds the Supabase project
URL and anon key. Everything the browser can do is whatever that anon key plus the RLS
policies in the backend repo allow. There is no application server in between.

That has a consequence worth internalizing: **this repo cannot enforce security.** A
client-side `if (admin)` check is a UX affordance, not a control — anyone can bypass it
with devtools. If a rule matters, it must exist as an RLS policy in the backend repo.

### Where do I look for...

| I need to change... | Repo | Where |
| --- | --- | --- |
| A page, a game, wording, layout | **here** | the relevant `.html` |
| What data a role can see or edit | backend | a new migration with an RLS policy |
| A new table or column | backend | a new migration |
| Scheduled email, PIN login, account deletion, Drive upload | backend | `supabase/functions/` |
| Curriculum content (nodes, edges, lessons) | **here** | `Trees/master_tree.csv`, then the `tools/` pipeline |
| Curriculum seed data **in the database** | backend | the `*_seed*.sql` migrations |
| "Why can this user see that?" | backend | `MIGRATION_MAP.md` → the table index |

**If it changes what the database allows or stores, it belongs in the backend repo.** If it
changes what the browser draws, it belongs here.

### The curriculum pipeline spans both

The compile tools in `tools/` read `Trees/master_tree.csv` from **this** repo and write seed
SQL into `supabase/migrations/` in the **backend** repo. Clone the two side by side and they
find each other automatically:

```
<somewhere>/student-portal/
<somewhere>/student-portal-backend/
```

`tools/backend-path.js` resolves the backend checkout — `$BACKEND_REPO` if set, else the
sibling directory. If it can't find one it fails with instructions rather than writing to
the wrong place.

## Stack, in one breath

- **Frontend:** vanilla JS + HTML + CSS. No framework, no bundler, no npm, no build step.
  Each page is a self-contained HTML file with embedded JS.
- **Backend:** Supabase — Postgres, Auth, RLS, Realtime, Edge Functions. The migrations and
  edge functions are **not in this repo** — see [The two repos](#the-two-repos).
- **Deploy:** push to `main` → GitHub Pages classic build (~25s) → live at rivertech.me.
  There is no CI and no staging. `main` *is* production.

The Supabase anon key in `shared/config.js` is public by design — it identifies the project.
Security comes from **Row Level Security policies**, not from hiding that key. Likewise the
Firebase web API keys: public by design, guarded by Firebase rules.

---

## Conventions that will bite you if you miss them

1. **No build step means no compiler.** A syntax error doesn't fail a build — it silently
   breaks the page in some browsers. Be careful with template-literal escaping, and load the
   page you changed before you push.
2. **RLS is the security model.** Client-side `if (admin)` checks are UX only; anyone can
   bypass them. Every access rule must exist as a policy on the table — defined in the
   backend repo, not here.
3. **Migrations live in the backend repo**, and they sort **alphabetically**, not by timestamp,
   so the filename decides when a migration runs and a later file silently overrides an earlier
   one. That is why fixes carry a `zz_` prefix. Read `MIGRATION_MAP.md` there before changing
   the schema, and take extra care with anything touching `user_profiles` RLS — a recovery
   migration exists because locking that table out has happened before.
4. **The big files are big.** `portal/index.html` is ~55k lines and the student `index.html`
   is ~6k. Search for the section you need; don't open them whole.
5. **`index.html` and `portal/index.html` do not share modules.** They duplicate some logic.
   Change shared behavior in both, and check both.
6. **`enrollment/index.html` is effectively its own app.** Don't assume it shares state.
7. **Supabase paginates at 1000 rows by default.** For full fetches — curriculum edges,
   attendance, grade history — paginate explicitly or you will silently truncate.
8. **`firebase/` is live**, backing arcade multiplayer. It looks vestigial. It is not.
9. **Curriculum graph compilation is a manual pipeline.** Source of truth is
   `Trees/master_tree.csv`; compiled output lands in `data/compiled/`. Run the `tools/*.js`
   scripts in order after any curriculum change, and commit the regenerated output.
10. **`.nojekyll` is load-bearing.** It disables Jekyll processing. Deleting it changes how
    every page is served.

---

## Before you push

`main` deploys straight to a site that students, parents, and staff use during the school day.

- Open the page you changed in a browser first.
- Prefer a branch and a PR for anything beyond a copy fix.
- Never commit a credential. If you do, rotate it — deleting the file does **not** remove it
  from history, and this repo is public.
