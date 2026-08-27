"""Run the re-key migration against a real PostgreSQL and assert what it does.

Two production failures came from reasoning about this SQL instead of executing
it. There is a live PostgreSQL 16 on this machine, so it gets executed.

Fixtures cover every shape the real table can present:
  A  old name only                    -> plain rename
  B  BOTH names                       -> the collision that broke v1; must merge
  C  'Trig Functions' AND 'Trigonometry' -> the rename chain; must not collapse
  D  both names, old row is behind     -> merge must keep the better values
  E  a Math skill not in the map       -> untouched
  F  same skill name, different subject-> untouched

Then it runs the migration a second time to prove it is idempotent.
"""
import os
import sys
import uuid

import psycopg2

sys.stdout.reconfigure(encoding="utf-8")

# The migrations live in the private student-portal-backend repo. Override with
# BACKEND_REPO=/path/to/student-portal-backend, else assume a sibling checkout.
_BACKEND = os.environ.get(
    "BACKEND_REPO",
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "student-portal-backend"),
)
MIGRATION = os.path.join(_BACKEND, "supabase", "migrations", "zzzzzzz_rekey_math_skill_progress_names.sql")
DB = "rekey_test_scratch"

root = psycopg2.connect(host="localhost", user="postgres", password="postgres", dbname="postgres")
root.autocommit = True
with root.cursor() as c:
    c.execute(f'DROP DATABASE IF EXISTS {DB}')
    c.execute(f'CREATE DATABASE {DB}')
root.close()

con = psycopg2.connect(host="localhost", user="postgres", password="postgres", dbname=DB)
con.autocommit = True
cur = con.cursor()

# Mirror of the live table (FK to profiles dropped; irrelevant here).
cur.execute("""
CREATE TABLE skill_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  subject TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'locked'
    CHECK (state IN ('locked','available','in_progress','mastered','activated')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  mastery_score INTEGER DEFAULT 0 CHECK (mastery_score >= 0 AND mastery_score <= 100),
  last_practiced TIMESTAMPTZ DEFAULT now(),
  practice_count INTEGER DEFAULT 0,
  decay_rate INTEGER DEFAULT 14,
  decay_steps_applied INTEGER DEFAULT 0,
  last_evidence_at TIMESTAMPTZ,
  p_mastered REAL,
  UNIQUE(user_id, subject, skill_name)
);
""")

U = {k: str(uuid.uuid4()) for k in "ABCDEF"}


def add(u, subject, skill, state, score, count, pm=None, decay=0, practiced="2026-01-01"):
    cur.execute(
        "INSERT INTO skill_progress (user_id,subject,skill_name,state,mastery_score,"
        "practice_count,p_mastered,decay_steps_applied,last_practiced,last_evidence_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (U[u], subject, skill, state, score, count, pm, decay, practiced, practiced))


add("A", "Math", "Counting", "in_progress", 55, 4)
add("B", "Math", "Counting", "mastered", 90, 5, 0.91, 0, "2026-06-01")
add("B", "Math", "Counting and Number Recognition", "in_progress", 40, 3, 0.30, 4, "2026-02-01")
add("C", "Math", "Trig Functions", "in_progress", 35, 2)
add("C", "Math", "Trigonometry", "mastered", 88, 9)
add("D", "Math", "Addition", "available", 10, 1, 0.10, 6, "2026-01-05")
add("D", "Math", "Basic Addition", "mastered", 95, 7, 0.95, 0, "2026-07-01")
add("E", "Math", "Word Problems", "in_progress", 60, 3)   # not in the map
add("F", "Science", "Counting", "mastered", 100, 9)

before = {}
cur.execute("SELECT user_id, subject, skill_name FROM skill_progress")
for uid, s, n in cur.fetchall():
    before.setdefault(uid, set()).add((s, n))

sql = open(MIGRATION, encoding="utf-8").read()

ok, fail = [], []


def check(label, claim, detail=""):
    (ok if claim else fail).append(label)
    print(("  PASS  " if claim else "  FAIL  ") + label + (f"   {detail}" if detail and not claim else ""))


print("RUN 1")
try:
    cur.execute(sql)
    for note in con.notices[-6:]:
        print("     " + note.strip().replace("NOTICE:  ", ""))
    check("migration executes without error", True)
except Exception as e:
    check("migration executes without error", False, str(e).strip().splitlines()[0])
    print("\nABORTING — migration did not run")
    sys.exit(1)


def rows(u):
    cur.execute("SELECT skill_name, state, mastery_score, practice_count, p_mastered,"
                " decay_steps_applied FROM skill_progress WHERE user_id=%s AND subject='Math'"
                " ORDER BY skill_name", (U[u],))
    return {r[0]: r[1:] for r in cur.fetchall()}


print("\nRESULTS")
a = rows("A")
check("A: plain rename applied", list(a) == ["Counting and Number Recognition"], str(list(a)))

b = rows("B")
check("B: the collision merged to one row", list(b) == ["Counting and Number Recognition"], str(list(b)))
if b:
    st, sc, pc, pm, dc = b["Counting and Number Recognition"]
    check("B: kept the furthest state", st == "mastered", st)
    check("B: kept the higher mastery_score", sc == 90, sc)
    check("B: summed practice_count (5+3)", pc == 8, pc)
    check("B: kept the higher p_mastered", abs(pm - 0.91) < 1e-6, pm)
    check("B: kept the lower decay_steps_applied", dc == 0, dc)

c = rows("C")
check("C: chain did not collapse two skills into one", len(c) == 2, str(list(c)))
check("C: 'Trigonometry' became 'Trigonometric Ratios'",
      c.get("Trigonometric Ratios", (None,))[0] == "mastered", str(c))
check("C: 'Trig Functions' became 'Trigonometry'",
      c.get("Trigonometry", (None,))[0] == "in_progress", str(c))

d = rows("D")
check("D: merged where the old row was behind", list(d) == ["Basic Addition"], str(list(d)))
if d:
    st, sc, pc, pm, dc = d["Basic Addition"]
    check("D: better values survived", st == "mastered" and sc == 95 and pc == 8, f"{st} {sc} {pc}")

e = rows("E")
check("E: unmapped Math skill untouched", list(e) == ["Word Problems"], str(list(e)))

cur.execute("SELECT skill_name FROM skill_progress WHERE user_id=%s AND subject='Science'", (U["F"],))
check("F: other subject untouched", cur.fetchall() == [("Counting",)])

cur.execute("SELECT count(*) FROM skill_progress")
check("no rows lost or invented (9 in, 7 out after 2 merges)", cur.fetchone()[0] == 7)

print("\nRUN 2 — idempotency")
snap = {}
cur.execute("SELECT user_id, subject, skill_name, state, mastery_score, practice_count FROM skill_progress")
snap = sorted(cur.fetchall())
try:
    cur.execute(sql)
    check("second run executes without error", True)
except Exception as ex:
    check("second run executes without error", False, str(ex).strip().splitlines()[0])
cur.execute("SELECT user_id, subject, skill_name, state, mastery_score, practice_count FROM skill_progress")
check("second run changed nothing", sorted(cur.fetchall()) == snap)

cur.close()
con.close()
root = psycopg2.connect(host="localhost", user="postgres", password="postgres", dbname="postgres")
root.autocommit = True
with root.cursor() as c:
    c.execute(f'DROP DATABASE IF EXISTS {DB}')
root.close()

print(f"\n{'=' * 58}\n  {len(ok)} passed, {len(fail)} failed")
sys.exit(1 if fail else 0)
