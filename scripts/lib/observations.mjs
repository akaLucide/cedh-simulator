import assert from 'node:assert/strict';

const DECISION_TYPES = new Set([
  'OPTIONAL_COST',
  'MODE',
  'TARGET',
  'PAYMENT',
  'ORDERING',
  'VALUE',
  'UNKNOWN'
]);

/**
 * Dispatches on the observation's schema version.
 *
 * v1 is frozen: its action rules are kept exactly as they were when the v1
 * captures in `examples/` were produced, so those artifacts stay verifiable
 * against the contract that created them. v2 derives `executable` exclusively
 * from `unrepresentedChoices` being empty. See docs/observation-schema.md.
 */
export function observationErrors(observation) {
  if (observation?.schemaVersion === 3) return observationV3Errors(observation);
  return observation?.schemaVersion === 2
    ? observationV2Errors(observation)
    : observationV1Errors(observation);
}

/**
 * Information-boundary checks. Deliberately shared by both versions: the rules
 * about what a viewer may see do not change with the action contract, and a
 * leak fix must apply to every version at once.
 */
function informationBoundaryErrors(observation) {
  const errors = [];
  const viewerSeat = observation.viewer.seat;
  for (const player of observation.players) {
    const hand = player?.zones?.hand;
    const library = player?.zones?.library;
    if (!hand || !Number.isInteger(hand.count)) {
      errors.push(`seat ${player.seat}: hand count is missing`);
    }
    if (!library || !Number.isInteger(library.count)) {
      errors.push(`seat ${player.seat}: library count is missing`);
    }
    if (player.seat === viewerSeat) {
      if (!Array.isArray(hand?.cards) || hand.cards.length !== hand.count) {
        errors.push(`seat ${player.seat}: viewer hand identities do not match its count`);
      }
    } else if (hand && Object.hasOwn(hand, 'cards')) {
      errors.push(`seat ${player.seat}: opponent hand identities were exposed`);
    }
    if (library && Object.hasOwn(library, 'cards')) {
      errors.push(`seat ${player.seat}: library identities were exposed`);
    }

    for (const zoneName of ['battlefield', 'graveyard', 'exile', 'command']) {
      for (const card of player?.zones?.[zoneName]?.cards ?? []) {
        if (card.visibility === 'hidden' && card.name !== null) {
          errors.push(`seat ${player.seat}: hidden ${zoneName} card has a name`);
        }
      }
    }
  }
  return errors;
}

function structuralErrors(observation, expectedVersion) {
  const errors = [];
  if (observation?.schemaVersion !== expectedVersion) {
    errors.push(`schemaVersion must be ${expectedVersion}`);
  }
  if (!Number.isInteger(observation?.viewer?.seat)) errors.push('viewer.seat must be an integer');
  if (!Array.isArray(observation?.players)) errors.push('players must be an array');
  if (!Array.isArray(observation?.availableActions?.actions)) {
    errors.push('availableActions.actions must be an array');
  }
  return errors;
}

/** Frozen v1 action contract. Do not add v2 rules here. */
function observationV1Errors(observation) {
  const errors = structuralErrors(observation, 1);
  if (errors.length > 0) return errors;

  errors.push(...informationBoundaryErrors(observation));

  const actions = observation.availableActions.actions;
  if (!actions.some((action) => action.category === 'PASS_PRIORITY' && action.executable === true)) {
    errors.push('an executable PASS_PRIORITY action is required');
  }
  const actionIds = new Set();
  for (const action of actions) {
    if (actionIds.has(action.id)) errors.push(`${action.id}: duplicate action id`);
    actionIds.add(action.id);
    const completeCast = action.category === 'CAST_SPELL'
      && action.requiresChoiceExpansion === false
      && Array.isArray(action.choices?.targets)
      && action.choices.targets.length > 0
      && action.choices?.payment?.kind === 'MANA'
      && Number.isInteger(action.choices.payment.manaCount)
      && Array.isArray(action.choices.payment.mana)
      && action.choices.payment.mana.length === action.choices.payment.manaCount;
    const allowedExecutable = action.category === 'PASS_PRIORITY'
      || action.category === 'PLAY_LAND'
      || completeCast;
    if (!allowedExecutable && action.executable !== false) {
      errors.push(`${action.id}: unexpanded candidate must not be marked executable`);
    }
    if (completeCast) {
      const sourceIds = action.choices.payment.mana.map((mana) => mana.sourceCardId);
      if (new Set(sourceIds).size !== sourceIds.length) {
        errors.push(`${action.id}: a simple mana plan must not reuse a mana source`);
      }
    }
    if (action.category === 'PLAY_LAND'
        && (action.executable !== true || action.requiresChoiceExpansion !== false)) {
      errors.push(`${action.id}: a rule-valid land play must be a complete executable action`);
    }
    if (action.source?.visibility === 'hidden') {
      errors.push(`${action.id}: an action source revealed a hidden card object`);
    }
  }
  return errors;
}

