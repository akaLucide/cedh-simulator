# First four-player baseline results

Date: 2026-08-12

Forge package: `2.0.15-SNAPSHOT-08.12`, build `2026-08-12 18:25:41`

Pod, in seat order:

1. Ral, Monsoon Mage
2. Blue Farm — Kraum, Ludevic's Opus / Tymna the Weaver
3. Kinnan, Bonder Prodigy
4. Sisay, Weatherlight Captain

## Completed compatibility run

Seed `20260812` loaded all four exact 100-card lists and completed without a
rules-engine crash. Blue Farm won on turn 19 after the other three players
reached zero life. The process-isolated replay measured 38,547 ms of engine
game time and 43,749 ms wall time.

This is a feasibility result, not an AI-strength result. A turn-19 combat/life
total finish shows that stock Forge AI does not pilot these lists like cEDH
decks, but the engine can load the approved pod and advance a complete
multiplayer Commander game.

## Failures found by the original multi-game run

- The first game of the batch reached turn 18 and Forge's internal 180-second
  timeout. Forge then printed all four players as winners and awarded a match
  win to Ral. That result is invalid and must not enter matchup statistics.
- After the timeout, the same JVM continued into another game and raised
  `StackOverflowError`. The repeating path ran through mana-ritual evaluation,
  modal-choice evaluation, spell-copy evaluation, and back into playability.
  `Flare of Duplication` and `Twincast` target failures appeared near the
  recursion.
- The original batch was stopped after those two failures; there is no result
  for its requested third game.

## Harness correction

`scripts/run-forge-baseline.mjs` now starts one Java process per game, derives
one reproducible seed per process, applies a hard external timeout, and records
`completed`, `draw`, `timeout`, or `engine-error` in JSON. A two-game,
one-second smoke test recorded two independent timeouts and started the second
game normally, confirming that timed-out game state no longer leaks forward.

## Adapter progress after the baseline

The adapter now exports a legally redacted priority observation, executes and
replays a land action, casts and resolves a choice-free spell through the
four-seat pass cycle, and automatically expands a targeted one-red-mana Lava
Dart into eight complete target/payment actions. The executor honors the
selected source, and the latest stack receipt preserves the exact target and
actual mana source.

The next engineering gate is to widen legal-action expansion to card targets,
floating mana, sacrifice and multi-mana sources, followed by modal and
multi-target spells. In parallel, the AI boundary still needs a recursion guard
and explicit unsupported-choice reporting so stock heuristics can be replaced
deck-by-deck without silently passing or crashing.
