# First playable acceptance tests

## Deck and rules integrity

- Import all 100 Ral cards without fuzzy replacement.
- Reject unknown or ambiguous card names with a useful message.
- Enforce Commander color identity, singleton construction, commander tax,
  starting life, mulligans, turn order, and the multiplayer priority sequence.
- Ral reduces each instant/sorcery by exactly one generic mana.
- Ral flips only for an instant/sorcery cast during its controller's turn;
  losing deals one damage and winning offers (not forces) the transform.
- Transformed Ral receives one additional loyalty for every instant/sorcery
  cast earlier that turn, including the spell that produced the winning flip.
- Ral's -8 permits only the exiled instant/sorcery cards to be cast without
  paying mana costs and expires at end of turn.
- Storm counts every spell cast before the storm spell, including opponents'
  spells, and lets the controller choose targets for each copy.
- Underworld Breach applies the printed mana cost plus exiling three other
  graveyard cards; escaped cards are exiled if they would leave the stack for
  a non-exile zone.
- LED can be activated while a spell is being cast only at legal mana-ability
  timing, and its discard cost occurs correctly.
- Past in Flames, Quiet Speculation, Invoke Calamity, and temporary flashback
  effects expose only legal graveyard casts and apply exile-on-resolution.
- MDFCs have the correct front face outside the stack/battlefield and permit
  the land face only where the rules allow playing a land.
- Tavern Scoundrel observes every legally won coin flip and creates two
  Treasures for each win.
- Importing `_____ Goblin` must visibly apply the approved `"Name Sticker"
  Goblin` substitution and record that override in the replay and game result.

## Information and replay safety

- Each agent sees public zones, its own hidden zones, and only information it
  legally learned about opponents.
- Searching copied game states cannot reveal an opponent's hand or library
  order through action choice, evaluation, logs, or timing.
- A seed plus deck versions, seats, mulligan choices, and action log reproduces
  the same game exactly.
- Undo restores zones, life, mana, counters, stack, priority, RNG, revealed
  information, delayed triggers, and agent memory.
- Observation schema v1 never includes opponent hand identities or any library
  identity/order, and never gives a name to a face-down object the viewer may
  not inspect.
- Repeating the same seed and capture seat in fresh processes produces the
  same observation bytes.
- An MDFC land action moves the same card object from hand to its land face on
  the battlefield, applies its entry replacement effects, consumes the land
  play, and returns priority; replaying it from the same seed is byte-identical.
- A choice-free zero-mana spell moves the same card object from hand to the
  public stack, resolves after all four seats pass, moves to the correct zone,
  returns priority to the active player, and replays byte-identically.
- A targeted one-mana spell exposes a complete executable action containing
  the exact mana-source and target choices. The stack receipt must match both
  choices, the source must become tapped, the spell must produce its expected
  state change and destination, and all captures must replay byte-identically.
- For a simple spell with four legal player targets and two compatible
  one-mana sources, expansion emits exactly eight uniquely identified actions.
  Executing one action uses only its selected source and leaves the alternative
  source untapped.

## AI baseline

- Every agent can mulligan using a deck-specific keep profile.
- Every agent can identify its primary win packages and the cards that stop
  them.
- An agent never passes priority while it has a deterministic winning action it
  can identify, unless its strategy profile explicitly judges the attempt
  unsafe and records why.
- Threat assessment is multiplayer-aware: it identifies the active win attempt
  and does not spend interaction merely because another player has more life or
  battlefield material.
- Post-game review records the top candidate actions, chosen action, public
  information used, strategic goal, and confidence; it never reveals hidden
  information the agent did not legally know at the time.

## Stability gate

- Complete 100 seeded four-player games without a crash, deadlock, illegal
  state, or unresolved mandatory choice.
- Record the winner/draw, win mechanism, turn, seat, deck versions, mulligans,
  decision time, and full replay log for every game.
- The UI can stop at every normal human priority window, with configurable
  pass-until shortcuts that never suppress a newly legal human response.