/**
 * Validates one `unrepresentedChoices` entry. Entries are structured objects so
 * a later expander can enumerate them; free-form strings are rejected.
 */
function unrepresentedChoiceErrors(actionId, index, choice) {
  const errors = [];
  const label = `${actionId}: unrepresentedChoices[${index}]`;
  if (typeof choice !== 'object' || choice === null || Array.isArray(choice)) {
    errors.push(`${label} must be a structured object`);
    return errors;
  }
  if (typeof choice.code !== 'string' || choice.code.length === 0) {
    errors.push(`${label} requires a non-empty code`);
  }
  if (!DECISION_TYPES.has(choice.decisionType)) {
    errors.push(`${label} has an unknown decisionType: ${choice.decisionType}`);
  }
  if (typeof choice.source?.forgeCardId !== 'string') {
    errors.push(`${label} requires source.forgeCardId`);
  }
  if (typeof choice.description !== 'string' || choice.description.length === 0) {
    errors.push(`${label} requires a non-empty description`);
  }
  return errors;
}

const STAGED_FIXTURE_FIELDS = ['stagedCard', 'sourceZone', 'cliArgument'];

/**
 * Validates how the captured state was reached.
 *
 * A staged capture arranged its own starting state, so it proves things about
 * the adapter rather than about a natural game. Recording that is not optional:
 * an unmarked staged capture would invite exactly the comparison it must not be
 * used for.
 */
function fixtureErrors(fixture) {
  if (typeof fixture !== 'object' || fixture === null || Array.isArray(fixture)) {
    return ['fixture must be a structured object'];
  }
  const errors = [];
  if (fixture.kind !== 'natural' && fixture.kind !== 'staged') {
    errors.push(`fixture.kind must be natural or staged, not ${fixture.kind}`);
  }
  if (fixture.kind === 'staged') {
    for (const field of STAGED_FIXTURE_FIELDS) {
      if (typeof fixture[field] !== 'string' || fixture[field].length === 0) {
        errors.push(`fixture.${field} is required for a staged capture`);
      }
    }
  } else if (fixture.kind === 'natural') {
    for (const field of STAGED_FIXTURE_FIELDS) {
      if (Object.hasOwn(fixture, field)) {
        errors.push(`fixture.${field} must not appear on a natural capture`);
      }
    }
  }
  return errors;
}

/**
 * v2 action contract. `executable` carries no independent information: it is
 * true exactly when the adapter has represented every strategically relevant
 * choice for that action. No category — land plays included — may opt out.
 */
function observationV2Errors(observation) {
  const errors = structuralErrors(observation, 2);
  if (errors.length > 0) return errors;

  errors.push(...informationBoundaryErrors(observation));
  errors.push(...fixtureErrors(observation.fixture));
  errors.push(...actionContractErrors(observation));
  return errors;
}

/**
 * The action rules shared by v2 and v3. `executable` carries no independent
 * information: it is true exactly when the adapter has represented every
 * strategically relevant choice for that action. No category — land plays
 * included — may opt out.
 */
