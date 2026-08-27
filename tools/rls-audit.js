// Walks supabase/migrations/*.sql in alphabetical order (the repo's
// canonical apply order), parses CREATE TABLE / ENABLE ROW LEVEL
// SECURITY / CREATE POLICY / DROP POLICY / GRANT statements, and
// builds the final RLS state per table. Flags anomalies.
//
// This is intentionally a regex-based scraper, not a real SQL parser.
// The goal is to catch obvious holes, not to be 100% correct.
const fs = require('fs');
const path = require('path');

const BACKEND = require('./backend-path');  // private backend repo
const MIG_DIR = path.join(BACKEND, 'supabase', 'migrations');
const files = fs.readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort();

// State: Map(tableName => {
//   created: boolean,
//   rlsEnabled: boolean,
//   policies: Map(policyName => { action, for, cmd, using, check, firstSeenIn })
//   grants: [{ role, priv }]
// })
const tables = new Map();

function getTbl(name) {
  if (!tables.has(name)) {
    tables.set(name, { created: false, rlsEnabled: false, policies: new Map(), grants: [], definedIn: null });
  }
  return tables.get(name);
}

// Strip SQL comments: -- line comments and /* block comments */
function stripComments(sql) {
  // Block comments
  sql = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  // Line comments
  sql = sql.replace(/--[^\n]*/g, '');
  return sql;
}

