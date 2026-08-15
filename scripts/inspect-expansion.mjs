import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForgeDecks } from './lib/decks.mjs';
import { assertPinnedForgeDistribution } from './lib/forge-preflight.mjs';
import {
  assertReproducibleBundles,
  assertValidObservation,
  isExpandedAction
} from './lib/observations.mjs';
import { schemaErrors } from './lib/schema.mjs';

/**
 * Publishes and checks one enumeration inspection.
 *
 * The boundaries this milestone adds are refusals, so the evidence is an action
 * that is *not* emitted. This driver stages a state, runs the expander through
 * the inspection probe, validates the resulting v3 capture against both the
 * schema and the hand-written validator, and asserts the expected exclusions.
 */

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function options(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] === name && process.argv[index + 1] !== undefined) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

const forgeRootOption = option('--forge-root');
if (!forgeRootOption) throw new Error('--forge-root is required');
const label = option('--label', 'expansion');
const seed = Number(option('--seed', '20260812'));
const seat = Number(option('--seat', '1'));
const repeat = Number(option('--repeat', '2'));
const timeoutSeconds = Number(option('--timeout', '300'));
const stagedHand = options('--stage-hand');
const stagedBattlefield = options('--stage-battlefield');
const produceMana = option('--produce-mana');
const expectExclusionFor = options('--expect-exclusion-for');
const expectSkipped = options('--expect-skipped');
const expectNoExpandedFor = options('--expect-no-expanded-for');
const expectSuppressed = option('--expect-suppressed');
const expectAttempted = option('--expect-attempted');
const outputOption = option('--output');

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDirectory);
const forgeRoot = path.resolve(forgeRootOption);
const workDirectory = path.join(projectRoot, `build/inspect-${label}`);
const deckOutput = path.join(projectRoot, 'build/forge-decks');
const classes = path.join(projectRoot, 'spike/build/classes');

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
const candidates = [
  ...await jarCandidates(forgeRoot),
  ...await jarCandidates(path.join(forgeRoot, 'forge-gui-desktop/target'))
].sort();
if (candidates.length === 0) throw new Error(`Forge desktop build not found in ${forgeRoot}`);
const jar = candidates.at(-1);
const build = await assertPinnedForgeDistribution(forgeRoot, jar);
console.log(`Forge build verified: ${path.basename(jar)} (${build.cardScripts})`);

// Only this probe's own directory is cleaned, so an absent artifact is a fact
// about this run rather than about a clean checkout.
await rm(workDirectory, { recursive: true, force: true });
await mkdir(workDirectory, { recursive: true });
await mkdir(classes, { recursive: true });

const sourceDirectory = path.join(projectRoot, 'spike/src/main/java/cedh/sim');
const sources = (await readdir(sourceDirectory))
  .filter((file) => file.endsWith('.java'))
  .map((file) => path.join(sourceDirectory, file));
const compilation = spawnSync('java', [
  '-m', 'jdk.compiler/com.sun.tools.javac.Main', '-cp', jar, '-d', classes, ...sources
], { stdio: 'inherit' });
if (compilation.status !== 0) {
  throw new Error(`Adapter compilation failed with exit code ${compilation.status}`);
}

function runProbe(runIndex) {
  const output = runIndex === 0
    ? (outputOption ? path.resolve(outputOption) : path.join(workDirectory, 'capture.json'))
    : path.join(workDirectory, `run-${runIndex + 1}`, 'capture.json');
  const probe = spawnSync('java', [
    '-Xmx4096m', '-Dfile.encoding=UTF-8', '-cp', `${classes}${path.delimiter}${jar}`,
    'cedh.sim.ExpansionInspectionProbeMain',
    '--deck-directory', deckOutput,
    ...decks.flatMap((deck) => ['--deck', deck.output]),
    '--seat', String(seat), '--seed', String(seed), '--phase', 'MAIN1',
    '--output', output,
    ...stagedHand.flatMap((name) => ['--stage-hand', name]),
    ...stagedBattlefield.flatMap((name) => ['--stage-battlefield', name]),
    ...(produceMana ? ['--produce-mana', produceMana] : [])
  ], { cwd: forgeRoot, encoding: 'utf8', timeout: timeoutSeconds * 1000, maxBuffer: 64 * 1024 * 1024 });
  const text = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
  if (probe.status !== 0) {
    process.stdout.write(text);
    throw new Error(`Inspection probe failed with exit code ${probe.status}`);
  }
  const summary = text.split('\n').find((line) => line.startsWith('PROBE_EXPANSION')) ?? '';
  return { output, summary };
}