function actionContractErrors(observation) {
  const errors = [];
  const actions = observation.availableActions.actions;
  if (!actions.some((action) => action.category === 'PASS_PRIORITY' && action.executable === true)) {
    errors.push('an executable PASS_PRIORITY action is required');
  }

  const actionIds = new Set();
  for (const action of actions) {
    if (actionIds.has(action.id)) errors.push(`${action.id}: duplicate action id`);
    actionIds.add(action.id);

    if (!Array.isArray(action.unrepresentedChoices)) {
      // Absent means "nothing was audited", which must never read as complete.
      errors.push(`${action.id}: unrepresentedChoices must be an array`);
      continue;
    }
    action.unrepresentedChoices.forEach((choice, index) => {
      errors.push(...unrepresentedChoiceErrors(action.id, index, choice));
    });

    const complete = action.unrepresentedChoices.length === 0;
    if (action.executable !== complete) {
      errors.push(
        `${action.id}: executable must be ${complete} because unrepresentedChoices `
        + `has ${action.unrepresentedChoices.length} entries`
      );
    }
    if (Object.hasOwn(action, 'requiresChoiceExpansion')
        && action.requiresChoiceExpansion !== !complete) {
      errors.push(`${action.id}: requiresChoiceExpansion must be the inverse of executable`);
    }

    const mana = action.choices?.payment?.mana;
    if (Array.isArray(mana)) {
      const sourceIds = mana.map((entry) => entry.sourceCardId);
      if (new Set(sourceIds).size !== sourceIds.length) {
        errors.push(`${action.id}: a simple mana plan must not reuse a mana source`);
      }
    }
    if (action.source?.visibility === 'hidden') {
      errors.push(`${action.id}: an action source revealed a hidden card object`);
    }
  }
  return errors;
}



/**
 * Cross-field consistency for `simpleSpellExpansion`.
 *
 * Exported and pure so it can be tested directly on synthetic inputs. JSON
 * Schema handles types, required fields, enums, nullability and the four
 * mutually exclusive branches; it cannot express arithmetic across records, so
 * everything summed or cross-referenced is enforced here. Stock Ajv does not
 * check any of the relationships below.
 */
