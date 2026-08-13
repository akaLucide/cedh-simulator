import assert from 'node:assert/strict';

export function observationErrors(observation) {
  const errors = [];
  if (observation?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!Number.isInteger(observation?.viewer?.seat)) errors.push('viewer.seat must be an integer');
  if (!Array.isArray(observation?.players)) errors.push('players must be an array');
  if (!Array.isArray(observation?.availableActions?.actions)) {
    errors.push('availableActions.actions must be an array');
  }
  if (errors.length > 0) return errors;

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

export function assertValidObservation(observation) {
  assert.deepEqual(observationErrors(observation), []);
  return observation;
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
