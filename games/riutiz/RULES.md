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
- **Opening hands:** 7 cards; the second player starts with **8**, and the
  first player draws on turn 1 as normal. Measured over AI-vs-AI games with
  the starter decks: the first player skipping their draw won seat 1 43% of
  games, drawing normally 59%, this 50%.
- **Main phase:** one resource per turn; any number of pupils, Tools and
  Locations; **one Interruption per turn** (each player, each turn).
- **Combat:** once per turn, and it ends your main phase.
- **Blocking (changed 2026-09-26):** several pupils may block one attacker; each
  pupil blocks one. The attacker rolls once and its damage reaches the blockers in
  the order they were assigned - enough to exhaust each (1 each if it is Lethal),
  the rest to the last, or with Overwhelm the rest is scored. Every blocker rolls and
  hits the attacker. First-strikers on either side go first.
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
| Workbook | Search your deck for "I got a Page!" | As printed. |
| **I got a Page!** (new, id 263) | — | Added 2026-09-26 as the card Workbook finds: Interruption, (2), "Put a +1/+1 counter on target pupil you control. Draw a card." The effect was chosen here; the card library spreadsheet has no row for it yet. |
| Prime Numbers | Cannot be blocked by more than one pupil | As printed, now that several pupils can block. |
| Library | Pupils with Attack Die 3 or greater cannot attack | A d6 or larger cannot attack. |
| Shy kid | Opponent's attack rolls -1 until end of turn | Lasts through the opponent's next turn (on your own turn it would do nothing). |
| Proof of Concept | Refute target Interruption | Arms you: the opponent's next Interruption before your next turn is refuted. |
| Chemistry Enthusiast | Counter target ability | Arms you: the opponent's next activated ability is countered. |
| Electronics Enthusiast | Prevent a pupil from entering | Arms you: the next pupil the opponent plays goes back to their hand. |
| Reinforcement | Play an additional support card | You may play one extra resource this turn. |
| Tetrix | Pay (3): coin, heads the opponent skips a turn | Once per turn. |
| Gold Coin | Send home, gain a resource of any colour | The resource arrives **spent**. Ready, it paid for the Coin's own replay: an endless free resource. |
| Pen | Spend, send home: draw 2 | Cost raised from (1) to **(2)** on 2026-09-26: at (1) it replayed for 2 cards as long as you had resources. |
| Receptionist | Protection from a colour | Lasts until your next turn. |
| Server Room | "the active player may draw" | Asks; the AI says yes while its deck has 4+ cards. |

## The AI

Three difficulties, chosen on the menu (default Normal):
Easy plays a random card at a random target and blocks at random; Normal looks
ahead at part of its options with fuzzed judgement; Hard looks at everything,
gang-blocks and uses combat tricks. In tests Hard beat Easy 12/12, Normal beat
Easy 12/12, Hard beat Normal 9/12. Balance is measured Hard against Hard.

## Still open

- Multiplayer spectating remains a stub, and card rewards are never granted.
- No card art exists.