// Split by top-level semicolons (naively; good enough for migrations)
function splitStatements(sql) {
  const out = [];
  let buf = '';
  let inStr = false;
  let dollarTag = null; // e.g. $$ or $tag$
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    // Dollar-quoted string handling: look for $...$
    if (!inStr && !dollarTag && c === '$') {
      const m = sql.slice(i).match(/^\$([A-Za-z_]*)\$/);
      if (m) {
        dollarTag = m[0];
        buf += dollarTag;
        i += dollarTag.length - 1;
        continue;
      }
    }
    if (dollarTag && sql.slice(i, i + dollarTag.length) === dollarTag) {
      buf += dollarTag;
      i += dollarTag.length - 1;
      dollarTag = null;
      continue;
    }
    if (!dollarTag && c === "'" && sql[i-1] !== '\\') {
      inStr = !inStr;
    }
    if (!inStr && !dollarTag && c === ';') {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function norm(s) {
  return s.replace(/\s+/g, ' ').trim();
}

// Strip schema prefix (public.tbl -> tbl) and unquote
function cleanTblName(t) {
  if (!t) return t;
  t = t.trim();
  if (t.includes('.')) t = t.split('.').pop();
  t = t.replace(/^"|"$/g, '');
  return t;
}

for (const f of files) {
  const fpath = path.join(MIG_DIR, f);
  const raw = fs.readFileSync(fpath, 'utf8');
  const clean = stripComments(raw);
  const stmts = splitStatements(clean);
  for (const stmtRaw of stmts) {
    const stmt = norm(stmtRaw);
    if (!stmt) continue;

    // CREATE TABLE [IF NOT EXISTS] [schema.]name (...
    let m = stmt.match(/^CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([^\s(]+)/i);
    if (m) {
      const name = cleanTblName(m[1]);
      const t = getTbl(name);
      t.created = true;
      if (!t.definedIn) t.definedIn = f;
      continue;
    }

    // ALTER TABLE [IF EXISTS] [schema.]name ... ENABLE ROW LEVEL SECURITY
    m = stmt.match(/^ALTER TABLE(?:\s+IF EXISTS)?\s+([^\s]+)\s+ENABLE ROW LEVEL SECURITY/i);
    if (m) {
      const name = cleanTblName(m[1]);
      getTbl(name).rlsEnabled = true;
      continue;
    }

    // ALTER TABLE [IF EXISTS] ... DISABLE ROW LEVEL SECURITY (unusual but possible)
    m = stmt.match(/^ALTER TABLE(?:\s+IF EXISTS)?\s+([^\s]+)\s+DISABLE ROW LEVEL SECURITY/i);
    if (m) {
      const name = cleanTblName(m[1]);
      getTbl(name).rlsEnabled = false;
      continue;
    }

    // CREATE POLICY "name" ON [schema.]table AS {PERMISSIVE|RESTRICTIVE}? FOR {cmd}? TO {role}? USING (...) WITH CHECK (...)
    // Policy names can have spaces when quoted.
    m = stmt.match(/^CREATE POLICY\s+(?:"([^"]+)"|(\w+))\s+ON\s+([^\s]+)([\s\S]*)$/i);
    if (m) {
      const polName = m[1] || m[2];
      const tbl = cleanTblName(m[3]);
      const rest = m[4];
      const asMatch = rest.match(/\bAS\s+(PERMISSIVE|RESTRICTIVE)/i);
      const forMatch = rest.match(/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)/i);
      const toMatch = rest.match(/\bTO\s+([a-zA-Z_][a-zA-Z0-9_,\s]*?)(?=\s+USING|\s+WITH|$)/i);
      // USING (...) - capture balanced parens
      function captureBalanced(text, startIdx) {
        let depth = 0;
        let start = -1;
        for (let i = startIdx; i < text.length; i++) {
          if (text[i] === '(') { if (depth === 0) start = i + 1; depth++; }
          else if (text[i] === ')') { depth--; if (depth === 0) return text.slice(start, i); }
        }
        return null;
      }
      let usingExpr = null, checkExpr = null;
      const usingIdx = rest.search(/\bUSING\s*\(/i);
      if (usingIdx >= 0) {
        const parenIdx = rest.indexOf('(', usingIdx);
        usingExpr = captureBalanced(rest, parenIdx);
      }
      const checkIdx = rest.search(/\bWITH CHECK\s*\(/i);
      if (checkIdx >= 0) {
        const parenIdx = rest.indexOf('(', checkIdx);
        checkExpr = captureBalanced(rest, parenIdx);
      }
      getTbl(tbl).policies.set(polName, {
        name: polName,
        as: asMatch ? asMatch[1].toUpperCase() : 'PERMISSIVE',
        for: forMatch ? forMatch[1].toUpperCase() : 'ALL',
        to: toMatch ? norm(toMatch[1]) : 'public',
        using: usingExpr ? norm(usingExpr) : null,
        check: checkExpr ? norm(checkExpr) : null,
        firstSeenIn: f,
      });
      continue;
    }

    // DROP POLICY [IF EXISTS] "name" ON table
    m = stmt.match(/^DROP POLICY(?:\s+IF EXISTS)?\s+"?([^\s"]+)"?\s+ON\s+([^\s]+)/i);
    if (m) {
      const polName = m[1];
      const tbl = cleanTblName(m[2]);
      if (tables.has(tbl)) tables.get(tbl).policies.delete(polName);
      continue;
    }

    // GRANT {privs} ON [TABLE]? [schema.]name TO role
    m = stmt.match(/^GRANT\s+([^\s].*?)\s+ON\s+(?:TABLE\s+)?([^\s]+)\s+TO\s+([^;]+)/i);
    if (m) {
      const tbl = cleanTblName(m[2]);
      const t = getTbl(tbl);
      t.grants.push({ privs: norm(m[1]), role: norm(m[3]) });
      continue;
    }

    // REVOKE ... ON ... FROM ... (note: we're not tracking these deeply)
  }
}

// ---- Report ----
console.log(`Loaded ${tables.size} distinct table references from ${files.length} migrations\n`);

// Tables that likely hold user data (heuristic: check names)
const sensitiveKeywords = [
  'user_profiles', 'grade', 'submission', 'attendance', 'student', 'parent',
  'message', 'notification', 'rtc', 'irl_purchase', 'medical', 'emergency',
  'note', 'waiver', 'strike', 'homework', 'test_', 'quarter', 'skill_progress',
  'enrollment', 'email_log', 'bug_report', 'assignment', 'class_', 'purchase',
  'cosmetic', 'privilege', 'material_request', 'sheet',
];
const isSensitive = name =>
  sensitiveKeywords.some(k => name.toLowerCase().includes(k));

// 1. Tables that were created but have NO RLS enabled
console.log('=== Tables created but RLS NOT enabled ===');
const noRls = [];
for (const [name, t] of tables) {
  if (t.created && !t.rlsEnabled) noRls.push(name);
}
for (const n of noRls.sort()) {
  const sens = isSensitive(n) ? ' [SENSITIVE]' : '';
  console.log(`  ${n}${sens}  (created in ${tables.get(n).definedIn})`);
}

// 2. Tables with RLS enabled but NO policies -> locked out
console.log('\n=== Tables with RLS enabled but NO policies (locked out) ===');
const lockedOut = [];
for (const [name, t] of tables) {
  if (t.rlsEnabled && t.policies.size === 0) lockedOut.push(name);
}
for (const n of lockedOut.sort()) console.log(`  ${n}`);

// 3. Policies with USING (true) or similar overly-permissive clauses
console.log('\n=== Suspicious USING clauses ===');
const flagged = [];
for (const [tblName, t] of tables) {
  for (const [polName, p] of t.policies) {
    const u = p.using || '';
    const c = p.check || '';
    // Overly permissive patterns
    const bad = [];
    if (u === 'true' || u === '(true)') bad.push(`USING (true)`);
    if (c === 'true' || c === '(true)') bad.push(`WITH CHECK (true)`);
    if (u.match(/^\(?\s*auth\.uid\(\)\s+IS NOT NULL\s*\)?$/i)) bad.push(`USING only checks auth.uid() IS NOT NULL`);
    if (bad.length > 0) {
      flagged.push({ tbl: tblName, pol: polName, bad, policy: p });
    }
  }
}
for (const f of flagged) {
  const sens = isSensitive(f.tbl) ? ' [SENSITIVE]' : '';
  console.log(`  ${f.tbl}.${f.pol}${sens} (FOR ${f.policy.for})`);
  for (const b of f.bad) console.log(`    ${b}`);
}

// 4. Per sensitive table: show the full policy set so we can sanity-check
console.log('\n=== Sensitive-table policy summary ===');
const sensTables = [...tables.keys()].filter(isSensitive).sort();
for (const name of sensTables) {
  const t = tables.get(name);
  if (!t.created && t.policies.size === 0) continue;
  const counts = { SELECT: 0, INSERT: 0, UPDATE: 0, DELETE: 0 };
  for (const [, p] of t.policies) {
    if (p.for === 'ALL') { counts.SELECT++; counts.INSERT++; counts.UPDATE++; counts.DELETE++; }
    else if (counts[p.for] !== undefined) counts[p.for]++;
  }
  const rls = t.rlsEnabled ? 'RLS ON' : (t.created ? '!!! RLS OFF !!!' : '(dropped/not created)');
  console.log(`\n  ${name}  [${rls}]  policies: S=${counts.SELECT} I=${counts.INSERT} U=${counts.UPDATE} D=${counts.DELETE}`);
  // Show operations that have ZERO policies when RLS is on
  if (t.rlsEnabled) {
    const missing = Object.keys(counts).filter(op => counts[op] === 0);
    if (missing.length > 0) console.log(`    MISSING OPS: ${missing.join(', ')}`);
  }
}
