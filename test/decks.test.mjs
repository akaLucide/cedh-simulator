import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyApprovedOverrides,
  assertOpponentApprovals,
  frontFaceName,
  parsePlainDeck,
  renderForgeDeck
} from '../scripts/lib/decks.mjs';

test('frontFaceName keeps the playable front face', () => {
  assert.equal(frontFaceName('Ral, Monsoon Mage / Ral, Leyline Prodigy'), 'Ral, Monsoon Mage');
  assert.equal(frontFaceName("Kraum, Ludevic's Opus"), "Kraum, Ludevic's Opus");
});

test('approved Goblin override is explicit', () => {
  const filler = Array.from({ length: 99 }, (_, index) => `1 Card ${index}`).join('\n');
  const parsed = parsePlainDeck(`1 _____ Goblin\n${filler}`, 'test-deck');
  const cards = applyApprovedOverrides(parsed, {
    substitutions: [{
      requestedName: '_____ Goblin',
      engineName: '"Name Sticker" Goblin',
      approved: true
    }]
  });
  assert.equal(cards[0].engineName, '"Name Sticker" Goblin');
  assert.equal(cards[0].substituted, true);
});

test('unapproved opponent pool is rejected', () => {
  assert.throws(
    () => assertOpponentApprovals({ decks: [] }),
    /not approved and enabled/
  );
});

test('Forge renderer separates the commander from the main deck', () => {
  const cards = [
    { quantity: 1, engineName: 'Commander' },
    { quantity: 99, engineName: 'Island' }
  ];
  const rendered = renderForgeDeck('test', ['Commander'], cards);
  assert.match(rendered, /\[Commander\]\n1 Commander\n\[Main\]\n99 Island/);
});