export function simpleSpellExpansionErrors(expansion, actions = []) {
  const errors = [];
  if (typeof expansion !== 'object' || expansion === null || Array.isArray(expansion)) {
    return ['simpleSpellExpansion must be a structured object'];
  }
  const label = 'simpleSpellExpansion';
  const inspected = expansion.inspectedAbilities ?? [];
  const exclusions = expansion.manaSourceExclusions ?? [];

  // Branch consistency, restated independently of the schema so a schema bug
  // cannot let an impossible mixture through.
  const complete = expansion.attempted === true
    && (expansion.suppressedReason === null || expansion.suppressedReason === undefined)
    && expansion.truncated === false
    && expansion.candidateScanComplete === true;
  if (expansion.complete !== complete) {
    errors.push(`${label}: complete must be ${complete} for this attempted/suppressed/truncated/scan state`);
  }
  if (expansion.candidateUnitsMayBeUninspected !== (expansion.candidateScanComplete !== true)) {
    errors.push(`${label}: candidateUnitsMayBeUninspected must be the inverse of candidateScanComplete`);
  }
  if (expansion.attempted !== true && inspected.length > 0) {
    errors.push(`${label}: an unattempted expansion cannot have inspected abilities`);
  }

  // The published action array must match the declared emitted count.
  const expandedActions = actions.filter((action) => action.expansionVersion !== undefined);
  if (expandedActions.length !== expansion.emittedActionCount) {
    errors.push(
      `${label}: emittedActionCount ${expansion.emittedActionCount} does not match `
      + `${expandedActions.length} expanded actions in the action array`
    );
  }

  // Per-record arithmetic.
  let capacitySum = 0;
  let emittedSum = 0;
  let atLeastSum = 0;
  for (const [index, record] of inspected.entries()) {
    const at = `${label}.inspectedAbilities[${index}]`;
    if (record.outcome === 'EXPANDED') {
      if (record.capacity !== record.targetCount * record.planCount) {
        errors.push(`${at}: capacity must equal targetCount * planCount`);
      }
      if (record.omittedActionCount !== record.capacity - record.emittedActionCount) {
        errors.push(`${at}: omittedActionCount must equal capacity - emittedActionCount`);
      }
      if (record.emittedActionCount > record.capacity) {
        errors.push(`${at}: emittedActionCount cannot exceed capacity`);
      }
      capacitySum += record.capacity;
      emittedSum += record.emittedActionCount;
      atLeastSum += record.capacity - record.emittedActionCount;
    } else if (record.outcome === 'SKIPPED') {
      // A skipped unit contributes nothing to capacity: it was never in scope.
      if (record.capacity !== undefined || record.emittedActionCount !== undefined) {
        errors.push(`${at}: a skipped ability must not carry capacity or emitted counts`);
      }
    }
  }

  if (emittedSum !== expansion.emittedActionCount) {
    errors.push(
      `${label}: per-ability emitted counts sum to ${emittedSum}, `
      + `but emittedActionCount is ${expansion.emittedActionCount}`
    );
  }
  if (expansion.omittedActionCountAtLeast !== atLeastSum) {
    errors.push(
      `${label}: omittedActionCountAtLeast must equal ${atLeastSum}, `
      + 'the sum over inspected units only'
    );
  }
  if (expansion.candidateScanComplete === true) {
    if (expansion.totalCapacity !== capacitySum) {
      errors.push(`${label}: totalCapacity must equal the ${capacitySum} summed from inspected abilities`);
    }
    if (expansion.omittedActionCount !== expansion.totalCapacity - expansion.emittedActionCount) {
      errors.push(`${label}: omittedActionCount must equal totalCapacity - emittedActionCount`);
    }
  } else {
    if (expansion.totalCapacity !== null) {
      errors.push(`${label}: totalCapacity must be null when the candidate scan did not complete`);
    }
    if (expansion.omittedActionCount !== null) {
      errors.push(`${label}: omittedActionCount must be null when totalCapacity is unknown`);
    }
  }

  // Excluded mana abilities are outside the boundary, not missing from inside it,
  // so they must never appear as inspected units or contribute to the sums.
  const inspectedIds = new Set(inspected.map((record) => record.abilityId));
  for (const [index, exclusion] of exclusions.entries()) {
    const at = `${label}.manaSourceExclusions[${index}]`;
    if (exclusion.unit !== 'MANA_ABILITY' || exclusion.outcome !== 'EXCLUDED') {
      errors.push(`${at}: must be an excluded MANA_ABILITY unit`);
    }
    if (inspectedIds.has(exclusion.manaAbilityId)) {
      errors.push(`${at}: an excluded mana ability must not also be an inspected spell ability`);
    }
    const colors = exclusion.producibleColors ?? [];
    if (colors.length < 2) {
      errors.push(`${at}: an exclusion for a selectable colour needs at least two producible colours`);
    }
    if ([...colors].sort().join() !== colors.join()) {
      errors.push(`${at}: producibleColors must be lexicographically sorted`);
    }
  }
  return errors;
}

/**
 * v3 contract. Keeps every v2 action rule and adds enumeration honesty: the
 * capture must state what the expander attempted, inspected, emitted, and could
 * not know.
 */
function observationV3Errors(observation) {
  const errors = structuralErrors(observation, 3);
  if (errors.length > 0) return errors;

  errors.push(...informationBoundaryErrors(observation));
  errors.push(...fixtureErrors(observation.fixture));
  errors.push(...actionContractErrors(observation));
  errors.push(...expandedActionFieldErrors(observation.availableActions.actions));
  errors.push(...simpleSpellExpansionErrors(
    observation.availableActions.simpleSpellExpansion,
    observation.availableActions.actions
  ));
  return errors;
}


/**
 * Every field an expanded action may carry, and how comparison treats it.
 *
 * The inventory is exhaustive on purpose. A new field added to expanded actions
 * without a decision recorded here fails validation rather than silently joining
 * or silently escaping the semantic comparison — the failure mode this
 * classification exists to prevent.
 *
 *   SEMANTIC        compared directly; a difference is a real difference
 *   DEBUG_IDENTITY  a raw Forge id; identity-normalized, never byte-compared
 *   DERIVED_IDENTITY composed from Forge ids; identity-normalized
 *   SEMANTIC_NESTED compared after the same treatment is applied inside
 */
