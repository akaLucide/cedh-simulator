# Architecture checkpoint

## Components

1. **Forge rules runtime (Java 17)**
   Owns zones, turn structure, the stack, priority, costs, targets, replacement
   effects, triggers, state-based actions, and card scripts.
2. **Game adapter (Java)**
   Converts a Forge game state into a stable observation model and exposes only
   legal actions. It also owns seeded replay, snapshots, undo, and hidden-info
   redaction.
3. **cEDH agent service**
   Begins with deck profiles plus tactical search. Later versions can combine
   the profiles with a trained policy/value model. Each opponent receives its
   own legally observable view of the game.
4. **Local API**
   Streams public state, the human player's private state, prompts, priority,
   and the action log between Java and the UI.
5. **React tabletop UI**
   Runs on localhost and presents three compact opposing boards, the human
   battlefield/hand, stack, phase/priority controls, log, and undo.
6. **SQLite results store**
   Stores seeds, deck versions, seats, mulligans, actions, outcomes, timing,
   and post-game decision explanations.
7. **Process-isolated compatibility harness**
   Runs each stock-AI baseline game in a fresh JVM and records completed,
   draw, timeout, or engine-error status as JSON. Forge's own multiplayer
   timeout result is not trusted.

## Required engineering corrections to upstream Forge

- Multiplayer evaluation: Forge's experimental search evaluator currently has
  explicit two-player assumptions.
- Information safety: copied/search states must redact unknown hands and hidden
  library order before an agent evaluates them.
- cEDH objectives: life totals and battlefield material alone do not capture
  storm count, tutor access, protected win attempts, interaction density,
  commander engines, or which player is forced to act.
- Undo: restore the complete deterministic state, including RNG, revealed
  information, triggers, choices, and agent memory.
- Sticker behavior: use Forge's digital `"Name Sticker" Goblin` substitute for
  the initial simulator. The user explicitly approved this simpler behavior;
  record the substitution in every affected replay and result.

## Build order

1. ~~Load one four-player Commander game and complete it headlessly.~~
2. ~~Export a redacted state and enumerate action candidates at a priority
   window.~~
3. ~~Execute and deterministically replay pass and land-play actions.~~
4. ~~Cast, pass around, resolve, and deterministically replay a choice-free
   zero-mana spell.~~
5. Expand spell and activated-ability candidates into complete legal actions.
   Simple fixed-cost spells with one player target and one-mana tap sources now
   enumerate automatically; other casting choices and activated abilities
   remain.
6. ~~Execute one spell with mana payment, targets, and a resulting stack
   entry.~~
7. Pass the Ral rules scenarios.
8. Add baseline profiles for the three approved opponent lists.
9. Expose the adapter through a local API and build the tabletop UI.
10. Add multiplayer search, then learned policy/value guidance.
