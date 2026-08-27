# student-portal

K-12 student learning portal with educational games, running at **[rivertech.me](https://rivertech.me)**.
Maintained by the River Tech School org.

> **This repo is public and every file in it is published to rivertech.me.**
> No credentials, no student data, no internal notes. See [CONTRIBUTING.md](CONTRIBUTING.md) first.

- **Stack:** vanilla JS/HTML/CSS with no build step; Supabase (Postgres + Auth + RLS) behind it.
- **Deploy:** push to `main` → GitHub Pages → live in ~25 seconds. There is no staging; `main` is production.
- **Backend:** the database schema, RLS policies, and edge functions live in the **private**
  repo [`student-portal-backend`](https://github.com/rivertechschool-org/student-portal-backend),
  not here. Clone it as a sibling directory and the `tools/` curriculum pipeline finds it
  automatically. See [The two repos](CONTRIBUTING.md#the-two-repos).

Start with [CONTRIBUTING.md](CONTRIBUTING.md) — it covers the publishing rule, the stack, and the
conventions that are easy to trip over.
