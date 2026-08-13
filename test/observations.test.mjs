import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  landTransitionErrors,
  normalizeCaptureBundle,
  observationErrors,
  spellTransitionErrors,
  targetedSpellTransitionErrors
} from '../scripts/lib/observations.mjs';

function observation() {
  return {
    schemaVersion: 1,
    viewer: { seat: 1 },
    players: [
      {
        seat: 1,
        zones: {
          hand: { count: 1, cards: [{ name: 'Known card', visibility: 'known' }] },
          library: { count: 92 },
          battlefield: { cards: [] },
          graveyard: { cards: [] },
          exile: { cards: [] },
          command: { cards: [] }
        }
      },
      {
        seat: 2,
        zones: {
          hand: { count: 7 },
          library: { count: 91 },
          battlefield: { cards: [] },
          graveyard: { cards: [] },
          exile: { cards: [{ name: null, visibility: 'hidden' }] },
          command: { cards: [] }
        }
      }
    ],
    availableActions: {
      actions: [
        { id: 'pass-priority', category: 'PASS_PRIORITY', executable: true },
        {
          id: 'ability-land',
          category: 'PLAY_LAND',
          executable: true,
          requiresChoiceExpansion: false
        },
        { id: 'ability-1', category: 'CAST_SPELL', executable: false }
      ]
    }
  };
}

test('observation accepts viewer-only hidden information', () => {
  assert.deepEqual(observationErrors(observation()), []);
});

test('observation rejects opponent hand and library identities', () => {
  const sample = observation();
  sample.players[1].zones.hand.cards = [{ name: 'Leaked card' }];
  sample.players[1].zones.library.cards = [{ name: 'Leaked top card' }];
  assert.deepEqual(observationErrors(sample), [
    'seat 2: opponent hand identities were exposed',
    'seat 2: library identities were exposed'
  ]);
});

test('observation rejects unexpanded candidates marked executable', () => {
  const sample = observation();
  sample.availableActions.actions[2].executable = true;
  assert.deepEqual(observationErrors(sample), [
    'ability-1: unexpanded candidate must not be marked executable'
  ]);
});

test('observation accepts a completely expanded payment-and-target cast action', () => {
  const sample = observation();
  sample.availableActions.actions.push({
    id: 'cast-card-10-ability-20',
    category: 'CAST_SPELL',
    executable: true,
    requiresChoiceExpansion: false,
    choices: {
      targets: [{ kind: 'PLAYER', seat: 2 }],
      payment: {
        kind: 'MANA',
        manaCount: 1,
        mana: [{ color: 'R', sourceCardId: 'card-30' }]
      }
    }
  });
  assert.deepEqual(observationErrors(sample), []);
});

test('observation rejects duplicate action ids and reused simple mana sources', () => {
  const sample = observation();
  sample.availableActions.actions.push(
    { id: 'pass-priority', category: 'PASS_PRIORITY', executable: true },
    {
      id: 'cast-duplicate-source',
      category: 'CAST_SPELL',
      executable: true,
      requiresChoiceExpansion: false,
      choices: {
        targets: [{ kind: 'PLAYER', seat: 2 }],
        payment: {
          kind: 'MANA',
          manaCount: 2,
          mana: [
            { color: 'R', sourceCardId: 'card-30' },
            { color: 'R', sourceCardId: 'card-30' }
          ]
        }
      }
    }
  );
  assert.deepEqual(observationErrors(sample), [
    'pass-priority: duplicate action id',
    'cast-duplicate-source: a simple mana plan must not reuse a mana source'
  ]);
});

function v2Observation() {
  const sample = observation();
  sample.schemaVersion = 2;
  // v2 requires every capture to declare how its state was reached.
  sample.fixture = { kind: 'natural' };
  sample.availableActions.actions = [
    { id: 'pass-priority', category: 'PASS_PRIORITY', executable: true, unrepresentedChoices: [] }
  ];
  return sample;
}

function landChoice(value = 3) {
  return {
    code: 'OPTIONAL_LIFE_PAYMENT',
    decisionType: 'OPTIONAL_COST',
    source: { forgeCardId: 'card-97', name: 'Test Land', zone: 'Hand' },
    description: 'Enters tapped unless you pay life.',
    timing: 'ON_ENTER',
    optional: true,
    amount: { unit: 'LIFE', value },
    outcomes: ['PAY', 'DECLINE']
  };
}