const runs = [];
for (let index = 0; index < repeat; index++) {
  const run = runProbe(index);
  const capture = JSON.parse(await readFile(run.output, 'utf8'));
  const schema = await schemaErrors(capture);
  if (schema.length > 0) throw new Error(`v3 schema errors: ${schema.join('; ')}`);
  assertValidObservation(capture);
  runs.push(capture);
  if (index === 0) console.log(run.summary);
}
if (repeat > 1) {
  assertReproducibleBundles([runs[0]], [runs[1]], `${label}: run 1 vs run 2`);
  console.log(`Reproducible across ${repeat} fresh JVMs (semantic projection)`);
}

const [capture] = runs;
const expansion = capture.availableActions.simpleSpellExpansion;
const failures = [];

if (expectAttempted !== undefined && String(expansion.attempted) !== expectAttempted) {
  failures.push(`expected attempted=${expectAttempted}, got ${expansion.attempted}`);
}
if (expectSuppressed !== undefined && expansion.suppressedReason !== expectSuppressed) {
  failures.push(`expected suppressedReason=${expectSuppressed}, got ${expansion.suppressedReason}`);
}
for (const name of expectExclusionFor) {
  const exclusion = expansion.manaSourceExclusions.find((entry) => entry.source?.name === name);
  if (!exclusion) {
    failures.push(`expected a mana-source exclusion for ${name}`);
  } else if (exclusion.reason !== 'mana-source-with-selectable-colour') {
    failures.push(`${name}: unexpected exclusion reason ${exclusion.reason}`);
  } else {
    console.log(`  excluded ${name}: ${exclusion.reason} colours=${JSON.stringify(exclusion.producibleColors)}`);
  }
}
for (const reason of expectSkipped) {
  // Asserted straight from the authoritative per-unit record. There is no
  // aggregate reason-count map to consult, precisely so the two cannot drift.
  const record = expansion.inspectedAbilities.find(
    (entry) => entry.outcome === 'SKIPPED' && entry.reason === reason
  );
  if (!record) {
    failures.push(`expected an inspected SKIPPED ability with reason ${reason}`);
  } else {
    console.log(`  skipped ${record.source?.name}: ${reason}`);
  }
}
for (const name of expectNoExpandedFor) {
  const expanded = capture.availableActions.actions.filter(
    (action) => isExpandedAction(action) && action.source?.name === name
  );
  if (expanded.length > 0) {
    failures.push(`${name} must produce no concrete expanded action, found ${expanded.length}`);
  }
  const raw = capture.availableActions.actions.find(
    (action) => action.category === 'CAST_SPELL'
      && !isExpandedAction(action)
      && action.source?.name === name
  );
  if (!raw) {
    failures.push(`${name} must remain visible as a raw CAST_SPELL candidate`);
  } else if (raw.executable !== false
      || !(raw.unrepresentedChoices ?? []).some((c) => c.code === 'UNSUPPORTED_ACTION_EXPANSION')) {
    failures.push(`${name}: raw candidate must be non-executable with UNSUPPORTED_ACTION_EXPANSION`);
  } else {
    console.log(`  ${name}: no expanded action; raw candidate non-executable`);
  }
}

if (failures.length > 0) {
  console.error(`\n${label.toUpperCase()} INSPECTION FAILED:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\n${label}: verified.`);
