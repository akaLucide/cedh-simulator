# Forge feasibility audit

Audited upstream commit: `a26411650589d438d0478768e7e948101a5797eb`

## Confirmed useful entry points

- `forge.view.SimulateMatch` already accepts multiple deck files, Commander
  format, a game count, RNG seed, per-game timeout, and AI profiles.
- `RegisteredPlayer.forCommander` configures commanders and 40 starting life.
- `Match` creates and runs a game from an arbitrary list of registered players.
- `GameSnapshot` and the AI-side `GameCopier` provide starting points for undo
  and forward search.
- `PlayerControllerAi` and `AiController` contain the existing choice and
  heuristic layers that deck-specific agents can replace incrementally.

## Card-script coverage

| Deck | Exact front-face names found |
| --- | ---: |
| Ral user deck | 99/100 |
| Blue Farm approved opponent | 100/100 |
| Kinnan approved opponent | 100/100 |
| Sisay approved opponent | 100/100 |

The Ral miss is `_____ Goblin`. Forge has `"Name Sticker" Goblin`, the digital
substitute with a d20 mana table. It does not implement the paper game's random
selection of three sticker sheets or the vowel count of the chosen name
sticker. The user approved the digital substitute for the initial simulator on
2026-08-12.

Name coverage is not proof of complete rules correctness. The high-risk Ral
mechanics are listed as explicit scenarios in `acceptance-tests.md`.

## Gaps that block a trustworthy cEDH agent

### Legal-action enumeration

`AvailableActions` is a yes/no/highlight heuristic, not a complete action API.
It scans hand, battlefield, and Forge's flashback zone, ignores mana abilities,
and does not enumerate choices. A cEDH adapter also needs command-zone casts,
temporary exile play permissions, special actions, every mana ability, modes,
alternative/additional costs, targets, divisions, X values, and ordered
choices.

### Multiplayer search

The experimental evaluator contains an explicit “more than two players” TODO
and scores mostly life, cards, mana, and battlefield material. Those signals
are insufficient for protected wins, priority burden, tutor access, storm,
graveyard fuel, or an opponent presenting a deterministic combo.

### Hidden information

The AI game copier currently has hidden-information pruning disabled. It cannot
be used for adversarial search until each simulated player receives a legal
information set rather than the authoritative game state.

### Undo and deterministic replay

`GameSnapshot` contains an explicit TODO for per-turn cast history, which is
directly relevant to storm and Ral's loyalty. Global RNG state and agent memory
also require checkpointing. Upstream snapshot support is therefore a useful
starting point, but it is not yet the requested takeback feature.

## Integration-spike conclusion

The quickest proof is not a new rules engine. It is a four-AI Commander run
through Forge's existing simulation CLI using converted `.dck` files. The
three opponent lists and digital sticker policy are now approved, so the
baseline script can run that pod with a fixed seed. The output establishes
which games finish and which choices/card interactions fail before a UI or
learned model obscures the source of errors.

That proof has now completed. Seed `20260812` finished with Blue Farm winning
on turn 19. A subsequent multi-game process exposed two stock-simulation
failures: Forge's timeout path produced an invalid multiplayer outcome, and a
later game recursively cycled through mana-ritual, modal-choice, spell-copy,
and playability evaluation until `StackOverflowError`. The baseline harness
therefore starts a separate JVM per seed and classifies timeouts outside
Forge. See `baseline-results.md` for the measured results and next gate.
