# Player-scoped observation schema

The adapter now intercepts Forge immediately before a selected player makes a
normal priority decision. It writes schema v1 JSON for the future local API,
tabletop UI, replay system, and cEDH agents.

The machine-readable contract is `schemas/observation-v1.schema.json`. A real
capture from Ral's turn-one first main phase is stored as
`examples/priority-observation-v1.json`.

## Information boundary

- The viewer receives the identities of cards in their own hand.
- Opponent hands expose a count but no card objects.
- Every library exposes a count but no identities or order.
- Battlefield, graveyard, command, and face-up exile cards use Forge's own
  viewer-visibility checks.
- A face-down card that the viewer may not look at has only an opaque hidden
  object id; its name is `null`.
- Public commanders and their cast counts are included.

This is intentionally stricter than the final model: it does not yet preserve
legally learned information after a revealed card returns to a hidden zone,
and it does not expose a library card that a temporary effect allows the
viewer to inspect. A separate knowledge ledger must add those facts without
ever consulting the authoritative hidden state.

## Action boundary

`PASS_PRIORITY` and rule-valid `PLAY_LAND` entries are executable. The adapter
also uses a reusable expander to emit fully specified `CAST_SPELL` actions for
its supported simple-spell boundary. Other entries in action-enumeration v1 are
timing-and-zone-valid candidate abilities returned by Forge. They are
explicitly marked `executable: false` until the adapter expands and validates:

- mana and non-mana costs;
- optional and alternative costs;
- modes and repeat counts;
- legal targets;
- X values, divisions, and ordered choices; and
- special actions.

This distinction is necessary because Forge may return a spell as playable at
the current timing even when its targets or payment are not yet viable. The
turn-one example includes Sink into Stupor and Lava Dart as candidates while
Ral has no mana source in play; neither is represented as an executable action.

The controlled Lava Dart fixture demonstrates general expansion. With an
untapped Mountain and Great Furnace, the expander emits eight actions: every
combination of four legal player targets and two legal red sources. Each action
has a unique stable id, one target, one payment source, and the exact mana
ability id. `actionContext` identifies the selected seat-2/Mountain action.
Once cast, the public stack item records Forge's actual targets and actual paid
mana, so a validator can reject a plan that the engine executed differently.

Simple-spell expansion version 1 supports:

- a fixed effective cost made from W/U/B/R/G/C and generic mana;
- Forge's test-mode cost adjustment before plans are generated;
- exactly one legal player target;
- an initially empty mana pool;
- distinct battlefield sources whose supported tap ability produces exactly
  one mana; and
- a maximum of 512 emitted actions per decision.

It deliberately leaves hybrid, phyrexian, snow, X, alternate non-mana costs,
multiple targets, card/spell targets, floating mana, sacrifice sources, and
multi-mana abilities as non-executable candidates for later expanders.

## Reproducibility result

Two fresh JVMs captured seat 1's first main phase with seed `20260812`. Their
JSON files were
byte-for-byte identical (SHA-256
`8cc42b701cbfc7a5c1de6274c20ced8d2e1ccff48491e0e2139500bdc54bff8e`).
Both reached Ral's turn-one first main phase with an empty stack and produced
the same seven-card hand and eleven action entries, including pass and two
executable MDFC land faces.

The adapter then selected the executable `PLAY_LAND` action for Sink into
Stupor. Forge moved the same card object from hand to battlefield as tapped
Soporific Springs, reduced hand size from seven to six, consumed both available
land actions, and returned priority to Ral in the same phase. Two fresh JVMs
produced byte-identical before and after observations. Those captures are
stored as `examples/land-action-before-v1.json` and
`examples/land-action-after-v1.json`.

The next probe cast Mox Amber from that opening hand. The three observations
prove that the same card object left the hand, appeared as one public spell on
the stack, survived a complete pass cycle by all four seats, resolved onto the
battlefield, and returned priority to active player Ral. A second fresh JVM
reproduced all three files byte-for-byte. They are stored as
`examples/spell-action-before-v1.json`,
`examples/spell-action-stack-v1.json`, and
`examples/spell-action-resolved-v1.json`.

The latest probe uses a controlled legal state: the deterministic opening hand
contains Lava Dart, and the fixture moves the same deck's Mountain and Great
Furnace from its library to the battlefield after mulligans. The expander
generates all eight legal player/payment combinations, then selects Blue Farm
(seat 2) and Mountain. The executor activates the chosen mana ability itself;
the stack receipt proves Mountain supplied the red mana while Great Furnace
remained untapped. Lava Dart moves from hand to stack to graveyard, Blue Farm
moves from 40 to 39 life, and priority returns to Ral in the same first main
phase. Two fresh JVMs produced byte-identical before, stack, and resolved
captures. They are stored as
`examples/targeted-spell-before-v1.json`,
`examples/targeted-spell-stack-v1.json`, and
`examples/targeted-spell-resolved-v1.json`.

This proves automatic player-target and simple payment enumeration plus exact
execution for one representative spell. Permanent targets, modes, alternate
costs, floating mana, sacrifice/multi-mana sources, and multi-target division
remain separate engineering steps.

Run the probe with:

```powershell
npm run observe -- `
  --forge-root C:\path\to\extracted-forge `
  --seed 20260812 `
  --seat 1
```

Run the first executable action probe with:

```powershell
npm run probe:land -- `
  --forge-root C:\path\to\extracted-forge `
  --seed 20260812 `
  --seat 1
```

Run the first stack and resolution probe with:

```powershell
npm run probe:spell -- `
  --forge-root C:\path\to\extracted-forge `
  --seed 20260812 `
  --seat 1
```

Run the explicit payment-and-target probe with:

```powershell
npm run probe:targeted -- `
  --forge-root C:\path\to\extracted-forge `
  --seed 20260812 `
  --seat 1
```
