// The Math Dojo content audit, as a pass/fail gate.
//
// Runs tools/dojo-lesson-audit.js, which executes every question generator 300
// times and every lesson 25 times under a seeded PRNG, checking that answers
// appear among their options, options are distinct, no template value leaks
// into student-visible text, and single-operation arithmetic in questions and
// guided steps is actually true.
//
// It exists because two content bugs shipped that no static check could see:
// a guided walkthrough whose generated numbers contradicted the problem it
// posed, and option lists whose distractor formulas coincide with the answer
// for particular draws (a+b = a*b when both are 2). Both classes only exist at
// runtime, in the relationship between generated values.
//
// Run: node tests/dojo-content.test.js

const { execFileSync } = require('child_process');
const path = require('path');

const tool = path.join(__dirname, '..', 'tools', 'dojo-lesson-audit.js');

try {
  const out = execFileSync('node', [tool], { encoding: 'utf8', timeout: 300000 });
  const m = out.match(/(\d+) unique findings/);
  console.log(`  dojo content audit: ${m ? m[1] : '?'} findings`);
  if (!m || m[1] !== '0') {
    console.log(out);
    process.exit(1);
  }
  console.log('  all generators and lessons consistent');
} catch (e) {
  console.log('  FAIL — audit reported findings or crashed:');
  console.log(String(e.stdout || e.message).slice(0, 4000));
  process.exit(1);
}
