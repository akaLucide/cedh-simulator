import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { observationErrors } from '../scripts/lib/observations.mjs';
import { schemaErrors } from '../scripts/lib/schema.mjs';

/**
 * Acceptance evidence for the Forge-dependent half of Milestone 1.
 *
 * Every assertion here reads a capture produced by a real probe against the
 * pinned Forge build. Regenerating a capture with different behaviour breaks
 * these tests, which is the point: the captures are the evidence, and the tests
 * are what stop the evidence from drifting silently.
 */

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const CAPTURES = {
  natural: 'examples/priority-observation-v2.json',
  choiceFreeBefore: 'examples/staged-choice-free-land-before-v2.json',
  choiceFreeAfter: 'examples/staged-choice-free-land-after-v2.json',
  optionalCost: 'examples/staged-optional-cost-land-before-v2.json',
  spell: 'examples/spell-action-before-v2.json',
  targeted: 'examples/targeted-spell-before-v2.json'
};

async function capture(key) {
  return JSON.parse(await readFile(path.join(projectRoot, CAPTURES[key]), 'utf8'));
}

function landAction(observation, sourceName) {
  return observation.availableActions.actions.find(
    (action) => action.category === 'PLAY_LAND' && action.source?.name === sourceName
  );
}

/** The full optional-payment shape a land entry choice must carry. */
function assertOptionalLifePayment(action, sourceName, life) {
  assert.ok(action, `expected a PLAY_LAND action for ${sourceName}`);
  assert.equal(action.executable, false, `${sourceName} must not be executable`);
  assert.equal(action.unrepresentedChoices.length, 1, `${sourceName} must carry exactly one choice`);

  const [choice] = action.unrepresentedChoices;
  assert.equal(choice.decisionType, 'OPTIONAL_COST');
  assert.deepEqual(choice.amount, { unit: 'LIFE', value: life });
  assert.equal(choice.timing, 'ON_ENTER');
  assert.deepEqual(choice.outcomes, ['PAY', 'DECLINE']);
  assert.equal(choice.optional, true);
}

test('every v2 capture satisfies both the schema and the validator', async () => {
  for (const key of Object.keys(CAPTURES)) {
    const observation = await capture(key);
    assert.equal(observation.schemaVersion, 2, `${CAPTURES[key]} must be a v2 capture`);
    assert.deepEqual(await schemaErrors(observation), [], `${CAPTURES[key]} failed the schema`);
    assert.deepEqual(observationErrors(observation), [], `${CAPTURES[key]} failed the validator`);
  }
});

test('capture provenance is recorded and never overstated', async () => {
  assert.deepEqual((await capture('natural')).fixture, { kind: 'natural' });
  assert.deepEqual((await capture('spell')).fixture, { kind: 'natural' });

  for (const key of ['choiceFreeBefore', 'choiceFreeAfter', 'optionalCost', 'targeted']) {
    const { fixture } = await capture(key);
    assert.equal(fixture.kind, 'staged', `${CAPTURES[key]} arranged its own state`);
    assert.ok(fixture.stagedCard, `${CAPTURES[key]} must name what it staged`);
    assert.ok(fixture.sourceZone, `${CAPTURES[key]} must name the source zone`);
    assert.ok(fixture.cliArgument, `${CAPTURES[key]} must record the CLI argument`);
  }
});

test('A1/A2: Shatterskull is non-executable and names its three-life payment', async () => {
  assertOptionalLifePayment(landAction(await capture('natural'), 'Shatterskull Smashing'), 'Shatterskull Smashing', 3);
});

test('A18: Sink into Stupor carries the same three-life payment', async () => {
  // The land the original probe exercised. Forge's own card data gives its land
  // face the identical optional payment, so the repository's earlier claim that
  // it was the one choice-free land face in the deck was wrong.
  assertOptionalLifePayment(landAction(await capture('natural'), 'Sink into Stupor'), 'Sink into Stupor', 3);
});

test('A18: the natural capture offers no executable land action at all', async () => {
  const observation = await capture('natural');
  const lands = observation.availableActions.actions.filter((action) => action.category === 'PLAY_LAND');
  assert.equal(lands.length, 2, 'the seed-20260812 opening hand holds exactly two land plays');
  assert.deepEqual(lands.map((action) => action.executable), [false, false]);
});

test('A7: Steam Vents is detected as a two-life payment and never executed', async () => {
  const observation = await capture('optionalCost');
  assertOptionalLifePayment(landAction(observation, 'Steam Vents'), 'Steam Vents', 2);

  const viewer = observation.players.find((player) => player.seat === observation.viewer.seat);
  assert.ok(
    !viewer.zones.battlefield.cards.some((card) => card.name === 'Steam Vents'),
    'an incompletely audited action must not be executed'
  );
});

test('A5: a choice-free land is positively proven executable', async () => {
  const before = await capture('choiceFreeBefore');
  const action = landAction(before, before.fixture.stagedCard);
  assert.ok(action, 'the staged land must appear as a land action');
  assert.deepEqual(action.unrepresentedChoices, [], 'no decision may remain unrepresented');
  assert.equal(action.executable, true);
});

test('A6: the choice-free land executes end to end as the same card object', async () => {
  const [before, after] = [await capture('choiceFreeBefore'), await capture('choiceFreeAfter')];
  const seat = before.viewer.seat;
  const beforeViewer = before.players.find((player) => player.seat === seat);
  const afterViewer = after.players.find((player) => player.seat === seat);
  const staged = before.fixture.stagedCard;

  const inHand = beforeViewer.zones.hand.cards.find((card) => card.name === staged);
  assert.ok(inHand, `${staged} must start in hand`);

  // Raw ids, deliberately not normalized: this is the same-object proof.
  const onBattlefield = afterViewer.zones.battlefield.cards.find((card) => card.id === inHand.id);
  assert.ok(onBattlefield, 'the exact card object that left hand must be on the battlefield');
  assert.equal(onBattlefield.name, staged);
  assert.equal(onBattlefield.tapped, false, 'a choice-free land enters untapped');

  assert.equal(beforeViewer.zones.hand.count - 1, afterViewer.zones.hand.count);
  assert.equal(beforeViewer.life, afterViewer.life, 'no life may be paid for a choice-free land');
  assert.equal(before.game.turn, after.game.turn);
  assert.equal(before.game.phase, after.game.phase);
  assert.equal(after.game.priorityPlayer.seat, seat, 'priority must return to the acting seat');
});

test('A15: an unexpanded cast candidate stays non-executable', async () => {
  const observation = await capture('spell');
  const candidates = observation.availableActions.actions.filter(
    (action) => action.category === 'CAST_SPELL' && action.expansionVersion === undefined
  );
  assert.ok(candidates.length > 0, 'expected at least one unexpanded candidate');
  for (const candidate of candidates) {
    assert.equal(candidate.executable, false);
    assert.deepEqual(
      candidate.unrepresentedChoices.map((choice) => choice.code),
      ['UNSUPPORTED_ACTION_EXPANSION']
    );
  }
});

test('A16: every fully expanded cast stays executable with an empty list', async () => {
  const observation = await capture('targeted');
  const expanded = observation.availableActions.actions.filter(
    (action) => action.expansionVersion !== undefined
  );
  assert.equal(expanded.length, 8, 'four legal targets times two compatible sources');
  assert.equal(new Set(expanded.map((action) => action.id)).size, 8, 'ids must be unique in the observation');
  for (const action of expanded) {
    assert.deepEqual(action.unrepresentedChoices, []);
    assert.equal(action.executable, true);
  }
});
