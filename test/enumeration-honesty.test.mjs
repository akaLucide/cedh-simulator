import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPANDED_ACTION_FIELD_CLASSES,
  expandedActionFieldErrors,
  observationErrors,
  semanticExpandedActionSequence,
  simpleSpellExpansionErrors
} from '../scripts/lib/observations.mjs';
import { schemaErrors } from '../scripts/lib/schema.mjs';

/**
 * v3 enumeration honesty.
 *
 * The schema and the hand-written validator are tested separately and must be
 * able to reject independently: JSON Schema owns shape and the four mutually
 * exclusive branches, the validator owns arithmetic and cross-record
 * relationships that JSON Schema cannot express. Stock Ajv checks none of the
 * sums below.
 */

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function expansion(overrides = {}) {
  return {
    attempted: true,
    suppressedReason: null,
    complete: true,
    truncated: false,
    actionLimit: 512,
    emittedActionCount: 8,
    totalCapacity: 8,
    omittedActionCount: 0,
    omittedActionCountAtLeast: 0,
    candidateScanComplete: true,
    candidateUnitsMayBeUninspected: false,
    inspectedAbilities: [
      {
        unit: 'SPELL_ABILITY',
        sourceCardId: 'card-75',
        abilityId: 'ability-1273',
        source: { id: 'card-75', name: 'Test Spell', visibility: 'known' },
        outcome: 'EXPANDED',
        targetCount: 4,
        planCount: 2,
        capacity: 8,
        emittedActionCount: 8,
        omittedActionCount: 0
      }
    ],
    uninspectedSourceCards: [],
    manaSourceExclusions: [],
    skippedCandidates: {},
    ...overrides
  };
}

/** Eight actions matching the default expansion's emitted count. */
function actions(count = 8) {
  return Array.from({ length: count }, (unused, index) => ({
    id: `cast-card-75-ability-1273-target-player-${index}-pay-card98a274r`,
    expansionVersion: 1
  }));
}

test('a consistent expansion produces no errors', () => {
  assert.deepEqual(simpleSpellExpansionErrors(expansion(), actions()), []);
});

/* ---------------- arithmetic the schema cannot express ---------------- */

test('capacity must equal targetCount * planCount', () => {
  const sample = expansion();
  sample.inspectedAbilities[0].planCount = 3;
  const errors = simpleSpellExpansionErrors(sample, actions());
  assert.ok(errors.some((e) => e.includes('capacity must equal targetCount * planCount')), errors.join('; '));
});

test('per-record omission must equal capacity minus emitted', () => {
  const sample = expansion();
  sample.inspectedAbilities[0].omittedActionCount = 5;
  const errors = simpleSpellExpansionErrors(sample, actions());
  assert.ok(errors.some((e) => e.includes('omittedActionCount must equal capacity')), errors.join('; '));
});

test('totalCapacity must equal the sum over inspected abilities', () => {
  const sample = expansion({ totalCapacity: 99, omittedActionCount: 91 });
  const errors = simpleSpellExpansionErrors(sample, actions());
  assert.ok(errors.some((e) => e.includes('totalCapacity must equal')), errors.join('; '));
});

test('per-ability emitted counts must sum to emittedActionCount', () => {
  const sample = expansion();
  sample.inspectedAbilities[0].emittedActionCount = 6;
  sample.inspectedAbilities[0].omittedActionCount = 2;
  const errors = simpleSpellExpansionErrors(sample, actions());
  assert.ok(errors.some((e) => e.includes('per-ability emitted counts sum to 6')), errors.join('; '));
});

test('the action array length must match emittedActionCount', () => {
  const errors = simpleSpellExpansionErrors(expansion(), actions(7));
  assert.ok(
    errors.some((e) => e.includes('does not match 7 expanded actions')),
    errors.join('; ')
  );
});

test('omittedActionCountAtLeast must sum over inspected units only', () => {
  const sample = expansion({ omittedActionCountAtLeast: 3 });
  const errors = simpleSpellExpansionErrors(sample, actions());
  assert.ok(errors.some((e) => e.includes('omittedActionCountAtLeast must equal 0')), errors.join('; '));
});

test('a skipped ability must not carry capacity or emitted counts', () => {
  const sample = expansion();
  sample.inspectedAbilities.push({
    unit: 'SPELL_ABILITY',
    sourceCardId: 'card-90',
    abilityId: 'ability-9',
    source: { id: 'card-90', name: 'Skipped', visibility: 'known' },
    outcome: 'SKIPPED',
    reason: 'no-supported-mana-plan',
    capacity: 4,
    emittedActionCount: 0
  });
  const errors = simpleSpellExpansionErrors(sample, actions());
  assert.ok(errors.some((e) => e.includes('must not carry capacity')), errors.join('; '));
});

