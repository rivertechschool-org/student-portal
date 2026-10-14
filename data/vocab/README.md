# Word Lab word bank

The words behind English Lyceum's **Word Lab**: one file per grade, `grade-K.json` to
`grade-12.json`. The game fetches them; nothing else reads them.

Every definition, example sentence and respelling here was written for RiverTech. None of
it is copied from a dictionary. Pronunciations in IPA (`ipa`) are derived from the CMU
Pronouncing Dictionary (BSD licence, see `LICENSE-cmudict.txt`) by `add-ipa.js`.

## Shape

```json
{
  "grade": "3",
  "words": [
    {
      "w": "enormous",
      "pos": "adjective",
      "def": "very, very big",
      "ex": "An enormous whale swam right under our boat.",
      "syn": ["huge", "giant"],
      "say": "ih-NOR-mus",
      "ipa": "ɪˈnɔɹməs"
    }
  ]
}
```

| field | rule |
| --- | --- |
| `w` | the headword, lowercase unless it is always capitalised. One word (a hyphen is fine, no spaces). |
| `pos` | one of `noun`, `verb`, `adjective`, `adverb`, `pronoun`, `preposition`, `conjunction`, `interjection`, `determiner`. The sense the definition and example use. |
| `def` | a definition a child at that grade understands. Does not contain the headword or an obvious form of it. No full stop at the end. |
| `ex` | one sentence using the headword **exactly as written in `w`**, as a whole word, in the same sense and part of speech as `def`. Ends with `.`, `!` or `?`. Child-appropriate, no real people or brands. |
| `syn` | 0–3 synonyms (single words) a child that age knows. Never the headword. Empty `[]` when there is no good one. |
| `say` | a respelling for reading aloud: syllables joined by hyphens, the stressed one in CAPITALS (`ih-NOR-mus`, `KAT`). |
| `ipa` | added by the tool; do not write it by hand. |

Words are ordered **easiest first** within a grade. The game splits each grade into levels
of 12 in that order, so the order is the progression.

A word appears in one grade only: the lowest grade where it belongs.

Run `node data/vocab/validate.js` after any edit.
