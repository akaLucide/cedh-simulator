# cEDH Simulator

This repository is the feasibility and implementation workspace for a local,
four-player Commander simulator: one human pilot and three computer opponents.
Forge supplies the Magic rules engine; this project will add a cEDH-focused
state/action adapter, deck-specific agents, deterministic replays, post-game
analysis, and a browser-based tabletop UI.

## Current checkpoint

- The supplied Ral deck contains exactly 100 cards.
- 99 names have native scripts in Forge commit `a2641165`.
- `_____ Goblin` is mapped to Forge's MTGO-style `"Name Sticker" Goblin`. The
  user approved the simpler digital behavior for the initial simulator.
- The exact Blue Farm, Kinnan, and Sisay tournament lists are approved and
  enabled as the first opponent pool.
- All four decks load with 100/100 engine-recognized card names in the
  2026-08-12 Forge snapshot.
- A seeded four-player game completed headlessly: Blue Farm won on turn 19.
- Repeated games now run in isolated Java processes and write JSON results, so
  an AI crash or timeout cannot corrupt the next game.
- A real turn-one Ral priority window now exports deterministic, player-scoped
  JSON without exposing opponent hand or library identities.
- The adapter executes and deterministically replays its first non-pass action:
  Sink into Stupor's MDFC land face enters tapped as Soporific Springs.
- It also casts Mox Amber, exposes the stack priority window, completes the
  four-seat pass cycle, resolves it, and returns priority to Ral.
- A controlled Lava Dart probe now represents the exact target and mana-source
  choices, verifies the actual payment on the stack, resolves one damage to
  Blue Farm, and deterministically replays all three observations.
- The Lava Dart plan is no longer handwritten. A reusable simple-spell
  expander emits all eight legal player-target/payment combinations from four
  targetable seats and two red sources (Mountain and Great Furnace), then the
  executor activates the exact selected source before casting.
- The initial rules and AI acceptance criteria live in
  `docs/acceptance-tests.md`.

## Intended first pod

Human: Ral, Monsoon Mage

Initial opponents:

1. Kraum, Ludevic's Opus / Tymna the Weaver (Blue Farm)
2. Kinnan, Bonder Prodigy
3. Sisay, Weatherlight Captain

These cover stack-heavy midrange, mana-engine combo, and tutor-driven
permanent engines. Rograkh / Silas Renn is the leading fourth opponent after
the first pod is stable, subject to separate list approval.

The accepted card-name override is stored in `decks/card-overrides.json`, so
the rules difference is visible in imports, replays, and results.

## Running the compatibility baseline

With Node 20+, a Java 17+ JDK, and an extracted Forge desktop snapshot:

```powershell
.\scripts\Invoke-ForgeBaseline.ps1 `
  -ForgeRoot C:\path\to\forge `
  -Games 3 `
  -Seed 20260812 `
  -TimeoutSeconds 180
```

Each seed runs in a fresh JVM. The cross-platform command is `npm run
simulate -- --forge-root <path> --games 3 --seed 20260812 --timeout 180
--headless --quiet`. Results are written to `build/baseline-results.json`.
The first findings and their implications are recorded in
`docs/baseline-results.md`.

To capture the adapter's current priority-window observation:

```powershell
npm run observe -- `
  --forge-root C:\path\to\forge `
  --seed 20260812 `
  --seat 1
```

The contract and current action-enumeration boundary are explained in
`docs/observation-schema.md`.

To run the first complete payment-and-target action:

```powershell
npm run probe:targeted -- `
  --forge-root C:\path\to\forge `
  --seed 20260812
```

The default targeted probe builds a controlled state containing Mountain and
Great Furnace. Both payments appear as separate executable actions for every
legal player target, while the scripted selection chooses Mountain and Blue
Farm so the stack receipt can verify exact execution.

## Project boundary

No language model will decide live game actions. The live agent must be local,
deterministic when seeded, fast enough to respond at every priority window,
and unable to inspect hidden information it has not legally observed. Learned
policy/value models may be added after the rules adapter and scripted strategy
profiles are trustworthy.