export const EXPANDED_ACTION_FIELD_CLASSES = Object.freeze({
  id: 'DERIVED_IDENTITY',
  category: 'SEMANTIC',
  expansionVersion: 'SEMANTIC',
  sourceCardId: 'DEBUG_IDENTITY',
  source: 'SEMANTIC_NESTED',
  abilityId: 'DEBUG_IDENTITY',
  description: 'SEMANTIC',
  printedManaCost: 'SEMANTIC',
  manaCost: 'SEMANTIC',
  usesTargeting: 'SEMANTIC',
  timingAndZoneLegal: 'SEMANTIC',
  unrepresentedChoices: 'SEMANTIC_NESTED',
  executable: 'SEMANTIC',
  requiresChoiceExpansion: 'SEMANTIC',
  choices: 'SEMANTIC_NESTED'
});

/** Rejects an expanded-action field nobody has classified. */
export function expandedActionFieldErrors(actions = []) {
  const errors = [];
  for (const action of actions) {
    if (action.expansionVersion === undefined) continue;
    for (const field of Object.keys(action)) {
      if (!Object.hasOwn(EXPANDED_ACTION_FIELD_CLASSES, field)) {
        errors.push(
          `${action.id}: expanded action field "${field}" is unclassified; `
          + 'add it to EXPANDED_ACTION_FIELD_CLASSES so semantic comparison knows '
          + 'whether it is meaningful or debug-only'
        );
      }
    }
  }
  return errors;
}

/**
 * The ordered semantic projection of a capture's expanded actions.
 *
 * Projects first, then normalizes: debug-only identity fields are dropped, the
 * remaining structured identity references are canonicalized, and membership and
 * order are preserved exactly. Order is never sorted away, so a genuine ordering
 * difference between two runs still compares unequal.
 */
export function semanticExpandedActionSequence(capture) {
  const actions = (capture?.availableActions?.actions ?? [])
    .filter((action) => action.expansionVersion !== undefined);
  const unclassified = expandedActionFieldErrors(actions);
  if (unclassified.length > 0) {
    throw new Error(`cannot project unclassified fields: ${unclassified.join('; ')}`);
  }
  const projected = actions.map((action) => {
    const result = {};
    for (const [field, value] of Object.entries(action)) {
      const kind = EXPANDED_ACTION_FIELD_CLASSES[field];
      if (kind === 'DEBUG_IDENTITY') continue;
      result[field] = value;
    }
    return result;
  });
  // Identity-normalize what survives, in a projection-local namespace.
  return normalizeCaptureBundle(projected);
}

export function assertValidObservation(observation) {
  assert.deepEqual(observationErrors(observation), []);
  return observation;
}

/** Forge id namespaces. Debug-only: assigned by a global counter, not by state. */
const ID_NAMESPACES = ['card', 'ability', 'stack'];

/**
 * Canonicalizes Forge's debug-only object ids across an ordered capture bundle.
 *
 * Two fresh JVMs replaying the same seed produce the same game but not the same
 * ids — Forge assigns them from a global counter, so they drift with unrelated
 * allocation. Byte comparison would therefore fail for reasons the v2 contract
 * has already declared meaningless.
 *
 * Ids are **rewritten, not removed**. Deleting them would also delete the proof
 * that the card which left hand is the card that reached the battlefield, which
 * is the very thing the land probes exist to demonstrate. Each distinct raw id
 * maps to one token, so identity relationships survive normalization and a
 * rewired relationship still compares unequal.
 *
 * One map per namespace is shared across every capture in the bundle, because a
 * card keeps its id across the before/after pair of a single run. Tokens are
 * assigned by first appearance in a deterministic traversal: capture order, then
 * object key insertion order, then array index.
 *
 * This is **not** canonical cross-run identity. Nothing here survives into a
 * replay or undo system; stable identity is M2.
 */
