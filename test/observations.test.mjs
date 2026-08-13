import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  landTransitionErrors,
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
