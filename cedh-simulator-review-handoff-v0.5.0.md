# cEDH Simulator Technical Handoff and Independent Review Brief

**Project checkpoint:** v0.5.0  
**Handoff date:** 2026-08-13  
**Primary development environment:** Windows target; current prototype built and verified in a Linux workspace  
**Companion artifact:** `cedh-simulator-feasibility-v0.1.zip`  

## 1. Purpose of this document

This document gives another LLM or engineer enough context to independently review the current cEDH simulator prototype, challenge its architecture and claims, reproduce the existing evidence, and continue development in a separate working copy.

The intended reviewer should distinguish carefully between:

- behavior demonstrated by a real Forge rules-engine process;
- behavior checked by Node tests against captured observations;
- design decisions and schemas that exist but are not yet integrated into a playable product; and
- long-term ambitions, especially strong cEDH AI and machine learning, that have not yet been implemented.

The user intends to run two development efforts side by side. Do not modify the only copy of the supplied archive. Extract it into a separate directory or repository, record every change, and report both improvements and regressions.

## 2. Executive status

This is a technically grounded feasibility prototype, not yet a game application.

The most important proven result is that a pinned Forge rules engine can load the user's exact 100-card Ral deck plus three manually approved, exact tournament opponent lists, start a four-player Commander game, and finish at least one seeded game without a rules-engine crash. A Java adapter can also expose deterministic, player-scoped observations and execute a small but growing subset of actions through Forge.

At v0.5.0, the adapter has demonstrated:

- four exact 100-card decks recognized by Forge;
- a completed seeded four-player game;
- process isolation for safer batch simulations;
- hidden-information-safe observation JSON for one viewer;
- a land play using Forge's real modal-card state transition;
- a spell cast, four-seat priority pass, and resolution;
- a targeted spell with an exact target and mana source;
- a reusable but deliberately narrow action expander that enumerates all legal combinations for simple spells of the supported form;
- deterministic fresh-process output for the latest targeted-spell probe; and
- 15 passing Node tests around schemas, information boundaries, object continuity, payment receipts, and action expansion.

It does **not** yet provide a UI, human play loop, undo, comprehensive action enumeration, statistics, deck importing, strong AI, learning, post-game explanation, or complete cEDH card coverage. Stock Forge AI is only a feasibility baseline and is not a credible cEDH opponent.

## 3. Product definition agreed with the user

### Primary goals

The local simulator should help the user:

- practice piloting their own cEDH deck;
- learn common opposing decks and their plans;
- test matchups and deck changes; and
- generate matchup statistics.

### Intended product constraints

| Area | Agreed direction |
|---|---|
| Users | Only the user, on their Windows PC |
| Table | One human plus three computer-controlled opponents |
| Rules | Enforce Magic and Commander rules automatically |
| Priority | Offer the user every normal priority window; shortcuts may be added later |
| Initial pool | Eventually about 10–20 common cEDH decks |
| First exact opponents | Blue Farm, Kinnan, and Sisay lists described below |
| Deck selection | Random, weighted by recent tournament popularity |
| Pool governance | The user manually approves every new exact list |
| Human deck input | Moxfield URL, pasted text list, and a saved local deck library |
| AI strength | As strong as technically achievable |
| AI design | Deck strategy profiles plus learned decisions |
| Table talk | Deferred; none initially |
| Explanations | Post-game review only, not live decision narration |
| Practice controls | Undo/takeback support is required |
| Project horizon | Long-term project, potentially more than a year |
| Development split | The LLM builds; the user tests and makes product decisions |
| Hardware | Windows PC with an NVIDIA GPU |
| Ongoing cost | Flexible when a clear benefit is demonstrated |
| Rules engine | Adapting an existing open-source engine is approved; Forge was selected |

### Important AI boundary

A general-purpose hosted LLM should not choose live game actions. Live opponents should be local, seeded, fast, deterministic when requested, and unable to inspect hidden information. Strategy profiles and search should come first; learned policy/value models can be introduced later when the action representation and training data are trustworthy. LLMs can still help author profiles, analyze logs, and produce post-game explanations outside the live rules/action loop.

