// Text a family typed must not be rendered as markup.
//
// Emergency contacts are the clearest case in the portal: a family fills them
// in on the PUBLIC enrolment form, with no account and no member of staff in
// the loop, and staff read them straight back on the student record. Every
// other value on that screen went through escapeHtml. The contact's name,
// relationship, two phone numbers, email and notes did not — on the card, and
// again in the edit form where they sit inside `value="…"` attributes, where a
// single quote character is enough to leave the attribute.
//
// This file is deliberately narrow. It checks the paths where the text reaches
// the page from OUTSIDE the school, rather than trying to police every
// interpolation in a 72,000-line file — that wider sweep is a separate job and
// is written up in HANDOFF.md.
//
// Run: node tests/escape-family-input.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// Pull one method out by name, by walking its braces.
function methodSource(name) {
  const re = new RegExp(`\\n {6}(?:async )?${name}\\s*\\(`);
  const m = re.exec(html);
  if (!m) throw new Error(name + ' not found');
  let i = html.indexOf('{', m.index + m[0].length - 1), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(m.index, i);
}

const lineOf = (hay, idx) => hay.slice(0, idx).split('\n').length;

console.log('\n== the escaper itself ==\n');

{
  const body = methodSource('escapeHtml');
  for (const [ch, ent] of [['&', '&amp;'], ['<', '&lt;'], ['>', '&gt;'], ['"', '&quot;'], ["'", '&#39;']]) {
    ok(`escapeHtml replaces ${ch}`, body.includes(ent));
  }
  // The quote and apostrophe are the ones that matter for value="…".
  ok('  including both quote characters', /&quot;/.test(body) && /&#39;/.test(body));
}

console.log('\n== what a family typed, rendered back ==\n');

// Every contact.* value that reaches the page, on the card and in the edit form.
const FAMILY_FIELDS = [
  'contact_name', 'relationship', 'phone_primary', 'phone_secondary', 'email', 'notes'
];

for (const fn of ['renderEmergencyContactCard', 'editEmergencyContact']) {
  const body = methodSource(fn);
  const raw = [];

  // Any ${ … contact.<field> … } that is not wrapped in an escaper.
  for (const m of body.matchAll(/\$\{([^{}]*)\}/g)) {
    const expr = m[1];
    if (!/\bcontact\.(\w+)/.test(expr)) continue;
    const field = expr.match(/\bcontact\.(\w+)/)[1];
    if (!FAMILY_FIELDS.includes(field)) continue;          // ids, booleans, flags
    if (/escapeHtml|jsAttr/.test(expr)) continue;          // escaped
    if (/===|!==|\?\s*'[^']*'\s*:/.test(expr) && !/\+/.test(expr)) continue;  // a comparison, not output
    raw.push(`${fn}:${lineOf(body, m.index)} ${expr.trim().slice(0, 60)}`);
  }
  check(`${fn} escapes everything a family typed`, raw, []);
}

console.log('\n== and specifically inside an attribute ==\n');

{
  // value="${…}" is the shape a stray quote escapes from. None may be raw.
  const body = methodSource('editEmergencyContact');
  const rawAttrs = [...body.matchAll(/value="\$\{([^}]*)\}"/g)]
    .map(m => m[1])
    .filter(e => /\bcontact\./.test(e) && !/escapeHtml|jsAttr/.test(e));
  check('no value="" attribute holds unescaped contact data', rawAttrs, []);

  const escaped = [...body.matchAll(/value="\$\{this\.escapeHtml\([^}]*\)\}"/g)].length;
  ok(`  and the ones that exist are escaped (${escaped})`, escaped >= 4);
}

console.log('\n== the other two outside-the-school paths ==\n');

{
  // A parent types a child's name into the link-request form with nothing but
  // an account; staff see the candidate list built from it.
  const body = methodSource('showParentLinkRequests');
  ok('link-request candidate names are escaped',
     /\$\{this\.escapeHtml\(c\.first_name\)\}/.test(body));
  ok('  and so is the grade beside them',
     /escapeHtml\(String\(c\.grade_level\)\)/.test(body));
}

{
  // The merge screens build a display name from two columns. Escaping it where
  // it is BUILT means every caller is safe, rather than four callers each
  // having to remember.
  ok('the merge screens escape a built name at source',
     /const nameOf = \(p\) => this\.escapeHtml\(/.test(html));
}

console.log('\n== the guard that is not a guard ==\n');

{
  // `this._escapeHtml ? this._escapeHtml(x) : x` read like a guard against a
  // missing helper. The helper exists — it is declared at the four-space indent
  // that part of the class body uses — so the guard never took its false branch
  // and was only ever noise. It is noise that cost a reader ten minutes, so it
  // is gone; both escapers are byte-identical.
  check('no conditional-escape guards remain',
        (html.match(/_escapeHtml \? this\._escapeHtml/g) || []).length, 0);
  ok('_escapeHtml is a real method, not a hoped-for one',
     /\n {4}_escapeHtml\(s\) \{/.test(html));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