/* ---------------- impossible state mixtures ---------------- */

test('complete cannot be true while truncated', () => {
  const errors = simpleSpellExpansionErrors(expansion({ truncated: true }), actions());
  assert.ok(errors.some((e) => e.includes('complete must be false')), errors.join('; '));
});

test('complete cannot be true when the candidate scan did not finish', () => {
  const errors = simpleSpellExpansionErrors(
    expansion({ candidateScanComplete: false, candidateUnitsMayBeUninspected: true }),
    actions()
  );
  assert.ok(errors.some((e) => e.includes('complete must be false')), errors.join('; '));
});

test('an incomplete scan must not claim a known totalCapacity', () => {
  const errors = simpleSpellExpansionErrors(
    expansion({ complete: false, candidateScanComplete: false, candidateUnitsMayBeUninspected: true }),
    actions()
  );
  assert.ok(errors.some((e) => e.includes('totalCapacity must be null')), errors.join('; '));
});

test('candidateUnitsMayBeUninspected must invert candidateScanComplete', () => {
  const errors = simpleSpellExpansionErrors(
    expansion({ candidateUnitsMayBeUninspected: true }),
    actions()
  );
  assert.ok(errors.some((e) => e.includes('must be the inverse')), errors.join('; '));
});

test('an unattempted expansion cannot have inspected abilities', () => {
  const errors = simpleSpellExpansionErrors(
    expansion({ attempted: false, complete: false }),
    actions()
  );
  assert.ok(errors.some((e) => e.includes('unattempted expansion cannot have inspected')), errors.join('; '));
});

/* ---------------- excluded mana abilities ---------------- */

test('an exclusion needs at least two producible colours, sorted', () => {
  const sample = expansion({
    manaSourceExclusions: [{
      unit: 'MANA_ABILITY',
      outcome: 'EXCLUDED',
      sourceCardId: 'card-62',
      manaAbilityId: 'ability-175',
      source: { id: 'card-62', name: 'Any Colour Land', visibility: 'known' },
      reason: 'mana-source-with-selectable-colour',
      producibleColors: ['U', 'R']
    }]
  });
  const errors = simpleSpellExpansionErrors(sample, actions());
  assert.ok(errors.some((e) => e.includes('lexicographically sorted')), errors.join('; '));
});

test('an excluded mana ability must not also be an inspected spell ability', () => {
  const sample = expansion({
    manaSourceExclusions: [{
      unit: 'MANA_ABILITY',
      outcome: 'EXCLUDED',
      sourceCardId: 'card-62',
      manaAbilityId: 'ability-1273',
      source: { id: 'card-62', name: 'Any Colour Land', visibility: 'known' },
      reason: 'mana-source-with-selectable-colour',
      producibleColors: ['R', 'U']
    }]
  });
  const errors = simpleSpellExpansionErrors(sample, actions());
  assert.ok(errors.some((e) => e.includes('must not also be an inspected')), errors.join('; '));
});

test('exclusions never contribute to capacity or omission arithmetic', () => {
  // Adding an exclusion must leave every count untouched: an excluded path is
  // outside the boundary, not missing from inside it.
  const withExclusion = expansion({
    manaSourceExclusions: [{
      unit: 'MANA_ABILITY',
      outcome: 'EXCLUDED',
      sourceCardId: 'card-62',
      manaAbilityId: 'ability-175',
      source: { id: 'card-62', name: 'Any Colour Land', visibility: 'known' },
      reason: 'mana-source-with-selectable-colour',
      producibleColors: ['R', 'U']
    }]
  });
  assert.deepEqual(simpleSpellExpansionErrors(withExclusion, actions()), []);
});

/* ---------------- schema branches ---------------- */

async function v3Capture() {
  return JSON.parse(await readFile(path.join(projectRoot, 'examples/priority-observation-v3.json'), 'utf8'));
}

test('the committed v3 captures satisfy schema and validator', async () => {
  for (const file of ['examples/priority-observation-v3.json', 'examples/targeted-spell-before-v3.json']) {
    const capture = JSON.parse(await readFile(path.join(projectRoot, file), 'utf8'));
    assert.equal(capture.schemaVersion, 3, file);
    assert.deepEqual(await schemaErrors(capture), [], `${file} failed the schema`);
    assert.deepEqual(observationErrors(capture), [], `${file} failed the validator`);
  }
});

