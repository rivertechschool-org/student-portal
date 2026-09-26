# RIUTIZ — rules as implemented

The rules players read are the **How to Play** panel in `games/riutiz.html`.
This file records the decisions behind them, and every place a card's printed
text was unclear and had to be read one way. Each ruling is implemented in
`RiutizGame.js` (rules) or `RiutizCards.js` (the card, marked "Ruling:").
Change a ruling there and here together.

Tests: `tests/riutiz-rules.test.js` (the rules, one situation at a time),
`tests/riutiz-cards.test.js` (every card does something),
`tests/riutiz-engine.test.js` (whole games finish and stay sound).

## Decided 2026-09-26

| Question | Ruling |
| --- | --- |
| What does an unblocked pupil score? | **Its roll.** AD is retired: a third of pupils had none and the rest disagreed with their dice. |
| Does a blocker roll back? | **Yes.** Each deals its roll to the other. |
| Empty deck when drawing? | **The game ends.** Higher score wins; on a tie, the player who ran out loses. |
| Starter decks? | **A mix of card types**, so a new player meets every one. |

## Core rules

- **Turn:** Ready (untap, then start-of-turn effects), Draw, Main, Combat, End.
  The first player does not draw on turn 1.
- **Main phase:** one resource per turn; any number of pupils, Tools and
  Locations; **one Interruption per turn** (each player, each turn).
- **Combat:** once per turn, and it ends your main phase.
- **Blocking:** one blocker per attacker, one attacker per blocker.
- **Combat Interruptions:** Flash Point, Time Out, Calculated Risk, Structural
  Analysis and Second Opinion can be played during combat — by the defender
  while blocking, too. Everything else is main phase only.
- **Locations** are free and shared: one in play at a time, and a new one
  replaces it whoever played it.
- **Damage** persists until healed. Order: protection, prevent-all, flat
  reduction, prevention pools, then a shield counter absorbs the whole hit.
- **Lethal** works attacking and blocking. **Stubborn** stops at 1 against
  any damage, Lethal included.
- **Rebuttal** fires when the pupil takes damage *while blocking*.
- **Relentless** can attack while spent; attacking still spends it.
- **Non-Sequitur:** each roll flips a coin — heads doubles it, tails is 0.
  (The old help text described it only as "a random coin-flip effect".)
- **Closed-Minded:** ignores its own side's buffs (targeted and auras) and
  cannot gain keywords; the opponent's effects still apply.
- **Precision:** the opponent's effects cannot change its rolls.
- **"(adv)"** dice: roll them all, keep the highest.
- **Second Opinion / Statistics Enthusiast rerolls** are used automatically on
  the first roll where they help (below average for you, above average for the
  opponent). There is no "stop and ask" during combat.

## Card rulings

| Card | Printed text | Implemented as |
| --- | --- | --- |
| Grease Monkey | Add a resource of your choice to your hand | Return one of your resources to your hand. |
| Recruiter | Search for resources equivalent to a pupil's cost | Search your deck for a card with the same cost as a pupil in play. |
| The Journeyman, Jerome | "When [it] attacks…" — but both are Grounded | Fires **when you attack**, since they never can. |
| Amorphus | Search for support item cards equal to this turn's attack die roll | Roll a d4; put that many cards from the top of your deck into play as spent resources. |
| Oil Spill | +D1/+E1 on Mechanics | "Mechanics" are Worker, Tinker and Labor pupils. |
| Trigonometry Teacher | Protection from Arts | Protection from **Purple**. |
| Trigonometry Enthusiast | All damage taken is redirected to any target | Back to the pupil that dealt it; otherwise to the opponent's pupil with the least Endurance. |
| "Support", "Support bonus" | — | The card's **played-as-a-resource** ability. |
| Teacher's Assistant, The Reformer | Support: Add (2) | As a resource, makes two colourless. |
| Social Networking Instructor | (S)(S): discard, then draw | (S) is Spend. |
| Workbook | Search for "I got a Page!" | No such card exists. **Look at the top 2, keep one.** Needs a real card or new text. |
| Prime Numbers | Cannot be blocked by more than one pupil | Meaningless with one blocker per attacker, so: **can only be blocked by a pupil whose Endurance is a prime number.** Needs new text. |
| Library | Pupils with Attack Die 3 or greater cannot attack | A d6 or larger cannot attack. |
| Shy kid | Opponent's attack rolls -1 until end of turn | Lasts through the opponent's next turn (on your own turn it would do nothing). |
| Proof of Concept | Refute target Interruption | Arms you: the opponent's next Interruption before your next turn is refuted. |
| Chemistry Enthusiast | Counter target ability | Arms you: the opponent's next activated ability is countered. |
| Electronics Enthusiast | Prevent a pupil from entering | Arms you: the next pupil the opponent plays goes back to their hand. |
| Reinforcement | Play an additional support card | You may play one extra resource this turn. |
| Tetrix | Pay (3): coin, heads the opponent skips a turn | Once per turn. |
| Receptionist | Protection from a colour | Lasts until your next turn. |
| Server Room | "the active player may draw" | Asks; the AI says yes while its deck has 4+ cards. |

## Still open

- **Workbook** and **Prime Numbers** need a design decision (see above).
- Multiplayer spectating remains a stub, and card rewards are never granted.
