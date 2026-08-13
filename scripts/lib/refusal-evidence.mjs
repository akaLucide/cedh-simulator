/**
 * Evidence rules for the spell-probe refusal check.
 *
 * Kept separate from the script that runs Forge so the rules themselves can be
 * tested. The alternative — proving the checker works by temporarily breaking
 * the production gate — would mean the only evidence that the verifier can fail
 * lives in someone's memory of having tried it once.
 *
 * Every function here is pure: it takes an already-collected observation of a
 * probe run and returns the reasons that run is not acceptable evidence.
 */

/** Mirrors `UnrepresentedChoiceException.EXIT_CODE`. */
export const REFUSED_EXIT_CODE = 3;

const TYPED_REFUSAL = 'PROBE_REFUSED_WITH=UnrepresentedChoiceException';

function zoneCards(player, zone) {
  return player?.zones?.[zone]?.cards ?? [];
}

/**
 * Checks that a spell-guard run really refused, and refused for the right reason.
 *
 * A refusal is only meaningful if the action never happened, so absence of the
 * later captures is part of the evidence. The caller must empty the output
 * directory first — otherwise "no stack capture" could just mean nobody has run
 * the probe since the last clean checkout, which proves nothing.
 *
 * The final check ties the refusal to the published capture. The gate and the
 * observation writer reach their verdicts through separate calls to the shared
 * audit, so this is what confirms they agreed about this specific action rather
 * than merely both existing.
 */
export function spellGuardEvidenceErrors({
  exitCode,
  output = '',
  beforeCapture,
  stackCaptureExists,
  resolvedCaptureExists,
  sourceName
}) {
  const errors = [];

  if (exitCode !== REFUSED_EXIT_CODE) {
    errors.push(
      exitCode === 0
        ? `the probe executed the action instead of refusing it (exit ${exitCode})`
        : `expected the refusal exit code ${REFUSED_EXIT_CODE}, got ${exitCode}`
    );
  }
  if (!output.includes(TYPED_REFUSAL)) {
    errors.push('expected a typed UnrepresentedChoiceException refusal');
  }
  if (stackCaptureExists) {
    errors.push('a refused cast must not produce a stack capture');
  }
  if (resolvedCaptureExists) {
    errors.push('a refused cast must not produce a resolved capture');
  }

  if (typeof beforeCapture !== 'object' || beforeCapture === null) {
    errors.push('the probe did not write a before-capture');
    return errors;
  }

  const viewer = beforeCapture.players?.find(
    (player) => player.seat === beforeCapture.viewer?.seat
  );
  if (!viewer) {
    errors.push('the before-capture has no viewer player');
    return errors;
  }

  if (!zoneCards(viewer, 'hand').some((card) => card.name === sourceName)) {
    errors.push(`${sourceName} must still be in hand after the refusal`);
  }
  for (const zone of ['battlefield', 'graveyard']) {
    if (zoneCards(viewer, zone).some((card) => card.name === sourceName)) {
      errors.push(`${sourceName} must not have reached the ${zone}`);
    }
  }
  if ((beforeCapture.game?.stack ?? []).some((item) => item.source === sourceName)) {
    errors.push(`${sourceName} must not have reached the stack`);
  }

  const action = (beforeCapture.availableActions?.actions ?? []).find(
    (entry) => entry.category === 'CAST_SPELL' && entry.source?.name === sourceName
  );
  if (!action) {
    errors.push(`expected a published CAST_SPELL action for ${sourceName}`);
    return errors;
  }
  if (action.executable !== false) {
    errors.push(`the published ${sourceName} action must be non-executable`);
  }
  const codes = (action.unrepresentedChoices ?? []).map((choice) => choice.code);
  if (codes.length === 0) {
    errors.push(`the published ${sourceName} action must carry at least one unrepresented choice`);
  } else if (!codes.some((code) => output.includes(code))) {
    // Without this, the run could refuse one action while publishing another.
    errors.push(
      `the refusal must name a choice the capture published for ${sourceName} `
      + `(published ${codes.join(', ')})`
    );
  }

  return errors;
}
