import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForgeDecks } from './lib/decks.mjs';
import { assertPinnedForgeDistribution } from './lib/forge-preflight.mjs';
import { REFUSED_EXIT_CODE, spellGuardEvidenceErrors } from './lib/refusal-evidence.mjs';

/**
 * Verifies the refusal paths that keep an unrepresented decision from
 * reaching stock Forge AI.
 *
 * Both underlying probes are *supposed* to fail: they end by throwing
 * `UnrepresentedChoiceException`, so a nonzero Java exit is the expected
 * outcome, not a passing result. This wrapper is what converts that into a
 * verdict — it exits 0 only when every piece of expected evidence is present,
 * and nonzero if the probe unexpectedly succeeded, threw something else, or left
 * the wrong artifacts behind.
 *
 *   --mode guard  (A3) the production gate refuses before Forge is called
 *   --mode fault  (A4) with the gate bypassed, the decision hook itself throws
 *   --mode spell       an unaudited cast is refused before it reaches the stack
 *
 * The `spell` evidence rules live in ./lib/refusal-evidence.mjs so they can be
 * tested directly, rather than by breaking the production gate to see whether
 * this script notices.
 */

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const mode = option('--mode');
if (mode !== 'guard' && mode !== 'fault' && mode !== 'spell') {
  throw new Error(
    'Usage: --mode <guard|fault|spell> --forge-root <path> --source <card> [--seed n] [--seat n]'
  );
}
const forgeRootOption = option('--forge-root');
if (!forgeRootOption) throw new Error('--forge-root is required');
const sourceName = option('--source');
if (!sourceName) throw new Error('--source is required');

