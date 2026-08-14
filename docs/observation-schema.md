# Player-scoped observation schema

The adapter now intercepts Forge immediately before a selected player makes a
normal priority decision. It writes schema v1 JSON for the future local API,
tabletop UI, replay system, and cEDH agents.

The machine-readable contract is `schemas/observation-v1.schema.json`. A real
capture from Ral's turn-one first main phase is stored as
`examples/priority-observation-v1.json`.

> **Contract version note.** v2 is being introduced. See
> "v1 to v2 contract change" at the end of this document for what changes, what
> stays frozen, and which parts are not yet verified.

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
has one target, one payment source, the exact mana ability id, and an id that is
unique **within that observation**. `actionContext` identifies the selected
seat-2/Mountain action.
Once cast, the public stack item records Forge's actual targets and actual paid
mana, so a validator can reject a plan that the engine executed differently.

Those ids are **not stable across runs**, and nothing may key on them. They are
built from Forge object ids, which are assigned by a global counter rather than
derived from game state. Two committed captures show the drift directly:
`examples/land-action-before-v1.json` and `examples/spell-action-before-v1.json`
record the same seed (`20260812`) in the same turn-one first main phase and are
byte-identical apart from two ids — Vexing Bauble's cast is `ability-1289` in
one and `ability-1282` in the other, and Ral's commander cast is `ability-1297`
against `ability-1283`. Uniqueness within one observation is therefore all these
ids provide. Canonical, run-stable identity is deferred to M2, which must also
cover duplicate objects, tokens, copies, and repeated abilities; no replay or
undo system may key on Forge ids.

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

> This paragraph records what v1 did, and the captures are frozen as that
> record. Under v2 the same action is **not** executable: Soporific Springs
> carries an optional three-life payment, which is exactly why it entered
> tapped above without anyone choosing that. See the correction below.

The next probe cast Mox Amber from that opening hand. The three observations
prove that the same card object left the hand, appeared as one public spell on
the stack, survived a complete pass cycle by all four seats, resolved onto the
battlefield, and returned priority to active player Ral. A second fresh JVM
reproduced all three files byte-for-byte. They are stored as
`examples/spell-action-before-v1.json`,
`examples/spell-action-stack-v1.json`, and
`examples/spell-action-resolved-v1.json`.

> As with the land paragraph above, this records what v1 did and the captures
> are frozen as that record. Under v2 the Mox Amber cast is **not** executable:
> it is an unexpanded candidate carrying `UNSUPPORTED_ACTION_EXPANSION`, so the
> probe now refuses it before Forge sees it. Being target-free and zero-cost is
> a structural property, not a proof that every decision is represented.
> `npm run verify:spell-guard` verifies the refusal.

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

Run the executable land-action probe with (Command Tower is staged into hand,
because no land in the natural opening hand is choice-free):

```powershell
npm run probe:land -- `
  --forge-root C:\path\to\extracted-forge `
  --seed 20260812 `
  --seat 1 `
  --repeat 2
```

Audit a staged land without executing it:

```powershell
npm run probe:land:staged-audit -- --forge-root C:\path\to\extracted-forge
```

Verify the two refusal paths. Each underlying probe is *expected* to fail by
throwing `UnrepresentedChoiceException`; the wrapper exits 0 only when all the
expected evidence is present:

```powershell
npm run verify:choice-guard -- --forge-root C:\path\to\extracted-forge
npm run verify:hook-fault  -- --forge-root C:\path\to\extracted-forge
```

Confirm that an unaudited cast is refused rather than executed:

```powershell
npm run verify:spell-guard -- --forge-root C:\path\to\extracted-forge
```

This replaces `probe:spell`, which executed Mox Amber despite the capture it
wrote in the same run publishing that action as non-executable.

Run the explicit payment-and-target probe with:

```powershell
npm run probe:targeted -- `
  --forge-root C:\path\to\extracted-forge `
  --seed 20260812 `
  --seat 1
