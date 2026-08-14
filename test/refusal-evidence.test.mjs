import test from 'node:test';
import assert from 'node:assert/strict';
import { REFUSED_EXIT_CODE, spellGuardEvidenceErrors } from '../scripts/lib/refusal-evidence.mjs';

/**
 * Proves the spell-guard verifier rejects.
 *
 * A checker that has only ever seen the passing case is not evidence of
 * anything. These drive the rules with synthetic runs so every rejection path is
 * exercised on every `npm test`, rather than by breaking the production gate by
 * hand and trusting the result was noticed.
 */

const SOURCE = 'Test Spell';
const CHOICE_CODE = 'UNSUPPORTED_ACTION_EXPANSION';

/** A run that refused exactly as designed. */
function validRun(overrides = {}) {
  return {
    exitCode: REFUSED_EXIT_CODE,
    output: `PROBE_REFUSED_WITH=UnrepresentedChoiceException\n  - ${CHOICE_CODE} [UNKNOWN] ${SOURCE}`,
    stackCaptureExists: false,
    resolvedCaptureExists: false,
    sourceName: SOURCE,
    beforeCapture: {
      viewer: { seat: 1 },
      game: { stack: [] },
      players: [
        {
          seat: 1,
          zones: {
            hand: { cards: [{ id: 'card-1', name: SOURCE }] },
            battlefield: { cards: [] },
            graveyard: { cards: [] }
          }
        }
      ],
      availableActions: {
        actions: [
          {
            id: 'ability-1',
            category: 'CAST_SPELL',
            source: { name: SOURCE },
            executable: false,
            unrepresentedChoices: [{ code: CHOICE_CODE }]
          }
        ]
      }
    },
    ...overrides
  };
}

/** Applies a mutation to the before-capture of an otherwise valid run. */
function withCapture(mutate) {
  const run = validRun();
  mutate(run.beforeCapture);
  return run;
}

test('a correctly refused run produces no errors', () => {
  assert.deepEqual(spellGuardEvidenceErrors(validRun()), []);
});

test('an unexpected success is rejected', () => {
  const errors = spellGuardEvidenceErrors(validRun({ exitCode: 0 }));
  assert.ok(
    errors.some((error) => error.includes('executed the action instead of refusing')),
    errors.join('; ')
  );
});

test('a wrong exit code is rejected', () => {
  const errors = spellGuardEvidenceErrors(validRun({ exitCode: 1 }));
  assert.ok(errors.some((error) => error.includes('refusal exit code')), errors.join('; '));
});

test('an untyped or wrong exception is rejected', () => {
  const errors = spellGuardEvidenceErrors(validRun({
    output: 'Exception in thread "main" java.lang.IllegalStateException: boom'
  }));
  assert.ok(errors.some((error) => error.includes('typed')), errors.join('; '));
});

test('a stack capture is rejected', () => {
  const errors = spellGuardEvidenceErrors(validRun({ stackCaptureExists: true }));
  assert.ok(errors.some((error) => error.includes('stack capture')), errors.join('; '));
});

test('a resolved capture is rejected', () => {
  const errors = spellGuardEvidenceErrors(validRun({ resolvedCaptureExists: true }));
  assert.ok(errors.some((error) => error.includes('resolved capture')), errors.join('; '));
});

test('a missing before-capture is rejected', () => {
  const errors = spellGuardEvidenceErrors(validRun({ beforeCapture: undefined }));
  assert.deepEqual(errors, ['the probe did not write a before-capture']);
});

test('the source leaving hand is rejected', () => {
  const errors = spellGuardEvidenceErrors(withCapture((capture) => {
    capture.players[0].zones.hand.cards = [];
  }));
  assert.ok(errors.some((error) => error.includes('still be in hand')), errors.join('; '));
});

test('the source appearing on the battlefield is rejected', () => {
  const errors = spellGuardEvidenceErrors(withCapture((capture) => {
    capture.players[0].zones.battlefield.cards = [{ id: 'card-1', name: SOURCE }];
  }));
  assert.ok(errors.some((error) => error.includes('battlefield')), errors.join('; '));
});

test('the source appearing in the graveyard is rejected', () => {
  const errors = spellGuardEvidenceErrors(withCapture((capture) => {
    capture.players[0].zones.graveyard.cards = [{ id: 'card-1', name: SOURCE }];
  }));
  assert.ok(errors.some((error) => error.includes('graveyard')), errors.join('; '));
});

test('the source appearing on the stack is rejected', () => {
  const errors = spellGuardEvidenceErrors(withCapture((capture) => {
    capture.game.stack = [{ id: 'stack-1', source: SOURCE }];
  }));
  assert.ok(errors.some((error) => error.includes('stack')), errors.join('; '));
});

test('a missing published action is rejected', () => {
  const errors = spellGuardEvidenceErrors(withCapture((capture) => {
    capture.availableActions.actions = [];
  }));
  assert.ok(errors.some((error) => error.includes('expected a published')), errors.join('; '));
});

test('a published action marked executable is rejected', () => {
  const errors = spellGuardEvidenceErrors(withCapture((capture) => {
    capture.availableActions.actions[0].executable = true;
  }));
  assert.ok(errors.some((error) => error.includes('non-executable')), errors.join('; '));
});

test('a published action with an empty choice list is rejected', () => {
  const errors = spellGuardEvidenceErrors(withCapture((capture) => {
    capture.availableActions.actions[0].unrepresentedChoices = [];
  }));
  assert.ok(
    errors.some((error) => error.includes('at least one unrepresented choice')),
    errors.join('; ')
  );
});

test('a refusal naming a different choice than the capture published is rejected', () => {
  // Guards against refusing one action while publishing another as the evidence.
  const errors = spellGuardEvidenceErrors(withCapture((capture) => {
    capture.availableActions.actions[0].unrepresentedChoices = [{ code: 'SOME_OTHER_CODE' }];
  }));
  assert.ok(
    errors.some((error) => error.includes('must name a choice the capture published')),
    errors.join('; ')
  );
});