const seed = Number(option('--seed', '20260812'));
const seat = Number(option('--seat', '1'));
const timeoutSeconds = Number(option('--timeout', '180'));

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDirectory);
const forgeRoot = path.resolve(forgeRootOption);
const workDirectory = path.join(projectRoot, `build/refusal-${mode}`);
const beforeOutput = path.join(workDirectory, 'before.json');
const afterOutput = path.join(workDirectory, 'after.json');
const stackOutput = path.join(workDirectory, 'stack.json');
const resolvedOutput = path.join(workDirectory, 'resolved.json');
const deckOutput = path.join(projectRoot, 'build/forge-decks');
const classes = path.join(projectRoot, 'spike/build/classes');

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function jarCandidates(directory) {
  try {
    return (await readdir(directory))
      .filter((name) => name.startsWith('forge-gui-desktop-'))
      .filter((name) => name.endsWith('-jar-with-dependencies.jar'))
      .map((name) => path.join(directory, name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

const decks = await buildForgeDecks(projectRoot, deckOutput);
const jarCandidateList = [
  ...await jarCandidates(forgeRoot),
  ...await jarCandidates(path.join(forgeRoot, 'forge-gui-desktop/target'))
].sort();
if (jarCandidateList.length === 0) throw new Error(`Forge desktop build not found in ${forgeRoot}`);
const jar = jarCandidateList.at(-1);
const forgeBuild = await assertPinnedForgeDistribution(forgeRoot, jar);
console.log(`Forge build verified: ${path.basename(jar)} (${forgeBuild.cardScripts})`);

// A stale after-capture would make "the action never executed" unfalsifiable.
await rm(workDirectory, { recursive: true, force: true });
await mkdir(workDirectory, { recursive: true });
await mkdir(classes, { recursive: true });

const sourceDirectory = path.join(projectRoot, 'spike/src/main/java/cedh/sim');
const sources = (await readdir(sourceDirectory))
  .filter((file) => file.endsWith('.java'))
  .map((file) => path.join(sourceDirectory, file));
const compilation = spawnSync('java', [
  '-m', 'jdk.compiler/com.sun.tools.javac.Main',
  '-cp', jar,
  '-d', classes,
  ...sources
], { stdio: 'inherit' });
if (compilation.status !== 0) {
  throw new Error(`Adapter compilation failed with exit code ${compilation.status}`);
}

const mainClass = mode === 'guard'
  ? 'cedh.sim.LandActionProbeMain'
  : mode === 'fault'
    ? 'cedh.sim.ChoiceHookFaultProbeMain'
    : 'cedh.sim.SpellActionProbeMain';

const outputArgs = mode === 'spell'
  ? ['--before', beforeOutput, '--stack', stackOutput, '--resolved', resolvedOutput]
  : ['--before', beforeOutput, '--after', afterOutput];

const probe = spawnSync('java', [
  '-Xmx4096m',
  '-Dfile.encoding=UTF-8',
  '-cp', `${classes}${path.delimiter}${jar}`,
  mainClass,
  '--deck-directory', deckOutput,
  ...decks.flatMap((deck) => ['--deck', deck.output]),
  '--seat', String(seat),
  '--seed', String(seed),
  '--phase', 'MAIN1',
  '--source', sourceName,
  ...outputArgs
], { cwd: forgeRoot, encoding: 'utf8', timeout: timeoutSeconds * 1000, maxBuffer: 64 * 1024 * 1024 });

const output = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
process.stdout.write(output);

const failures = [];
const require = (condition, message) => {
  if (!condition) failures.push(message);
};

if (mode === 'spell') {
  // Delegated wholesale to the tested rules. The work directory was emptied
  // above, so an absent stack or resolved capture is a fact about this run.
  failures.push(...spellGuardEvidenceErrors({
    exitCode: probe.status,
    output,
    beforeCapture: await exists(beforeOutput)
      ? JSON.parse(await readFile(beforeOutput, 'utf8'))
      : undefined,
    stackCaptureExists: await exists(stackOutput),
    resolvedCaptureExists: await exists(resolvedOutput),
    sourceName
  }));
} else {
  require(
    probe.status === REFUSED_EXIT_CODE,
    `expected the probe to refuse with exit code ${REFUSED_EXIT_CODE}, got ${probe.status}`
  );
  require(
    output.includes('PROBE_REFUSED_WITH=UnrepresentedChoiceException'),
    'expected the refusal to be an UnrepresentedChoiceException'
  );
  require(!await exists(afterOutput), 'the refused action must not produce an after-capture');
}

if (mode === 'guard') {
  require(
    output.includes('PROBE_HOOK_INVOCATIONS=0'),
    'the production gate must refuse before Forge reaches the decision hook'
  );
  require(
    !output.includes('PROBE_GATE_BYPASSED'),
    'the production path must not bypass the pre-execution gate'
  );

  const before = JSON.parse(await readFile(beforeOutput, 'utf8'));
  const player = before.players.find((entry) => entry.seat === seat);
  require(
    player.zones.hand.cards.some((card) => card.name === sourceName),
    `${sourceName} must still be in hand after the refusal`
  );
  require(
    !player.zones.battlefield.cards.some((card) => card.name === sourceName),
    `${sourceName} must not have reached the battlefield`
  );
  const action = before.availableActions.actions.find(
    (entry) => entry.category === 'PLAY_LAND' && entry.source?.name === sourceName
  );
  require(action !== undefined, `expected a PLAY_LAND action for ${sourceName}`);
  require(action?.executable === false, 'the refused land action must be non-executable');
  require(
    (action?.unrepresentedChoices ?? []).length > 0,
    'the refused land action must carry at least one unrepresented choice'
  );
} else if (mode === 'fault') {
  require(
    output.includes('PROBE_GATE_BYPASSED'),
    'the fault probe must deliberately bypass the pre-execution gate'
  );
  require(
    output.includes('PROBE_HOOK_INVOCATIONS=1'),
    'the bypassed run must reach the decision hook exactly once'
  );
  require(
    output.includes('.payCostToPreventEffect('),
    'the refusal must originate in payCostToPreventEffect'
  );
  require(
    output.includes('AbilityUtils.handleUnlessCost'),
    'Forge must genuinely have asked the optional-payment question'
  );
}

if (failures.length > 0) {
  console.error(`\n${mode.toUpperCase()} VERIFICATION FAILED:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

const SUCCESS = {
  guard: `\nA3 verified: ${sourceName} was refused before Forge was called `
    + '(hook invocations 0, no after-capture).',
  fault: '\nA4 verified: with the gate bypassed, payCostToPreventEffect threw '
    + 'UnrepresentedChoiceException from AbilityUtils.handleUnlessCost instead of '
    + 'returning a stock-AI answer.',
  spell: `\nSpell guard verified: ${sourceName} was refused before reaching the stack; `
    + 'it is still in hand, no stack or resolved capture was produced, and the refusal '
    + 'names a choice the capture published for that same action.'
};
console.log(SUCCESS[mode]);