test('A8: v2 rejects executable true while a choice is unrepresented', () => {
  const sample = v2Observation();
  sample.availableActions.actions.push({
    id: 'ability-1264',
    category: 'PLAY_LAND',
    executable: true,
    unrepresentedChoices: [landChoice()]
  });
  assert.deepEqual(observationErrors(sample), [
    'ability-1264: executable must be false because unrepresentedChoices has 1 entries'
  ]);
});

test('A9: v2 accepts a non-executable land play that v1 rejects', () => {
  const sample = v2Observation();
  const action = {
    id: 'ability-1264',
    category: 'PLAY_LAND',
    executable: false,
    unrepresentedChoices: [landChoice()]
  };
  sample.availableActions.actions.push(action);
  assert.deepEqual(observationErrors(sample), []);

  const asV1 = structuredClone(sample);
  asV1.schemaVersion = 1;
  asV1.availableActions.actions[1].requiresChoiceExpansion = false;
  assert.ok(
    observationErrors(asV1).includes(
      'ability-1264: a rule-valid land play must be a complete executable action'
    ),
    'the frozen v1 branch must still demand that every land play be executable'
  );
});

test('v2 requires an unrepresentedChoices array on every action', () => {
  const sample = v2Observation();
  sample.availableActions.actions.push({
    id: 'ability-1260',
    category: 'CAST_SPELL',
    executable: false
  });
  assert.deepEqual(observationErrors(sample), [
    'ability-1260: unrepresentedChoices must be an array'
  ]);
});

test('v2 rejects a free-form string choice', () => {
  const sample = v2Observation();
  sample.availableActions.actions.push({
    id: 'ability-1264',
    category: 'PLAY_LAND',
    executable: false,
    unrepresentedChoices: ['you may pay 3 life']
  });
  assert.deepEqual(observationErrors(sample), [
    'ability-1264: unrepresentedChoices[0] must be a structured object'
  ]);
});

test('v2 rejects a choice entry missing its required fields', () => {
  const sample = v2Observation();
  sample.availableActions.actions.push({
    id: 'ability-1264',
    category: 'PLAY_LAND',
    executable: false,
    unrepresentedChoices: [{ code: '', decisionType: 'VIBES', source: {}, description: '' }]
  });
  assert.deepEqual(observationErrors(sample), [
    'ability-1264: unrepresentedChoices[0] requires a non-empty code',
    'ability-1264: unrepresentedChoices[0] has an unknown decisionType: VIBES',
    'ability-1264: unrepresentedChoices[0] requires source.forgeCardId',
    'ability-1264: unrepresentedChoices[0] requires a non-empty description'
  ]);
});

test('v2 keeps the information boundary that v1 enforces', () => {
  const sample = v2Observation();
  sample.players[1].zones.hand.cards = [{ name: 'Leaked card' }];
  sample.players[1].zones.library.cards = [{ name: 'Leaked top card' }];
  assert.deepEqual(observationErrors(sample), [
    'seat 2: opponent hand identities were exposed',
    'seat 2: library identities were exposed'
  ]);
});

test('captured Ral priority-window example satisfies the information boundary', async () => {
  const captured = JSON.parse(await readFile(
    new URL('../examples/priority-observation-v1.json', import.meta.url),
    'utf8'
  ));
  assert.deepEqual(observationErrors(captured), []);
  assert.equal(captured.game.turn, 1);
  assert.equal(captured.game.phase, 'MAIN1');
  assert.equal(captured.viewer.seat, 1);
  assert.equal(captured.players.length, 4);
});

test('land transition requires the same card object to move zones', () => {
  const before = observation();
  before.players[0].zones.hand = {
    count: 1,
    cards: [{ id: 'card-10', name: 'Front Face', visibility: 'known' }]
  };
  before.players[0].zones.battlefield = { count: 0, cards: [] };
  before.game = { turn: 1, phase: 'MAIN1' };
  before.availableActions.actions[1].source = { name: 'Front Face' };

  const after = structuredClone(before);
  after.players[0].zones.hand = { count: 0, cards: [] };
  after.players[0].zones.battlefield = {
    count: 1,
    cards: [{ id: 'card-10', name: 'Back Face', visibility: 'known' }]
  };
  after.availableActions.actions = [after.availableActions.actions[0]];
  assert.deepEqual(landTransitionErrors(before, after, 'Front Face'), []);
});