export function normalizeCaptureBundle(captures) {
  if (!Array.isArray(captures)) throw new TypeError('normalizeCaptureBundle expects an array');
  const maps = new Map(ID_NAMESPACES.map((namespace) => [namespace, new Map()]));

  const token = (namespace, rawId) => {
    const known = maps.get(namespace);
    if (!known.has(rawId)) known.set(rawId, `#${known.size + 1}`);
    return known.get(rawId);
  };

  const rewrite = (text) => text
    // Plain field values and the hyphenated segments of composite action ids:
    // "card-97", "ability-1273", "stack-2",
    // "cast-card-75-ability-1273-target-player-0-...".
    .replace(/\b(card|ability|stack)-(\d+)/g, (_, namespace, rawId) =>
      `${namespace}-${token(namespace, rawId)}`)
    // The compacted payment segment of a composite action id, which carries no
    // hyphens: "-pay-card98a274r".
    .replace(/\bcard(\d+)a(\d+)/g, (_, cardId, abilityId) =>
      `card${token('card', cardId)}a${token('ability', abilityId)}`)
    // Raw ids Forge embeds in prose, e.g. a stack description reading
    // "Lava Dart (75) - Lava Dart (75) deals 1 damage to ...". Only ids already
    // seen as real card objects are rewritten, so ordinary numbers in rules text
    // are left alone.
    .replace(/\((\d+)\)/g, (match, rawId) =>
      maps.get('card').has(rawId) ? `(${maps.get('card').get(rawId)})` : match);

  const walk = (value) => {
    if (typeof value === 'string') return rewrite(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const result = {};
      for (const [key, item] of Object.entries(value)) result[key] = walk(item);
      return result;
    }
    // Numbers, booleans and null pass through untouched. That deliberately
    // protects meaningful state: seats, life, counts, and `targets[].id`, which
    // is a player index rather than a Forge object id.
    return value;
  };

  return captures.map(walk);
}

/**
 * Compares two runs of the same probe through the semantic projection.
 *
 * Each capture must already have been validated on its own; this proves the two
 * runs describe the same game, not that either is well formed.
 */
export function assertReproducibleBundles(first, second, label = 'capture bundle') {
  if (first.length !== second.length) {
    assert.fail(`${label}: run 1 produced ${first.length} captures, run 2 produced ${second.length}`);
  }
  assert.deepEqual(
    normalizeCaptureBundle(first),
    normalizeCaptureBundle(second),
    `${label}: the two runs differ beyond Forge's debug-only object ids`
  );
}

export function landTransitionErrors(before, after, sourceName) {
  const errors = [
    ...observationErrors(before).map((error) => `before: ${error}`),
    ...observationErrors(after).map((error) => `after: ${error}`)
  ];
  if (errors.length > 0) return errors;

  const seat = before.viewer.seat;
  const beforePlayer = before.players.find((player) => player.seat === seat);
  const afterPlayer = after.players.find((player) => player.seat === seat);
  const beforeCard = beforePlayer?.zones?.hand?.cards?.find((card) => card.name === sourceName);
  const afterBattlefield = afterPlayer?.zones?.battlefield?.cards ?? [];

  if (!before.availableActions.actions.some((action) =>
    action.category === 'PLAY_LAND'
      && action.source?.name === sourceName
      && action.executable === true)) {
    errors.push(`before: no executable PLAY_LAND action for ${sourceName}`);
  }
  if (!beforeCard) errors.push(`before: ${sourceName} is not in the viewer hand`);
  if (beforePlayer?.zones?.hand?.count - 1 !== afterPlayer?.zones?.hand?.count) {
    errors.push('after: viewer hand count did not decrease by one');
  }
  if (beforePlayer?.zones?.battlefield?.count + 1 !== afterPlayer?.zones?.battlefield?.count) {
    errors.push('after: viewer battlefield count did not increase by one');
  }
  if (beforeCard && !afterBattlefield.some((card) => card.id === beforeCard.id)) {
    errors.push('after: the selected card object did not move to the battlefield');
  }
  if (before.game.turn !== after.game.turn || before.game.phase !== after.game.phase) {
    errors.push('after: action did not return priority in the same turn and phase');
  }
  return errors;
}

