#!/usr/bin/env python
"""Turn the live CHECK constraints into tools/checks.json for literal-audit.js.

The hard part is deciding which constraints are actually a value-set contract.
Two shapes cost me a false finding each before this was written:

  riven_usage_shape_only_on_gaps
      CHECK (shape IS NULL OR outcome = ANY (ARRAY['weak','miss']))
      A CONDITIONAL. It restricts `outcome` only when `shape` is set. Read as a
      whitelist it makes 'routed' look illegal, and 'routed' is written by the
      portal on every routed utterance.

  skill_progress_source_check
      CHECK (source IS NULL OR source = ANY (ARRAY[...,'math-tutor',...]))
      A NULLABLE VALUE SET, and a real contract. Dropping every constraint
      containing IS NULL threw this away and made a correct query look wrong.

The difference is which column the OR is about. Same column: still a contract.
Different column: conditional, not a contract. A regex/LIKE branch means the
set is open-ended, so it is not a contract either.

Usage:
    python tools/gen-check-contracts.py raw-constraints.json
    (raw dump: table_name, conname, definition for contype='c' in public)
"""

import json
import io
import re
import sys

# `col = ANY (ARRAY['a'::text, ...])`, and the varchar rendering
# `(col)::text = ANY (ARRAY[('a'::character varying)::text, ...])`
ANY_RE = re.compile(r"\(?([a-z_][a-z0-9_]*)\)?(?:::text)?\s*=\s*ANY\s*\(ARRAY\[")
LITERAL_RE = re.compile(r"'([^']*)'::(?:text|character varying)")
# Every bare column reference, so we can tell which columns a definition mentions.
IDENT_RE = re.compile(r"\(([a-z_][a-z0-9_]*)\)?::|(?<![\w'])([a-z_][a-z0-9_]*)\s*(?:=|IS)")

SQL_WORDS = {"any", "array", "text", "null", "is", "check", "and", "or", "not",
             "character", "varying", "lower", "length", "true", "false"}


def columns_mentioned(defn):
    """Column names the definition tests, ignoring SQL keywords and literals."""
    stripped = re.sub(r"'[^']*'", "''", defn)          # drop string literals
    names = set()
    for m in re.finditer(r"[a-z_][a-z0-9_]*", stripped):
        w = m.group(0)
        if w in SQL_WORDS:
            continue
        names.add(w)
    return names


def classify(defn):
    """(column, values) if this is a value-set contract, else (None, reason)."""
    m = ANY_RE.search(defn)
    if not m:
        return None, "no ANY(ARRAY[...])"
    col = m.group(1)

    if "~~" in defn or re.search(r"(?<!\w)~(?!~)", defn):
        return None, "open-ended (LIKE/regex branch)"

    if " OR " in defn:
        # An OR is fine when every branch is about the same column - that is
        # just a nullable value set. An OR about another column is a
        # conditional rule, and its literals are not a whitelist.
        others = columns_mentioned(defn) - {col}
        if others:
            return None, "conditional on " + ", ".join(sorted(others))

    values = sorted(set(LITERAL_RE.findall(defn)))
    if not values:
        return None, "no literals"
    return col, values


def main():
    raw = json.load(io.open(sys.argv[1], encoding="utf-8"))
    out, skipped = {}, []
    for r in raw:
        col, res = classify(r["definition"])
        if col is None:
            skipped.append((r["table_name"], r["conname"], res))
            continue
        out.setdefault(r["table_name"] + "." + col, []).append(res)

    dest = sys.argv[2] if len(sys.argv) > 2 else "tools/checks.json"
    io.open(dest, "w", encoding="utf-8").write(
        json.dumps(out, indent=1, sort_keys=True))

    print("%d value-set contracts -> %s" % (len(out), dest))
    print("\nnot contracts (correctly ignored):")
    for t, c, why in sorted(skipped):
        print("  %-34s %s" % (t + "." + c, why))


if __name__ == "__main__":
    main()