test('captured Sink into Stupor land transition is valid', async () => {
  const [before, after] = await Promise.all([
    readFile(new URL('../examples/land-action-before-v1.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../examples/land-action-after-v1.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  assert.deepEqual(landTransitionErrors(before, after, 'Sink into Stupor'), []);
  const battlefield = after.players[0].zones.battlefield.cards;
  assert.equal(battlefield[0].name, 'Soporific Springs');
  assert.equal(battlefield[0].tapped, true);
});

test('spell transition requires hand, stack, and battlefield continuity', () => {
  const before = observation();
  before.players[0].zones.hand = {
    count: 1,
    cards: [{ id: 'card-20', name: 'Test Spell', visibility: 'known' }]
  };
  before.players[0].zones.battlefield = { count: 0, cards: [] };
  before.game = {
    turn: 1,
    phase: 'MAIN1',
    activePlayer: { seat: 1 },
    priorityPlayer: { seat: 1 },
    stack: []
  };

  const onStack = structuredClone(before);
  onStack.players[0].zones.hand = { count: 0, cards: [] };
  onStack.game.stack = [{
    source: 'Test Spell',
    sourceCardId: 'card-20',
    kind: 'spell'
  }];

  const resolved = structuredClone(onStack);
  resolved.game.stack = [];
  resolved.players[0].zones.battlefield = {
    count: 1,
    cards: [{ id: 'card-20', name: 'Test Spell', visibility: 'known' }]
  };
  assert.deepEqual(spellTransitionErrors(before, onStack, resolved, 'Test Spell'), []);
});

test('captured Mox Amber cast, stack, and resolution transition is valid', async () => {
  const [before, onStack, resolved] = await Promise.all([
    readFile(new URL('../examples/spell-action-before-v1.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../examples/spell-action-stack-v1.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../examples/spell-action-resolved-v1.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  assert.deepEqual(spellTransitionErrors(before, onStack, resolved, 'Mox Amber'), []);
  assert.equal(onStack.game.stack[0].source, 'Mox Amber');
  assert.equal(resolved.players[0].zones.battlefield.cards[0].name, 'Mox Amber');
});

test('captured Lava Dart payment, target, damage, and graveyard transition is valid', async () => {
  const [before, onStack, resolved] = await Promise.all([
    readFile(new URL('../examples/targeted-spell-before-v1.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../examples/targeted-spell-stack-v1.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../examples/targeted-spell-resolved-v1.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const options = {
    sourceName: 'Lava Dart',
    manaSourceName: 'Mountain',
    targetPlayerSeat: 2,
    alternativeManaSourceName: 'Great Furnace'
  };
  assert.deepEqual(targetedSpellTransitionErrors(before, onStack, resolved, options), []);
  assert.equal(before.actionContext.manaCost, '{R}');
  assert.equal(before.actionContext.expansionVersion, 1);
  assert.equal(onStack.game.stack[0].payment.mana[0].source, 'Mountain');
  assert.equal(before.players[1].life, 40);
  assert.equal(resolved.players[1].life, 39);

  const lavaDartActions = before.availableActions.actions.filter((action) =>
    action.category === 'CAST_SPELL'
      && action.source?.name === 'Lava Dart'
      && action.executable === true);
  assert.equal(lavaDartActions.length, 8);
  assert.deepEqual(
    [...new Set(lavaDartActions.map((action) => action.choices.targets[0].seat))],
    [1, 2, 3, 4]
  );
  assert.deepEqual(
    [...new Set(lavaDartActions.map((action) => action.choices.payment.mana[0].source))].sort(),
    ['Great Furnace', 'Mountain']
  );
  assert.equal(new Set(lavaDartActions.map((action) => action.id)).size, 8);

  const battlefield = onStack.players[0].zones.battlefield.cards;
  assert.equal(battlefield.find((card) => card.name === 'Mountain').tapped, true);
  assert.equal(battlefield.find((card) => card.name === 'Great Furnace').tapped, false);
});

/* ------------------------------------------------------------------ *
 * fixture provenance
 * ------------------------------------------------------------------ */

test('v2 requires a fixture declaring how the state was reached', () => {
  const sample = v2Observation();
  delete sample.fixture;
  assert.deepEqual(observationErrors(sample), ['fixture must be a structured object']);
});

test('v2 rejects an unknown fixture kind', () => {
  const sample = v2Observation();
  sample.fixture = { kind: 'improvised' };
  assert.deepEqual(observationErrors(sample), [
    'fixture.kind must be natural or staged, not improvised'
  ]);
});

test('v2 requires a staged fixture to record what was staged and how', () => {
  const sample = v2Observation();
  sample.fixture = { kind: 'staged', stagedCard: 'Test Land' };
  assert.deepEqual(observationErrors(sample), [
    'fixture.sourceZone is required for a staged capture',
    'fixture.cliArgument is required for a staged capture'
  ]);
});

test('v2 accepts a fully described staged fixture', () => {
  const sample = v2Observation();
  sample.fixture = {
    kind: 'staged',
    stagedCard: 'Test Land',
    sourceZone: 'Library',
    cliArgument: '--stage-into-hand Test Land'
  };
  assert.deepEqual(observationErrors(sample), []);
});

test('v2 forbids staged details on a capture claiming to be natural', () => {
  const sample = v2Observation();
  sample.fixture = { kind: 'natural', stagedCard: 'Test Land' };
  assert.deepEqual(observationErrors(sample), [
    'fixture.stagedCard must not appear on a natural capture'
  ]);
});

/* ------------------------------------------------------------------ *
 * semantic projection over a capture bundle
 * ------------------------------------------------------------------ */

const FROZEN = {
  land: 'examples/land-action-before-v1.json',
  landAfter: 'examples/land-action-after-v1.json',
  spell: 'examples/spell-action-before-v1.json'
};

async function frozen(key) {
  return JSON.parse(await readFile(new URL(`../${FROZEN[key]}`, import.meta.url), 'utf8'));
}

/** Shifts every Forge id by a constant, imitating cross-run counter drift. */
function driftIds(capture, offset) {
  const text = JSON.stringify(capture).replace(
    /"(card|ability|stack)-(\d+)"/g,
    (_, namespace, id) => `"${namespace}-${Number(id) + offset}"`
  );
  return JSON.parse(text);
}

test('the projection equates two real captures that differ only in Forge ids', async () => {
  // These two committed captures record the same seed in the same turn-one
  // first main phase and differ in exactly two lines, both ability ids.
  const [land, spell] = [await frozen('land'), await frozen('spell')];
  assert.notDeepEqual(land, spell, 'the fixtures must genuinely differ before normalization');
  assert.deepEqual(normalizeCaptureBundle([land]), normalizeCaptureBundle([spell]));
});

test('the projection absorbs whole-bundle id drift', async () => {
  const bundle = [await frozen('land'), await frozen('landAfter')];
  const drifted = bundle.map((capture) => driftIds(capture, 5000));
  assert.notDeepEqual(bundle, drifted);
  assert.deepEqual(normalizeCaptureBundle(bundle), normalizeCaptureBundle(drifted));
});

test('the projection preserves a genuine state difference', async () => {
  const bundle = [await frozen('land'), await frozen('landAfter')];
  const changed = structuredClone(bundle);
  const land = changed[1].players[0].zones.battlefield.cards[0];
  land.tapped = !land.tapped;
  assert.notDeepEqual(normalizeCaptureBundle(bundle), normalizeCaptureBundle(changed));
});

test('the projection preserves identity relationships across a bundle', async () => {
  // The land that left hand in the before capture is the land on the
  // battlefield in the after capture. Rewiring that to a different object must
  // survive normalization, or the same-object proof would be worthless.
  const bundle = [await frozen('land'), await frozen('landAfter')];
  const rewired = structuredClone(bundle);
  rewired[1].players[0].zones.battlefield.cards[0].id = 'card-99999';
  assert.notDeepEqual(normalizeCaptureBundle(bundle), normalizeCaptureBundle(rewired));
});

test('the projection leaves meaningful numbers alone', async () => {
  const bundle = [await frozen('land')];
  const [normalized] = normalizeCaptureBundle(bundle);
  assert.equal(normalized.viewer.seat, 1);
  assert.equal(normalized.players[0].life, bundle[0].players[0].life);
  assert.equal(normalized.game.turn, bundle[0].game.turn);
});
