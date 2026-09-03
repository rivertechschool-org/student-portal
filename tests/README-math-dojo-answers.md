# Math Dojo answer-checker tests

Four suites over `AnswerInterpreter`, the thing that decides whether a student
got it right. Run them after any change to how answers are read.

    # extract the interpreter from the page, then run each suite
    python - <<'PY'
    import re, io
    h = io.open('games/math-dojo.html', encoding='utf-8').read()
    m = re.search(r'const AnswerInterpreter = \{.*?\n\};', h, re.S)
    io.open('tests/ai.js', 'w', encoding='utf-8').write(m.group(0) + '\nmodule.exports=AnswerInterpreter;')
    PY
    cd tests && node math-dojo-answers.formats.js

(The suites `require('./ai.js')`, so extract first.)

| Suite | What it protects |
|---|---|
| `formats` | the forms a student types: superscripts, x/×/* multiplication, commas, words |
| `notation` | notation the QUESTION prints and the student copies back |
| `regression` | every other answer type - algebra, fractions, pi, radicals, coordinates |
| `mustfail` | **wrong answers still failing** |

`mustfail` is the one that matters most. Every fix here loosens the checker, and
a checker that accepts everything is worse than one that is slightly strict -
it tells a student they are right when they are not. Any new leniency needs a
matching entry there.
