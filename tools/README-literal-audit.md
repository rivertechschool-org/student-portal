# Literal audit

Finds string literals the site compares a database column against that the
column can never hold.

## Why

`account_status === 'active'` shipped and matched zero rows — the column holds
`activated`. Nothing threw, nothing logged. The Reports student picker just
came up empty on every visit, and because `'active'` *is* the right word in a
dozen other tables, the line reads correctly. That is the shape worth hunting:
a literal that is almost right. Exact nonsense gets noticed in review.

## Running it

```bash
node tools/literal-audit.js
```

`checks.json` is the ground truth and goes stale the moment a migration
changes a CHECK constraint. Regenerate it from the live database:

```bash
cd ../student-portal-backend
npx supabase db query --linked --project-ref <ref> -f tools/raw-checks.sql \
  > /tmp/raw.json          # table_name, conname, definition for contype='c'
cd ../student-portal
python tools/gen-check-contracts.py tools/raw-constraints.json tools/checks.json
```

`gen-check-contracts.py` prints every constraint it *declined* to treat as a
contract, with the reason. Read that list — it is where the tool's blind spots
are.

## What counts as a contract

Only constraints that pin one column to a fixed value set. Two shapes cost a
false finding each before the classifier was written:

| Constraint | Verdict |
|---|---|
| `outcome = ANY (ARRAY['routed','learned','weak','miss'])` | contract |
| `source IS NULL OR source = ANY (ARRAY[...])` | contract — nullable, same column |
| `shape IS NULL OR outcome = ANY (ARRAY['weak','miss'])` | **not** a contract — conditional, restricts `outcome` only when `shape` is set |
| `source = ANY (ARRAY[...]) OR source ~~ 'split_from:%'` | **not** a contract — open-ended |

The difference is which column the `OR` is about. Same column, still a
contract. Different column, it is a conditional rule and its literals are not a
whitelist.

## Tiers

| Tier | Meaning | Trust |
|---|---|---|
| `QUERY` | `.eq()`/`.neq()`/`.in()` naming a value the column cannot hold | high — unambiguously a database call |
| `NEAR-MISS` | a comparison one small edit from a legal value | medium — the tier that catches this bug class |
| `WRITE` | an insert/update payload that violates a CHECK | high — loud at runtime, better found here |

Tiers 2 and 3 only fire for columns the file actually reads from the database
(harvested from its own `.select()`/`.eq()` calls). Without that, a terminal
game's `n.type === 'file'` and a 3D game's `enemy.userData.state === 'patrol'`
drown the report — two of the loudest offenders never call `.from()` at all.

## Known residue

Expected hits that are not bugs:

- `extensions/testing-center.html` — `submissionsDatabase` is a local `{}` whose
  keys happen to collide with column names.
- `portal/index.html` — `.in('account_status', ['activated', 'active'])` is
  deliberate: `isActivated()` accepts the legacy spelling, so the query does too.

Listing every legal value is **not** the same as not filtering — `.in()` with
all three spellings still drops rows where the column is NULL. If the intent is
"no filter", write no filter.
