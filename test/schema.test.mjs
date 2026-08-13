import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaErrors } from '../scripts/lib/schema.mjs';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * A minimal but schema-valid v2 observation. Built here rather than read from a
 * capture so these tests prove what the *schema* rejects, independently of the
 * hand-written validator in observations.mjs and independently of Forge.
 */
function v2Observation() {
  const player = (seat, viewer) => ({
    seat,
    id: seat - 1,
    name: `Seat(${seat})`,
    life: 40,
    poison: 0,
    hasLost: false,
    zones: {
      hand: viewer
        ? { count: 1, visibility: 'viewer', cards: [{ id: 'card-1', name: 'Known', visibility: 'known' }] }
        : { count: 7, visibility: 'hidden' },
      library: { count: 92, visibility: 'count-only' },
      battlefield: { count: 0, visibility: 'card-objects', cards: [] },
      graveyard: { count: 0, visibility: 'card-objects', cards: [] },
      exile: { count: 0, visibility: 'card-objects', cards: [] },
      command: { count: 0, visibility: 'card-objects', cards: [] }
    },
    commanders: []
  });

  return {
    schemaVersion: 2,
    viewer: { seat: 1, id: 0, name: 'Seat(1)' },
    game: {
      turn: 1,
      phase: 'MAIN1',
      activePlayer: { seat: 1, id: 0, name: 'Seat(1)' },
      priorityPlayer: { seat: 1, id: 0, name: 'Seat(1)' },
      stack: []
    },
    players: [player(1, true), player(2, false)],
    availableActions: {
      enumerationVersion: 2,
      actions: [
        {
          id: 'pass-priority',
          category: 'PASS_PRIORITY',
          executable: true,
          unrepresentedChoices: []
        }
      ],
      completeness: 'test fixture',
      limitations: []
    },
    informationPolicy: {}
  };
}

function choice(overrides = {}) {
  return {
    code: 'OPTIONAL_LIFE_PAYMENT',
    decisionType: 'OPTIONAL_COST',
    source: { forgeCardId: 'card-97', name: 'Test Land', zone: 'Hand' },
    description: 'Enters tapped unless you pay 3 life.',
    ...overrides
  };
}

test('the v2 fixture is itself schema-valid', async () => {
  assert.deepEqual(await schemaErrors(v2Observation()), []);
});

test('A10: the schema rejects library identities without help from the validator', async () => {
  const sample = v2Observation();
  sample.players[1].zones.library.cards = [{ name: 'Leaked top card' }];
  const errors = await schemaErrors(sample);
  assert.notDeepEqual(errors, []);
  assert.ok(
    errors.some((error) => error.includes('library')),
    `expected a library error, received ${JSON.stringify(errors)}`
  );
});

test('A10: the schema also rejects library identities for the viewer', async () => {
  const sample = v2Observation();
  sample.players[0].zones.library.cards = [{ name: 'Own top card' }];
  assert.notDeepEqual(await schemaErrors(sample), []);
});

test('A11: the schema rejects executable true with an unrepresented choice', async () => {
  const sample = v2Observation();
  sample.availableActions.actions.push({
    id: 'ability-1264',
    category: 'PLAY_LAND',
    executable: true,
    unrepresentedChoices: [choice()]
  });
  assert.notDeepEqual(await schemaErrors(sample), []);
});

test('A11: the schema rejects executable false with no unrepresented choice', async () => {
  const sample = v2Observation();
  sample.availableActions.actions.push({
    id: 'ability-1271',
    category: 'PLAY_LAND',
    executable: false,
    unrepresentedChoices: []
  });
  assert.notDeepEqual(await schemaErrors(sample), []);
});

test('the schema accepts a consistent non-executable land play', async () => {
  const sample = v2Observation();
  sample.availableActions.actions.push({
    id: 'ability-1264',
    category: 'PLAY_LAND',
    executable: false,
    unrepresentedChoices: [choice({ amount: { unit: 'LIFE', value: 3 }, outcomes: ['PAY', 'DECLINE'] })]
  });
  assert.deepEqual(await schemaErrors(sample), []);
});

test('the schema rejects a free-form string unrepresented choice', async () => {
  const sample = v2Observation();
  sample.availableActions.actions.push({
    id: 'ability-1264',
    category: 'PLAY_LAND',
    executable: false,
    unrepresentedChoices: ['you may pay 3 life']
  });
  assert.notDeepEqual(await schemaErrors(sample), []);
});

test('the schema rejects an unknown decisionType', async () => {
  const sample = v2Observation();
  sample.availableActions.actions.push({
    id: 'ability-1264',
    category: 'PLAY_LAND',
    executable: false,
    unrepresentedChoices: [choice({ decisionType: 'VIBES' })]
  });
  assert.notDeepEqual(await schemaErrors(sample), []);
});

/**
 * Executing the v1 schema for the first time exposed a pre-existing
 * inconsistency. `spell-action-stack-v1.json` (the Mox Amber checkpoint) was
 * captured before `targets` and `payment` were added to stack items for the
 * Lava Dart checkpoint, but the v1 schema marks both required. Nothing detected
 * it because the schema was referenced only in prose and never compiled.
 *
 * Both sides are deliberately frozen — the capture is historical evidence and
 * the v1 schema is not redefined — so this test records the exact known state
 * instead of hiding it. Any change on either side breaks this test.
 */
const V1_CAPTURES_FAILING_THEIR_OWN_SCHEMA = {
  'spell-action-stack-v1.json': [
    "/game/stack/0: must have required property 'targets'",
    "/game/stack/0: must have required property 'payment'"
  ]
};

test('captured v1 examples match their v1 schema, with one recorded exception', async () => {
  const directory = path.join(projectRoot, 'examples');
  const files = (await readdir(directory)).filter((name) => name.endsWith('-v1.json')).sort();
  assert.equal(files.length, 9);

  const actual = {};
  for (const file of files) {
    const observation = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
    const errors = await schemaErrors(observation, 1);
    if (errors.length > 0) actual[file] = errors;
  }
  assert.deepEqual(actual, V1_CAPTURES_FAILING_THEIR_OWN_SCHEMA);
});