## 4. Authoritative decks and approval state

Exact lists in the companion archive are authoritative. Do not silently replace them with current online lists. Any new or changed opponent list requires the user's explicit approval.

### Human deck

- **Commander:** Ral, Monsoon Mage / Ral, Leyline Prodigy
- **Archetype:** Izzet turbo/storm
- **List size:** exactly 100 cards
- **File:** `decks/ral-monsoon-mage.txt`
- **SHA-256:** `e71280e0c9692a83a2b943f6005e47f4e64f54f03bab1272c06d88ee531a5e7e`

The source list contains `_____ Goblin`. The user approved the easiest viable implementation. The prototype maps it explicitly to Forge's `"Name Sticker" Goblin`. The override must be recorded in replay and result metadata so a future rules-accurate implementation can be distinguished from this compatibility choice.

### Approved opponent pool

| Deck | Pilot/list label | Event date | Event | Standing | Exact-list source | SHA-256 |
|---|---|---:|---|---:|---|---|
| Kraum, Ludevic's Opus / Tymna the Weaver (Blue Farm) | Matt Hayes, D-Grid | 2026-05-30 | Just Jam D-Grid | 1/200 | [TopDeck list](https://topdeck.gg/deck/d-grid-on-the-stack/z0rVgKt4HGOWE57DB3qolitDrri1) | `02daf0e2882942f737bbfe7442a65a6cf48837cbeab55bead097ebae591e6e6b` |
| Kinnan, Bonder Prodigy | Jason Doan, SIEGE | 2026-06-13 | SIEGE cEDH 10K | 1/308 | [TopDeck list](https://topdeck.gg/deck/level-7s-siege-at-the-castle-10k/10XZGpOw5vVlD7VeYRO1XvBv3Ft2) | `6ccd345e6b68a663bcb5eaaa060d6f88cb7a4b9c7dae81a68ee43a753981449e` |
| Sisay, Weatherlight Captain | Matthew Swaney | 2026-06-27 | The Eldritch Bastion 20K Diamond Event | 1/88 | [TopDeck list](https://topdeck.gg/deck/the-eldritch-bastion-20k-diamond-event/nbgAlOsNvrgyZ7RnFZf3BbercT53) | `1100100cba5257ae698780b6c1a984280440667140683e8e324e62e434375ba8` |

All three were marked approved and enabled on 2026-08-12 in `decks/pool.json`. The configured future selection policy is `weighted_by_recent_tournament_popularity`; that policy is metadata only and is not yet a working list updater or sampler.

Rograkh/Silas was identified as a likely fourth archetype after the first three are stable, but no exact list has been approved.

## 5. Target architecture

The working architecture separates rules correctness from decision quality and presentation:

1. **Forge / Java 17 rules authority** owns legal game state, the stack, priority, continuous effects, costs, targets, Commander rules, randomness, and resolution.
2. **Java game adapter** converts Forge state into player-scoped observations, enumerates and executes explicit actions, and will eventually own snapshots, replay, and undo integration.
3. **cEDH agent service** consumes only authorized observations and explicit legal actions. It will combine deck strategy profiles, tactical search, opponent modeling, and later policy/value models.
4. **Local API** will stream observations, prompts, stack changes, and logs between Java and the UI.
5. **React UI** will run on localhost with four seats, the human hand and board, opponent public zones, stack, priority controls, log, and undo.
6. **SQLite result store** will hold games, deck versions, seeds, decisions, outcomes, and matchup statistics.
7. **Process-isolated simulation harness** will run one game per Java process with a seed and external timeout so a Forge hang or stack overflow cannot poison a long batch.

Forge must remain the sole rules authority. The UI and AI should request actions, never synthesize or mutate authoritative game state directly.

## 6. Implemented checkpoints

### A. Exact-list feasibility and Forge audit

- The Ral list was normalized to exactly 100 entries.
- Ninety-nine cards had native Forge scripts in pinned source commit `a2641165`; the explicit Goblin compatibility mapping produced 100/100 recognized entries.
- The three approved opponent lists were imported and rendered into Forge deck format.
- All four decks loaded 100/100 in the tested Forge snapshot.
- Supporting files include the normalized lists, approval metadata, Forge renderer, audit report, and strategy profiles.

### B. Seeded four-player baseline

- Seat order: Ral, Blue Farm, Kinnan, Sisay.
- Seed: `20260812`.
- The game completed without a rules-engine crash.
- Blue Farm won on turn 19 after the other three players reached zero life.
- Recorded engine time: 38,547 ms.
- Recorded wall time: 43,749 ms.

This proves basic four-deck execution, not the quality or cEDH competence of Forge AI.

### C. Safer batch-process model

An early multi-game attempt exposed two significant Forge baseline failures:

- one game reached an internal 180-second timeout on turn 18, then produced invalid winner reporting and incorrectly credited Ral; and
- continuing in the same JVM later triggered a `StackOverflowError` through ritual, modal, and spell-copy evaluation, including errors around Flare of Duplication and Twincast.

The prototype therefore changed to one Java process per game, a distinct seed per process, an external timeout, and explicit terminal statuses such as `completed`, `draw`, `timeout`, and `engine-error`. Timed-out or engine-error games must never be counted as ordinary wins or losses.

### D. Player-scoped observation schema

The observation writer exports the viewing player's legal private information while reducing other players' hands and all libraries to counts. Face-down objects are opaque. Tests reject observations that leak opponent hand contents or library order.

This is a starting boundary, not a full information-security proof. A persistent knowledge ledger for revealed cards that later move into hidden zones is not yet implemented, and any future search/agent layer must not retain direct references to authoritative Forge objects.

### E. Land action through Forge

The adapter captured and executed playing `Sink into Stupor` as its land face. The same Forge card object moved zones and entered tapped as `Soporific Springs`. The test verifies object continuity rather than treating the front and back faces as unrelated cards.

### F. Stack and priority flow

The `Mox Amber` probe captured the card in hand, cast it through Forge, observed it on the stack, passed priority through all four seats, resolved it, and observed it on the battlefield. This is the first real stack/priority checkpoint.

### G. Controlled target and payment

The `Lava Dart` probe established a deterministic fixture with Lava Dart in Ral's opening hand and Mountain plus Great Furnace available. It generated player-target and mana-source combinations, selected Blue Farm and Mountain, activated Mountain, cast Lava Dart, passed priority, and resolved it.

The captured result verifies:

- Lava Dart moved hand → stack → graveyard;
- Blue Farm moved from 40 to 39 life;
- Mountain was the recorded and actual red source and became tapped;
- Great Furnace remained untapped; and
- priority returned to Ral in the same main phase.

### H. v0.5.0 reusable simple-spell expansion

`SimpleSpellActionExpander` replaced the one-off targeted-spell script with a deliberately bounded enumerator. In the controlled Lava Dart state, it emitted eight executable actions:

$$4\ \text{player targets} \times 2\ \text{red mana sources} = 8\ \text{actions}.$$

The executor consumes the selected target and exact source rather than allowing Forge AI to silently choose a different payment.

## 7. Exact v0.5.0 action-expander boundary

This scope is intentionally narrow. Reviewers should not misread it as general Magic action enumeration.

Currently supported:

- initially empty mana pool;
- a fixed effective cost using Forge's cost-modifier calculation in test mode;
- ordinary colored symbols `W`, `U`, `B`, `R`, `G`, colorless `C`, and generic costs;
- zero or exactly one legal **player** target;
- distinct battlefield mana sources;
- mana abilities whose only activation cost is tapping the source;
- mana abilities that produce exactly one mana;
- stable ordering and a maximum of 512 emitted combinations; and
- execution by preactivating the selected mana abilities and then asking Forge to play the selected spell ability.

Currently rejected or deferred:

- card, spell, permanent, zone-card, or multi-object targets;
- multiple targets and divided values;
- modal choices, optional costs, alternative costs, additional costs, and cost reductions requiring player choice;
- X, hybrid, Phyrexian, snow, and other complex symbols;
- convoke, delve, improvise, affinity-style payment, life payment, sacrifice, discard, exile, and commander-tax planning;
- sources that produce multiple mana, choose colors in more complex ways, require non-tap costs, or depend on conditional restrictions;
- floating mana and plans that combine existing pools with new activations;
- activating mana abilities at the exact rules-engine casting/payment step; and
- deduplication based on strategic equivalence rather than literal source/target choice.

A key nuance is that the executor currently activates chosen mana abilities immediately before initiating the cast. This is legal for the simple Lava Dart case, but it does **not** yet prove correct activation during casting. Lion's Eye Diamond is a critical future scenario because its discard cost and timing make this distinction strategically and rules-relevant.

Action IDs include Forge object identifiers plus choice details. They were byte-identical across two fresh runs of the latest probe, but should not be assumed stable across Forge versions or arbitrary reconstructed game states.

The candidate/incomplete action and expanded executable variants can both appear in an observation. Every consumer must honor `executable` and `requiresChoiceExpansion`; an incomplete candidate must never be presented to the UI or agent as directly executable.

## 8. Verification evidence

### Current automated test result

The latest checkpoint ran **15/15 Node tests successfully**. They cover:

1. front-face card-name normalization;
2. explicit `_____ Goblin` compatibility mapping;
3. rejection of an unapproved deck pool;
4. separate Forge commander-section rendering;
5. acceptance of viewer-only private information;
6. rejection of opponent hand/library leaks;
7. rejection of an unexpanded action marked executable;
8. acceptance of an expanded cast action;
9. rejection of duplicate action IDs and reused simple mana sources;
10. the captured priority observation's information boundary;
11. land-play object continuity;
12. the captured Sink into Stupor transition;
13. hand/stack/battlefield continuity for the spell probe;
14. the captured Mox Amber cast, priority cycle, and resolution; and
15. Lava Dart choice expansion, exact payment source, target, damage, and graveyard result.

These tests validate contracts and captured evidence. They are not an independent implementation of Magic rules. Real Forge probes were used to create the important land, stack, and targeted-spell captures.

### Reproduction commands

From the extracted project root, with Node.js 20+:

```powershell
npm test
npm run build:decks
npm run audit:forge
```

The Forge probes require a compatible local Forge build and Java 17. See the README and Java source for the environment/configuration expected by:

```powershell
npm run probe:land
npm run probe:spell
npm run probe:targeted
npm run simulate:dry
```

> **Addendum — post-Milestone 1, 2026-08-14.** The command list above is
> accurate for v0.5.0 and is left unchanged as part of this historical record.
> Two of these commands have since changed:
>
> - `npm run probe:spell` **no longer exists.** It cast Mox Amber even though the
>   observation written in the same run marked that action non-executable. It is
>   replaced by `npm run verify:spell-guard`, which confirms the cast is refused.
> - `npm run probe:land` now stages a Command Tower, because every modal land
>   face in the Ral deck carries an optional life payment and none is
>   choice-free.
>
> See the current README and `docs/observation-schema.md` for the present
> command surface.

The archive intentionally excludes Forge build outputs and the large Forge runtime.

### Forge version nuance

The reference source tree was pinned to Forge commit:

`a26411650589d438d0478768e7e948101a5797eb`

The original baseline used Forge package `2.0.15-SNAPSHOT-08.12`, build timestamp 2026-08-12 18:25:41. Workspace maintenance later removed that runtime. The v0.5.0 local verification used the official prebuilt desktop snapshot `2.0.15-SNAPSHOT-08.13` because Maven's Java networking could not rebuild the pinned source in the environment. The adapter compiled and ran against that build, and the relevant APIs remained compatible.

This mismatch must be resolved before claiming fully reproducible releases. Prefer a locked source commit plus a reproducible build, or record and distribute a legally permitted exact binary dependency with its checksum.

## 9. Strategy knowledge captured so far

`strategies/profiles.json` contains design-time profiles. They do not yet drive a strong agent.

### Ral, Monsoon Mage

- Primary identity: turbo/storm with graveyard recursion.
- Key plans: Underworld Breach + Lion's Eye Diamond + Brain Freeze; Ral ultimate storm turns; Past in Flames and other graveyard-fueled chains.
- Modeling priorities: storm count, Ral loyalty and transformation, coin flips, graveyard resources, temporary cast permissions, free interaction, exact ritual/mana sequencing, and self-mill safety.

### Blue Farm

- Primary identity: midrange/turbo with strong stack control.
- Key plans: Breach/LED/Brain Freeze assembled through tutors such as Intuition or Gifts Ungiven; Ad Nauseam; Borne Upon a Wind; Final Fortune.
- Modeling priorities: silence windows, free interaction, Rhystic/Remora-style value, card-advantage tempo, threat assessment, and deciding when to pivot between development and a protected win.

### Kinnan

- Primary identity: mana engine, creature combo, and control.
- Key plans: Kinnan plus Basalt Monolith; Hullbreaker Horror and mana-rock loops.
- Modeling priorities: mana-source identity, activations, tutor hits, deterministic/unbounded loop representation, payoff validation, and interaction while holding large mana.

### Sisay

- Primary identity: toolbox/permanent combo with adaptive lines.
- Key plans: Sisay chains involving Derevi, Ioreth, or Emiel; Agatha's Soul Cauldron, Marvin, and Selvala interactions.
- Modeling priorities: five-color access, changing Sisay tutor ranges, untap/copy sequences, permanent-based interaction, Rule of Law constraints, and loop detection.

## 10. Critical rules and acceptance scenarios still required

The project includes broader acceptance-test notes, but these areas deserve early independent scrutiny:

- Commander color identity, singleton construction, commander tax, 40 life, multiplayer mulligans, command-zone replacement, and turn/priority order.
- Ral's generic reduction, transformation trigger and choice, damage/life-loss interaction, planeswalker loyalty on entry, and the `-8` temporary free-cast permission ending at the correct time.
- Storm count including spells cast by every player, copy creation, target selection for copies, and response windows.
- Underworld Breach's printed mana cost plus exile-three additional cost and its exile replacement effect.
- Lion's Eye Diamond as a mana ability, legal timing during casting, and the discard-hand activation cost.
- Past in Flames, Quiet Speculation, Invoke Calamity, Flashback, and other temporary graveyard permissions and exile outcomes.
- Modal double-faced cards in every zone, including front-face deck legality and back-face land play.
- Tavern Scoundrel coin flips and Treasure creation.
- The `_____ Goblin` compatibility override in game, replay, and statistics metadata.
- Full hidden-information behavior through reveals, searches, shuffles, copied game states, and undo.
- Deterministic replay and snapshot restoration including random-number state, triggers, replacement choices, and known information.
- AI mulligans, win recognition, threat assessment, interaction policy, and post-game decision explanations.
- At least 100 stable, isolated games before trusting aggregate matchup statistics.
- Human priority at every normal window, with optional explicit pass-until shortcuts that stop correctly.

## 11. What is not yet built

The following are major missing product components:

- React or other graphical UI;
- local HTTP/WebSocket API;
- an interactive human turn and priority loop;
- undo/takeback and complete snapshots;
- a comprehensive deterministic action log and replay system;
- Moxfield URL import, paste-list workflow, or saved local deck-library UI;
- tournament-popularity retrieval, weighting, and a manual approval interface;
- SQLite result persistence and real matchup-statistics dashboards;
- general action enumeration for all Magic choices;
- combat decisions, trigger ordering, replacement choices, modes, cards/permanents as targets, and multi-target actions;
- deck-specific tactical search;
- strong cEDH opponent policies;
- training pipelines, policy/value models, or other machine learning;
- post-game decision explanation; and
- table talk, intentionally deferred.

## 12. Known risks and technical debt

### Correctness and action representation

The central engineering risk is calling an action “legal and executable” before every relevant choice has been represented. Cost modifiers, targeting restrictions, alternate payments, static effects, timing rules, replacement choices, and conditional mana can all invalidate naïve enumeration.

Recommended invariant: an action is executable only when Forge can receive it without making an unrecorded strategically relevant choice on behalf of the human or agent.

### Exact payment semantics

The adapter must prove that the source recorded in the action is the source actually consumed. Payment receipts should be generated from post-execution authoritative events, not merely copied from the requested plan. Mana activation during casting, especially LED, needs a dedicated design.

### Hidden-information leakage

Observation filtering is only one boundary. Expander, search, evaluation, cache, model features, logs, exception traces, and replay code can leak authoritative objects or hidden card identities. Treat the agent as an untrusted consumer of a serialized, player-scoped view.

### Forge coupling

The adapter currently depends on Forge internals and object IDs that may change across daily snapshots. Establish a narrow compatibility layer and lock versions before expanding the UI or ML work.

### Replay and undo completeness

Restoring visible zones is insufficient. A snapshot/replay design must account for RNG state, pending triggers, replacement-effect decisions, continuous effects, command-zone state, revealed/known information, turn shortcuts, priority, and transient casting/payment state.

### Combinatorial growth

Literal combinations of targets, modes, values, attackers, blockers, and payment sources can explode. The present 512-action cap prevents runaway output but can silently remove important actions unless truncation is explicit. The long-term design needs staged choices, equivalence classes, lazy expansion, or action templates without surrendering exactness.

### Multiplayer assumptions in Forge AI

Stock Forge AI includes assumptions optimized for ordinary or two-player Magic and lacks cEDH objectives. Its decisions should not be used as training labels without careful filtering. The earlier timeout and recursion crash also make process isolation non-negotiable.

### Test-oracle limitations

Captured JSON can become self-consistent with the code that produced it while still being wrong according to Magic rules. Add scenario tests based on authoritative rules text, property tests for invariants, differential checks against Forge state, and manual expert review of pivotal cEDH lines.

### Project hygiene

The supplied checkpoint is archive-based rather than a visible Git history. Initialize version control before parallel implementation. The archive filename still contains `v0.1` to preserve the stable user-facing artifact identity, while the internal package is v0.5.0; avoid confusing the artifact name with the code version.

### Licensing and distribution

Review Forge's license and the licensing/distribution implications of bundling its runtime, card scripts, images, or other assets with a Windows installer. The current project archive excludes Forge itself.

## 13. Recommended next engineering sequence

The safest continuation is to deepen the rules/action seam before building an attractive UI or training an agent.

1. Put the project in Git and make the existing captures/tests a locked baseline.
2. Lock a reproducible Forge source/binary version and add a compatibility/version check at startup.
3. Formalize the action contract as staged choices or templates with explicit completeness and truncation metadata.
4. Add card, spell, and permanent targets, then modal choices and multiple targets.
5. Replace the simple mana planner with a Forge-integrated payment transaction that proves the exact actual payment and handles mana abilities during casting.
6. Implement a player-scoped knowledge ledger and adversarial hidden-information tests.
7. Add an append-only event log and deterministic replay before implementing undo snapshots.
8. Build a minimal local API and text/debug UI that exercises a complete human priority loop.
9. Add a small React table UI only after the observation/action protocol is stable enough to avoid constant rewrites.
10. Implement heuristic, deck-profile-driven agents with tactical search and loop recognition.
11. Generate trustworthy self-play data and evaluation suites before introducing learned policy/value models.
12. Add batch statistics only after terminal-state validation and a substantial stability gate.

The next concrete adapter checkpoint originally planned was support for card/permanent targets and more complex mana sources. A competing implementation may choose a staged-choice action protocol first if it can demonstrate that this reduces combinatorial and correctness risk.

## 14. Independent review questions

Before changing code, the reviewer should answer these questions with file-level evidence:

1. Are any actions labeled executable while Forge still makes an unrecorded strategically relevant choice?
2. Can opponent hand cards, library cards, revealed-then-hidden identities, or authoritative Forge objects reach an agent?
3. Does the payment receipt describe what actually occurred, or only what the adapter requested?
4. Which uses of Forge internals are most likely to break on an upgrade?
5. Is preactivating mana before casting sufficient, and what transaction model is needed for LED and other casting-time mana abilities?
6. Can action enumeration be made complete without materializing an impractical Cartesian product?
7. Which state is missing for deterministic replay and undo?
8. Are the captured tests independent enough to catch a semantically wrong Forge interaction?
9. How should multiplayer threat assessment, priority search, collusion avoidance, and kingmaking be evaluated?
10. What is the smallest end-to-end playable vertical slice that still preserves every normal human priority window?
11. What licensing constraints affect a private Windows build versus redistribution?
12. What measurements should gate progression from heuristics to machine learning?

The reviewer should report findings in three groups: confirmed strengths, correctness blockers, and recommended changes ranked by impact and implementation risk.

## 15. Suggested parallel-work brief for another LLM

Use this prompt together with this handoff and the companion ZIP:

> Review this cEDH simulator prototype as a senior game-engine, AI, and security engineer. First reproduce the documented tests and inspect the Java/Node implementation. Do not assume the README's claims are correct. Identify rules-correctness gaps, hidden-information leaks, nondeterminism, Forge-version coupling, and action-space problems with specific file references. Then propose a short ordered plan. If you implement changes, work in a separate copy or Git branch, preserve the exact approved deck lists, do not substitute live online lists, keep Forge as the sole rules authority, and add tests that demonstrate each improvement against authoritative Forge state. Clearly separate verified behavior from inference and future design.

For a fair side-by-side comparison, ask both implementations to tackle the same bounded next milestone and evaluate them on:

- rules correctness;
- hidden-information safety;
- deterministic reproducibility;
- test quality;
- clarity of the action protocol;
- robustness to Forge version changes;
- performance at multiplayer priority windows; and
- ease of eventual UI and agent integration.

## 16. Project file map

The exact layout may contain additional generated evidence, but the main areas are:

| Path | Purpose |
|---|---|
| `README.md` | Current checkpoint, commands, and status |
| `package.json` | v0.5.0 scripts and Node requirement |
| `decks/` | Exact normalized human/opponent lists and approval pool metadata |
| `scripts/` | Deck normalization/rendering, audit, observation checks, and process harness helpers |
| `spike/src/main/java/cedh/sim/` | Forge adapter, probes, observation writer, action expansion/execution |
| `schema/` | JSON contracts for observations/actions/results |
| `examples/` | Captured before/stack/after observations and action payloads |
| `tests/` | Node contract and captured-evidence tests |
| `docs/architecture.md` | Target architecture |
| `docs/forge-audit.md` | Card-script/engine feasibility audit |
| `docs/baseline-results.md` | Seeded-game and failure evidence |
| `docs/observation-schema.md` | Information and action-contract notes |
| `docs/acceptance-tests.md` | Rules, AI, stability, UI, and deck-specific acceptance backlog |
| `strategies/profiles.json` | Initial strategy plans and modeling priorities |
| `results/` | Process-isolated simulation result examples |

## 17. Artifact integrity

- **Companion archive filename:** `cedh-simulator-feasibility-v0.1.zip`
- **Archive SHA-256:** `811e71b39c8fc02f0f1e932a69d0e3e2f4454c43a2bc5c6f85a0545d353bd156`
- **Internal package version:** `0.5.0`
- **Node engine:** 20 or newer
- **Java target:** 17

The archive excludes Forge runtime/build directories. Any reviewer running the Java probes must provide a compatible Forge checkout or distribution and record its exact version and checksum.

## 18. Final guidance to the reviewer

The prototype's direction is promising because it makes Forge authoritative and tests real object movement, priority, targeting, and payment rather than building a second partial rules engine. Its main danger is expanding the action layer too quickly and accidentally hiding rules choices inside Forge or exposing hidden state to an agent.

Favor small, adversarially tested vertical slices. Every new action family should show:

1. how all strategically relevant choices are represented;
2. why the action is legal from only the acting player's authorized information;
3. what Forge actually executed;
4. how the result is logged and replayed; and
5. how failure, timeout, truncation, and version mismatch are surfaced instead of being converted into plausible-looking game data.

That discipline is more important at this stage than UI polish, large simulation counts, or premature machine learning.