export function assertLandTransition(before, after, sourceName) {
  assert.deepEqual(landTransitionErrors(before, after, sourceName), []);
}

export function spellTransitionErrors(before, onStack, resolved, sourceName) {
  const errors = [
    ...observationErrors(before).map((error) => `before: ${error}`),
    ...observationErrors(onStack).map((error) => `stack: ${error}`),
    ...observationErrors(resolved).map((error) => `resolved: ${error}`)
  ];
  if (errors.length > 0) return errors;

  const seat = before.viewer.seat;
  const beforePlayer = before.players.find((player) => player.seat === seat);
  const stackPlayer = onStack.players.find((player) => player.seat === seat);
  const resolvedPlayer = resolved.players.find((player) => player.seat === seat);
  const beforeCard = beforePlayer?.zones?.hand?.cards?.find((card) => card.name === sourceName);
  const matchingStackItems = onStack.game.stack.filter((item) =>
    item.source === sourceName && item.sourceCardId === beforeCard?.id && item.kind === 'spell');

  if (!beforeCard) errors.push(`before: ${sourceName} is not in the viewer hand`);
  if (before.game.stack.length !== 0) errors.push('before: stack is not empty');
  if (matchingStackItems.length !== 1) {
    errors.push(`stack: expected one ${sourceName} spell using the selected card object`);
  }
  if (beforePlayer?.zones?.hand?.count - 1 !== stackPlayer?.zones?.hand?.count) {
    errors.push('stack: viewer hand count did not decrease by one');
  }
  if (resolved.game.stack.length !== 0) errors.push('resolved: stack is not empty');
  if (!resolvedPlayer?.zones?.battlefield?.cards?.some((card) =>
    card.id === beforeCard?.id && card.name === sourceName)) {
    errors.push(`resolved: ${sourceName} did not enter the battlefield as the same card object`);
  }
  if (before.game.turn !== onStack.game.turn
      || before.game.turn !== resolved.game.turn
      || before.game.phase !== onStack.game.phase
      || before.game.phase !== resolved.game.phase) {
    errors.push('resolved: cast and resolution did not remain in the same turn and phase');
  }
  if (resolved.game.priorityPlayer.seat !== before.game.activePlayer.seat) {
    errors.push('resolved: active player did not receive priority after resolution');
  }
  return errors;
}

export function assertSpellTransition(before, onStack, resolved, sourceName) {
  assert.deepEqual(spellTransitionErrors(before, onStack, resolved, sourceName), []);
}

