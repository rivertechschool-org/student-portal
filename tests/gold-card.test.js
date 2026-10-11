// The Gold card at the top of Gold & Shop: pick a student, Withdraw or Add.
//
// Two rules on it carry money, so they are held here as well as in the
// browser journeys (debug-tools/gold-journeys.mjs):
//
//   * the big button's sentence is the confirmation, so it must never say
//     something that is not about to happen - and it must refuse to take a
//     child below zero before the database has to;
//   * a tapped shop item stays attached only while its price and name are the
//     ones tapped. Edit either and the withdrawal is custom, or a "Snack"
//     would be logged at a price nobody charged.
//
// Run: node tests/gold-card.test.js

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}, got ${a}`); }
};

function method(name, indent = '    ') {
  const sig = `\n${indent}${name}(`;
  const start = html.indexOf(sig);
  if (start === -1) throw new Error(name + ' not found');
  const end = html.indexOf(`\n${indent}}\n`, start);
  const body = html.slice(start, end + `\n${indent}}\n`.length).trim();
  return eval(`(function ${body.slice(name.length)})`);
}

const _qgRefreshGo = method('_qgRefreshGo');
const _qgInput = method('_qgInput');
const _qgStudent = method('_qgStudent');

function makeApp(qg, fields = {}) {
  const els = {
    'qg-go': { textContent: '', disabled: false, style: {} },
    'qg-warn': { textContent: '' },
    'qg-amount': { value: fields.amount ?? '' },
    'qg-reason': { value: fields.reason ?? '' },
  };
  global.document = { getElementById: (id) => els[id] || null };
  return {
    els,
    _qg: qg,
    _rtcStudents: [{ id: 'a', first_name: 'Ada', last_name: 'Pell', rtc_balance: 7 }],
    _qgShopItems: [{ id: 'snack', name: 'Snack', price: 3 }],
    _qgRefreshGo, _qgInput, _qgStudent,
  };
}

// ---- the sentence on the button ---------------------------------------
let app = makeApp({ student: 'a', mode: 'take', amount: '3' });
app._qgRefreshGo();
check('withdraw names amount and child', app.els['qg-go'].textContent, 'Withdraw 3 gold from Ada');
check('  and can go', app.els['qg-go'].disabled, false);

app = makeApp({ student: 'a', mode: 'take', amount: '8' });
app._qgRefreshGo();
check('more than she has: refused', app.els['qg-go'].disabled, true);
check('  with the reason in words', app.els['qg-warn'].textContent, 'Ada only has 7 gold.');

app = makeApp({ student: 'a', mode: 'take', amount: '7' });
app._qgRefreshGo();
check('exactly what she has is allowed', app.els['qg-go'].disabled, false);

app = makeApp({ student: 'a', mode: 'add', amount: '8' });
app._qgRefreshGo();
check('adding has no balance ceiling', [app.els['qg-go'].textContent, app.els['qg-go'].disabled], ['Add 8 gold to Ada', false]);

for (const bad of ['', '0', '-2', '2.5', 'abc']) {
  app = makeApp({ student: 'a', mode: 'add', amount: bad });
  app._qgRefreshGo();
  check(`"${bad}" is not an amount`, [app.els['qg-go'].textContent, app.els['qg-go'].disabled], ['Add gold', true]);
}

app = makeApp({ student: 'a', mode: 'add', amount: '2' });
app._qgBusy = true;
app._qgRefreshGo();
check('busy: stays disabled so a second tap cannot pay twice', app.els['qg-go'].disabled, true);

// ---- a tapped item detaches when edited -------------------------------
app = makeApp({ student: 'a', mode: 'take', item: 'snack' }, { amount: '3', reason: 'Snack' });
app._qgInput();
check('untouched item stays attached', app._qg.item, 'snack');

app = makeApp({ student: 'a', mode: 'take', item: 'snack' }, { amount: '4', reason: 'Snack' });
app._qgInput();
check('new price: now custom', app._qg.item, null);

app = makeApp({ student: 'a', mode: 'take', item: 'snack' }, { amount: '3', reason: 'Two snacks' });
app._qgInput();
check('new name: now custom', app._qg.item, null);

console.log(`gold-card: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