```

## v1 to v2 contract change

### Why

v1 derived `executable` for a land play from `SpellAbility.isLandAbility()`
alone (`ObservationWriter.java:270-272`), and the Node validator *required*
every `PLAY_LAND` action to be executable with no expansion
(`scripts/lib/observations.mjs:71-74`). Both are wrong.

`examples/priority-observation-v1.json:454-467` marks Shatterskull Smashing's
land play executable. Its land face enters tapped unless the controller pays
3 life. The action records no such decision, so stock `PlayerControllerAi`
answers it silently. The same clause appears on Sea Gate Restoration and
Pinnacle Monk in the same deck, on Steam Vents, and on the opponents' shock
lands.

> **Correction.** Earlier revisions of this document, and the pull request that
> introduced v2, stated that Sink into Stupor was "the only genuinely choice-free
> land face in the Ral list". **That is false.** Verified against the pinned build
> `2.0.15-SNAPSHOT-08.13`, its land face Soporific Springs carries rules
> byte-identical to Shatterskull's:
>
> ```
> R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplaceWith$ DBTap | ReplacementResult$ Updated
> SVar:DBTap:DB$ Tap | ETB$ True | Defined$ Self | UnlessCost$ PayLife<3> | UnlessPayer$ You
> ```
>
> An instrumented probe playing Sink into Stupor reached the same decision hook
> with the same `Pay 3 life` cost, and the land entered tapped with life
> unchanged at 40. Every modal land face in the Ral deck is affected —
> Shatterskull, Soporific Springs, Sea Gate Reborn and Mystic Peak all at three
> life, Steam Vents at two. Because the two cards are indistinguishable in
> Forge's own data, no rule that separates them could be anything but a
> card-name special case, which this project forbids. The consequence is that
> the seed-20260812 opening hand contains **no executable land action at all**,
> and the positive control for an executable land play had to move to a land the
> audit can positively prove clean.

That violates the project's own invariant: an action is executable only when
Forge can receive it without making an unrecorded strategically relevant choice
for the human or agent.

### What v2 changes

Every action carries `unrepresentedChoices`, an array of **structured objects**
(never free-form strings):

| Field | Required | Purpose |
| --- | --- | --- |
| `code` | yes | Names the choice **type**, not a unique instance. |
| `decisionType` | yes | `OPTIONAL_COST`, `MODE`, `TARGET`, `PAYMENT`, `ORDERING`, `VALUE`, `UNKNOWN`. |
| `source` | yes | `{forgeCardId, name, zone}`. `forgeCardId` is debug-only. |
| `description` | yes | Human-readable, for the UI and logs. |
| `timing` | no | `ON_CAST`, `ON_ENTER`, `ON_RESOLVE`, `UNKNOWN`. |
| `optional` | no | Whether declining is legal. |
| `amount` | no | `{unit, value}` — for example three life. |
| `outcomes` | no | Enumeration domain when finite and known. |

`executable` carries no independent information in v2. It is true exactly when
`unrepresentedChoices` is empty. No category, land plays included, may opt out.

Because an empty list now *asserts* completeness, the list is built by starting
non-empty and removing entries only when the adapter can positively prove the
action choice-free — never by starting empty and adding known problems:

| Action family | `unrepresentedChoices` | `executable` |
| --- | --- | --- |
| `PASS_PRIORITY` | empty | true |
| Land play proven choice-free | empty | true |
| Land play with choices | one or more entries | false |
| Unexpanded `CAST_SPELL` candidate | one or more entries | false |
| Unexpanded activated or mana ability | one or more entries | false |
| Adapter-expanded complete cast | empty | true |
| Anything not positively audited | `UNSUPPORTED_ACTION_EXPANSION` | false |

### Limit on expansion until M2

`code` names a type, so two choices of the same kind on one action share it. A
recorded answer therefore cannot be keyed by `code` alone. Until M2 supplies
canonical per-instance choice identity, expansion is only sound for actions
carrying **exactly one** entry; multi-entry actions stay non-executable.

### What stays frozen

- No `examples/*-v1.json` is regenerated, edited, or deleted.
- `schemas/observation-v1.schema.json` is not redefined.
- `observationErrors()` dispatches on `schemaVersion`. The v1 action rules are
  kept as they were when the v1 captures were produced, so those artifacts stay
  verifiable against the contract that created them.
- `test/evidence.test.mjs` pins the SHA-256 of all nine v1 captures and the v1
  schema.

New behaviour goes into `*-v2.json` captures instead.

### Defect found when the schema was first executed

`schemas/observation-v1.schema.json` was referenced only in prose and never
compiled. Wiring it into the tests immediately exposed an inconsistency it
should have caught long ago: `examples/spell-action-stack-v1.json` (the Mox
Amber checkpoint) has a stack item with no `targets` or `payment`, while the v1
schema marks both required for `stackItem`. That capture predates the fields,
which were added for the Lava Dart checkpoint.

Both sides are deliberately frozen, so
`test/schema.test.mjs` records the exact known exception rather than hiding it.
Any change on either side fails the test.

### The decision hook, as proven against the pinned build

Forge routes the optional life payment through exactly one method:

```java
// forge.game.player.PlayerController
public abstract boolean payCostToPreventEffect(
        forge.game.cost.Cost cost,
        forge.game.spellability.SpellAbility sa,
        boolean alreadyPaid,
        forge.util.collect.FCollectionView<forge.game.player.Player> allPayers);
```

The call arrives from `AbilityUtils.handleUnlessCost`, reached from
`Player.playLand` through `GameAction.changeZone` and
`ReplacementHandler.executeReplacement`. `confirmReplacementEffect` and
`confirmPayment` were instrumented at the same time and are never called for
this decision. `npm run verify:hook-fault` reproduces the evidence on demand.

The adapter overrides that method to throw rather than answer. It should be
unreachable — `ActionChoiceAudit` refuses the action first — so reaching it at
all is a bug, and the override makes that bug loud instead of silent.

### How the audit proves a land play choice-free

All of it reads Forge's own data; none of it knows any card name:

1. `SpellAbility.getCardState()` gives the face that will actually enter,
   reporting the land face of a modal double-faced card rather than its front.
2. `CardState.getReplacementEffects()` supplies that face's replacement effects.
3. Effects of mode `Moved` with a `Battlefield` destination are inspected; the
   `ReplaceWith` ability's `UnlessCost` is the optional payment.
4. `AbilityUtils.calculateUnlessCost` resolves it to a `Cost`, whose
   `CostPayLife` part supplies `amount: {unit: "LIFE", value: n}`.
5. A battlefield-entry trigger on the entering face makes the action
   unauditable for now — a trigger may ask its own question — so it becomes
   `UNSUPPORTED_ACTION_EXPANSION` rather than being assumed harmless.
6. A battlefield-entry replacement on any *other* permanent has the same effect.
   `ReplacementHandler.getReplacementList` would answer this precisely, but it
   needs the event parameter map Forge builds *during* the move; approximating
   that map before the move risks under-reporting, which is the one direction
   this audit must never fail in.

### Capture provenance

Every v2 capture carries a required `fixture` object saying how its state was
reached. `{"kind": "natural"}` means ordinary play from the seed. A staged
capture must additionally record `stagedCard`, `sourceZone` and `cliArgument`,
and a natural capture may carry none of them — the schema enforces both
directions.

Staging exists because the seed-20260812 opening hand has no choice-free land,
so proving that an executable land action still works end to end requires
putting one there. **A staged capture is evidence about the adapter, not about a
natural game, and is never same-state comparable with the frozen v1 captures.**

| Capture | Fixture | Shows |
| --- | --- | --- |
| `priority-observation-v2.json` | natural | Both modal land plays non-executable, each with its three-life entry |
| `staged-choice-free-land-before-v2.json` | staged: Command Tower | A land the audit proves clean, marked executable |
| `staged-choice-free-land-after-v2.json` | staged: Command Tower | The same card object on the battlefield, untapped, life unchanged |
| `staged-optional-cost-land-before-v2.json` | staged: Steam Vents | A two-life entry detected and left unexecuted |
| `spell-action-before-v2.json` | natural | An unexpanded cast candidate held non-executable |
| `targeted-spell-before-v2.json` | staged: Mountain, Great Furnace | Eight fully expanded casts, all executable with empty lists |

### Reproducibility in v2: semantic projection, not byte equality

v1 compared captures byte-for-byte. v2 cannot: this document already records
that Forge object ids are debug-only and drift between runs, so byte equality
would fail for reasons the contract calls meaningless.

Instead each capture is produced in two fresh JVMs and validated independently,
then the ordered *bundle* from run 1 is compared with run 2 through
`normalizeCaptureBundle()`. One canonical-id map per namespace (`card`,
`ability`, `stack`) is shared across every capture in a run, so a card keeps one
token across a before/after pair. It rewrites plain field values, both the
hyphenated and the compacted segments of composite action ids
(`cast-card-75-ability-1273-…-pay-card98a274r`), and raw ids Forge embeds in
prose such as a stack description reading `Lava Dart (75) - …`. Names, seats,
life, zones, categories, choices, tapped state, priority, and `targets[].id` —
a player index, not an object id — are never touched.

Ids are **rewritten, not deleted**. Deleting them would also delete the proof
that the card which left hand is the card that reached the battlefield, so a
rewired identity relationship still compares unequal. This is **not** canonical
cross-run identity; that remains M2.