export function targetedSpellTransitionErrors(
  before,
  onStack,
  resolved,
  { sourceName, manaSourceName, targetPlayerSeat, alternativeManaSourceName }
) {
  const errors = [
    ...observationErrors(before).map((error) => `before: ${error}`),
    ...observationErrors(onStack).map((error) => `stack: ${error}`),
    ...observationErrors(resolved).map((error) => `resolved: ${error}`)
  ];
  if (errors.length > 0) return errors;

  const actingSeat = before.viewer.seat;
  const beforeActor = before.players.find((player) => player.seat === actingSeat);
  const stackActor = onStack.players.find((player) => player.seat === actingSeat);
  const resolvedActor = resolved.players.find((player) => player.seat === actingSeat);
  const beforeTarget = before.players.find((player) => player.seat === targetPlayerSeat);
  const resolvedTarget = resolved.players.find((player) => player.seat === targetPlayerSeat);
  const source = beforeActor?.zones?.hand?.cards?.find((card) => card.name === sourceName);
  const manaSource = beforeActor?.zones?.battlefield?.cards?.find((card) => card.name === manaSourceName);
  const expanded = before.availableActions.actions.find((action) =>
    action.category === 'CAST_SPELL'
      && action.sourceCardId === source?.id
      && action.executable === true
      && action.requiresChoiceExpansion === false
      && action.choices?.targets?.length === 1
      && action.choices.targets[0]?.kind === 'PLAYER'
      && action.choices.targets[0]?.seat === targetPlayerSeat);
  const stackItem = onStack.game.stack.find((item) =>
    item.source === sourceName && item.sourceCardId === source?.id && item.kind === 'spell');

  if (!source) errors.push(`before: ${sourceName} is not in the viewer hand`);
  if (!manaSource) errors.push(`before: ${manaSourceName} is not on the viewer battlefield`);
  if (manaSource?.tapped !== false) errors.push(`before: ${manaSourceName} is not untapped`);
  if (!expanded) errors.push(`before: no complete executable CAST_SPELL action for ${sourceName}`);
  if (expanded?.choices?.targets?.length !== 1
      || expanded.choices.targets[0]?.kind !== 'PLAYER'
      || expanded.choices.targets[0]?.seat !== targetPlayerSeat) {
    errors.push(`before: action does not select player seat ${targetPlayerSeat} as its sole target`);
  }
  if (expanded?.choices?.payment?.mana?.length !== 1
      || expanded.choices.payment.mana[0]?.sourceCardId !== manaSource?.id
      || expanded.choices.payment.mana[0]?.color !== 'R') {
    errors.push(`before: action does not select one red mana from ${manaSourceName}`);
  }
  if (alternativeManaSourceName) {
    const alternative = before.availableActions.actions.find((action) =>
      action.category === 'CAST_SPELL'
        && action.sourceCardId === source?.id
        && action.executable === true
        && action.choices?.targets?.length === 1
        && action.choices.targets[0]?.seat === targetPlayerSeat
        && action.choices?.payment?.mana?.length === 1
        && action.choices.payment.mana[0]?.source === alternativeManaSourceName);
    if (!alternative) {
      errors.push(`before: no alternative payment action using ${alternativeManaSourceName}`);
    }
  }
  if (!stackItem) errors.push(`stack: expected one ${sourceName} spell using the selected card object`);
  if (stackItem?.targets?.length !== 1
      || stackItem.targets[0]?.kind !== 'PLAYER'
      || stackItem.targets[0]?.seat !== targetPlayerSeat) {
    errors.push(`stack: ${sourceName} does not target player seat ${targetPlayerSeat}`);
  }
  if (stackItem?.payment?.manaCount !== 1
      || stackItem.payment.mana?.length !== 1
      || stackItem.payment.mana[0]?.sourceCardId !== manaSource?.id
      || stackItem.payment.mana[0]?.color !== 'R') {
    errors.push(`stack: ${sourceName} was not paid with one red mana from ${manaSourceName}`);
  }
  const stackManaSource = stackActor?.zones?.battlefield?.cards?.find((card) => card.id === manaSource?.id);
  if (stackManaSource?.tapped !== true) errors.push(`stack: ${manaSourceName} was not tapped for payment`);
  if (beforeActor?.zones?.hand?.count - 1 !== stackActor?.zones?.hand?.count) {
    errors.push('stack: viewer hand count did not decrease by one');
  }
  if (resolved.game.stack.length !== 0) errors.push('resolved: stack is not empty');
  if (!resolvedActor?.zones?.graveyard?.cards?.some((card) =>
    card.id === source?.id && card.name === sourceName)) {
    errors.push(`resolved: ${sourceName} did not enter the graveyard as the same card object`);
  }
  if (beforeTarget?.life - 1 !== resolvedTarget?.life) {
    errors.push(`resolved: target seat ${targetPlayerSeat} did not lose exactly one life`);
  }
  if (before.game.turn !== onStack.game.turn
      || before.game.turn !== resolved.game.turn
      || before.game.phase !== onStack.game.phase
      || before.game.phase !== resolved.game.phase) {
    errors.push('resolved: cast and resolution did not remain in the same turn and phase');
  }
  if (resolved.game.priorityPlayer.seat !== before.game.activePlayer.seat) {
    errors.push('resolved: active player did not receive priority after resolution');
  }
  return errors;
}

export function assertTargetedSpellTransition(before, onStack, resolved, options) {
  assert.deepEqual(targetedSpellTransitionErrors(before, onStack, resolved, options), []);
}