test('the schema rejects a complete expansion that is also truncated', async () => {
  const capture = await v3Capture();
  capture.availableActions.simpleSpellExpansion.complete = true;
  capture.availableActions.simpleSpellExpansion.truncated = true;
  assert.notDeepEqual(await schemaErrors(capture), []);
});

test('the schema rejects a complete expansion with a null totalCapacity', async () => {
  const capture = await v3Capture();
  const sample = capture.availableActions.simpleSpellExpansion;
  Object.assign(sample, {
    attempted: true, complete: true, truncated: false,
    candidateScanComplete: true, candidateUnitsMayBeUninspected: false,
    totalCapacity: null, omittedActionCount: null
  });
  assert.notDeepEqual(await schemaErrors(capture), []);
});

test('the schema rejects an unattempted expansion that emitted actions', async () => {
  const capture = await v3Capture();
  capture.availableActions.simpleSpellExpansion.emittedActionCount = 3;
  assert.notDeepEqual(await schemaErrors(capture), []);
});

test('the schema rejects a suppressed expansion claiming completeness', async () => {
  const capture = await v3Capture();
  Object.assign(capture.availableActions.simpleSpellExpansion, {
    attempted: true, suppressedReason: 'floating-mana-not-supported', complete: true
  });
  assert.notDeepEqual(await schemaErrors(capture), []);
});

test('the schema rejects an expanded inspected ability carrying a skip reason', async () => {
  const capture = JSON.parse(
    await readFile(path.join(projectRoot, 'examples/targeted-spell-before-v3.json'), 'utf8')
  );
  const record = capture.availableActions.simpleSpellExpansion.inspectedAbilities
    .find((entry) => entry.outcome === 'EXPANDED');
  record.reason = 'should-not-be-here';
  assert.notDeepEqual(await schemaErrors(capture), []);
});

/* ---------------- field classification and projection ---------------- */

test('every expanded-action field in the committed capture is classified', async () => {
  const capture = JSON.parse(
    await readFile(path.join(projectRoot, 'examples/targeted-spell-before-v3.json'), 'utf8')
  );
  assert.deepEqual(expandedActionFieldErrors(capture.availableActions.actions), []);
});

test('an unclassified expanded-action field is rejected', () => {
  const errors = expandedActionFieldErrors([
    { id: 'cast-1', expansionVersion: 1, somethingNew: true }
  ]);
  assert.ok(errors.some((e) => e.includes('unclassified')), errors.join('; '));
});

test('debug identity fields are dropped by the projection, semantic ones kept', async () => {
  const capture = JSON.parse(
    await readFile(path.join(projectRoot, 'examples/targeted-spell-before-v3.json'), 'utf8')
  );
  const [first] = semanticExpandedActionSequence(capture);
  for (const [field, kind] of Object.entries(EXPANDED_ACTION_FIELD_CLASSES)) {
    if (kind !== 'DEBUG_IDENTITY') continue;
    assert.ok(!Object.hasOwn(first, field), `${field} is debug-only and must not survive projection`);
  }
  assert.equal(first.category, 'CAST_SPELL');
  assert.equal(first.executable, true);
});

test('the projection preserves order rather than sorting it away', async () => {
  const capture = JSON.parse(
    await readFile(path.join(projectRoot, 'examples/targeted-spell-before-v3.json'), 'utf8')
  );
  const reordered = structuredClone(capture);
  const list = reordered.availableActions.actions;
  const expanded = list.filter((action) => action.expansionVersion !== undefined);
  // Swap two expanded actions; a comparison that sorted would miss this.
  const [a, b] = [list.indexOf(expanded[0]), list.indexOf(expanded[1])];
  [list[a], list[b]] = [list[b], list[a]];
  assert.notDeepEqual(
    semanticExpandedActionSequence(capture),
    semanticExpandedActionSequence(reordered)
  );
});

test('the projection ignores raw Forge id drift', async () => {
  const capture = JSON.parse(
    await readFile(path.join(projectRoot, 'examples/targeted-spell-before-v3.json'), 'utf8')
  );
  // Drift must be applied to every encoding, including the hyphenated and
  // compacted segments inside composite action ids. Rewriting only the standalone
  // fields would make the two captures genuinely inconsistent rather than drifted.
  const drifted = JSON.parse(
    JSON.stringify(capture)
      .replace(/\b(card|ability|stack)-(\d+)/g,
        (unused, namespace, id) => `${namespace}-${Number(id) + 7000}`)
      .replace(/\bcard(\d+)a(\d+)/g,
        (unused, card, ability) => `card${Number(card) + 7000}a${Number(ability) + 7000}`)
  );
  assert.deepEqual(
    semanticExpandedActionSequence(capture),
    semanticExpandedActionSequence(drifted)
  );
});
