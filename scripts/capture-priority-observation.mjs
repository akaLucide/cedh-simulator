import { mkdir, readFile, readdir } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForgeDecks } from './lib/decks.mjs';
import { assertPinnedForgeDistribution } from './lib/forge-preflight.mjs';
import {
  assertLandTransition,
  assertReproducibleBundles,
  assertSpellTransition,
  assertTargetedSpellTransition,
  assertValidObservation
} from './lib/observations.mjs';

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

async function findForgeJar(forgeRoot) {
  const candidates = [
    ...await jarCandidates(forgeRoot),
    ...await jarCandidates(path.join(forgeRoot, 'forge-gui-desktop/target'))
  ].sort();
  if (candidates.length === 0) {
    throw new Error(`Forge desktop build not found in ${forgeRoot}`);
  }
  return candidates.at(-1);
}

async function runWithTimeout(command, args, options) {
  const child = spawn(command, args, { cwd: options.cwd, stdio: 'inherit' });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, options.timeoutMs);
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  if (timedOut) throw new Error(`Priority observation timed out after ${options.timeoutMs} ms`);
  if (result.code !== 0) {
    throw new Error(`Priority observation failed with code ${result.code} and signal ${result.signal}`);
  }
}

const forgeRootOption = option('--forge-root');
if (!forgeRootOption) {
  throw new Error(
    'Usage: npm run observe -- --forge-root <path-to-forge> ' +
    '[--seed 1] [--seat 1] [--phase MAIN1] [--timeout 90] [--output <path>] ' +
    '[--play-land <front-face-name> --before <path> --after <path>] ' +
    '[--cast-spell <name> --before <path> --stack <path> --resolved <path>] ' +
    '[--cast-targeted-spell <name> --mana-source <name> --target-player-seat <seat>]'
  );
}

const seed = Number(option('--seed', '1'));
const seat = Number(option('--seat', '1'));
const timeoutSeconds = Number(option('--timeout', '90'));
const repeat = Number(option('--repeat', '1'));
const phase = option('--phase', 'MAIN1').toUpperCase();
const landSource = option('--play-land');
const stageIntoHand = option('--stage-into-hand');
const auditOnly = process.argv.includes('--audit-only');
const spellSource = option('--cast-spell');
const targetedSpellSource = option('--cast-targeted-spell');
const manaSource = option('--mana-source');
const additionalManaSources = options('--additional-mana-source');
const targetPlayerSeat = Number(option('--target-player-seat', '2'));
if ([landSource, spellSource, targetedSpellSource].filter(Boolean).length > 1) {
  throw new Error('Choose only one action probe mode');
}
if (auditOnly && (landSource || spellSource || targetedSpellSource)) {
  throw new Error('--audit-only never executes an action, so it cannot be combined with an action probe');
}
if (targetedSpellSource && !manaSource) {
  throw new Error('--cast-targeted-spell requires --mana-source');
}
if (!Number.isSafeInteger(seed)) throw new Error('--seed must be an integer');
if (!Number.isSafeInteger(seat) || seat < 1 || seat > 4) throw new Error('--seat must be from 1 to 4');
if (!Number.isSafeInteger(targetPlayerSeat)
    || targetPlayerSeat < 1
    || targetPlayerSeat > 4
    || targetPlayerSeat === seat) {
  throw new Error('--target-player-seat must be a different seat from 1 to 4');
}
if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1) {
  throw new Error('--timeout must be a positive integer');
}
if (!Number.isSafeInteger(repeat) || repeat < 1) {
  throw new Error('--repeat must be a positive integer');
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDirectory);
const forgeRoot = path.resolve(forgeRootOption);
const output = path.resolve(option(
  '--output',
  path.join(projectRoot, `build/priority-observation-seat-${seat}-seed-${seed}.json`)
));
const beforeOutput = path.resolve(option(
  '--before',
  path.join(projectRoot, `build/land-action-before-seat-${seat}-seed-${seed}.json`)
));
const afterOutput = path.resolve(option(
  '--after',
  path.join(projectRoot, `build/land-action-after-seat-${seat}-seed-${seed}.json`)
));
const stackOutput = path.resolve(option(
  '--stack',
  path.join(projectRoot, `build/spell-action-stack-seat-${seat}-seed-${seed}.json`)
));
const resolvedOutput = path.resolve(option(
  '--resolved',
  path.join(projectRoot, `build/spell-action-resolved-seat-${seat}-seed-${seed}.json`)
));
const deckOutput = path.join(projectRoot, 'build/forge-decks');
const classes = path.join(projectRoot, 'spike/build/classes');
const sourceDirectory = path.join(projectRoot, 'spike/src/main/java/cedh/sim');
const sources = (await readdir(sourceDirectory))
  .filter((file) => file.endsWith('.java'))
  .map((file) => path.join(sourceDirectory, file));
const decks = await buildForgeDecks(projectRoot, deckOutput);
const jar = await findForgeJar(forgeRoot);
const forgeBuild = await assertPinnedForgeDistribution(forgeRoot, jar);
console.log(`Forge build verified: ${path.basename(jar)} (${forgeBuild.cardScripts})`);

await mkdir(classes, { recursive: true });
const compilation = spawnSync('java', [
  '-m', 'jdk.compiler/com.sun.tools.javac.Main',
  '-cp', jar,
  '-d', classes,
  ...sources
], { stdio: 'inherit' });
if (compilation.status !== 0) {
  throw new Error(`Adapter compilation failed with exit code ${compilation.status}`);
}

const commonArgs = [
  '-Xmx4096m',
  '-Dfile.encoding=UTF-8',
  '-cp', `${classes}${path.delimiter}${jar}`,
];
const gameArgs = [
  '--deck-directory', deckOutput,
  ...decks.flatMap((deck) => ['--deck', deck.output]),
  '--seat', String(seat),
  '--seed', String(seed),
  '--phase', phase
];
const stagingArgs = stageIntoHand ? ['--stage-into-hand', stageIntoHand] : [];

/** Logical capture names for the selected mode, in the order they are produced. */
const captureOrder = auditOnly
  ? ['before']
  : landSource
    ? ['before', 'after']
    : (spellSource || targetedSpellSource)
      ? ['before', 'stack', 'resolved']
      : ['output'];

const basePaths = {
  before: beforeOutput,
  after: afterOutput,
  stack: stackOutput,
  resolved: resolvedOutput,
  output
};

/** Sends a repeat run to its own directory so run 1's artifacts stay intact. */
function pathsForRun(runIndex) {
  if (runIndex === 0) return basePaths;
  const shadow = path.join(projectRoot, `build/reproducibility-run-${runIndex + 1}`);
  return Object.fromEntries(
    Object.entries(basePaths).map(([name, target]) => [name, path.join(shadow, path.basename(target))])
  );
}

function probeArgs(paths) {
  if (auditOnly) {
    return [
      ...commonArgs,
      'cedh.sim.LandActionProbeMain',
      ...gameArgs,
      '--audit-only',
      ...stagingArgs,
      '--before', paths.before
    ];
  }
  if (landSource) {
    return [
      ...commonArgs,
      'cedh.sim.LandActionProbeMain',
      ...gameArgs,
      '--source', landSource,
      ...stagingArgs,
      '--before', paths.before,
      '--after', paths.after
    ];
  }
  if (spellSource) {
    return [
      ...commonArgs,
      'cedh.sim.SpellActionProbeMain',
      ...gameArgs,
      '--source', spellSource,
      '--before', paths.before,
      '--stack', paths.stack,
      '--resolved', paths.resolved
    ];
  }
  if (targetedSpellSource) {
    return [
      ...commonArgs,
      'cedh.sim.TargetedSpellProbeMain',
      ...gameArgs,
      '--source', targetedSpellSource,
      '--mana-source', manaSource,
      ...additionalManaSources.flatMap((source) => ['--additional-mana-source', source]),
      '--target-player-seat', String(targetPlayerSeat),
      '--before', paths.before,
      '--stack', paths.stack,
      '--resolved', paths.resolved
    ];
  }
  return [
    ...commonArgs,
    'cedh.sim.PriorityObservationMain',
    ...gameArgs,
    '--output', paths.output
  ];
}

async function runProbe(runIndex) {
  const paths = pathsForRun(runIndex);
  await runWithTimeout('java', probeArgs(paths), { cwd: forgeRoot, timeoutMs: timeoutSeconds * 1000 });
  const captures = [];
  for (const name of captureOrder) {
    captures.push(JSON.parse(await readFile(paths[name], 'utf8')));
  }
  captures.forEach(assertValidObservation);
  return captures;
}

const captures = await runProbe(0);
const [primary] = captures;

if (repeat > 1) {
  // Two fresh JVMs, each validated on its own, then compared through the
  // semantic projection rather than byte-for-byte: Forge object ids are
  // debug-only and drift between runs by design.
  for (let runIndex = 1; runIndex < repeat; runIndex++) {
    assertReproducibleBundles(captures, await runProbe(runIndex), `run 1 vs run ${runIndex + 1}`);
  }
  console.log(`Reproducible across ${repeat} fresh JVMs (semantic projection over ${captureOrder.length} capture(s))`);
}

if (auditOnly) {
  const landActions = primary.availableActions.actions.filter((action) => action.category === 'PLAY_LAND');
  console.log(
    `Audited ${landActions.length} land action(s) in a ${primary.fixture.kind} capture; `
    + landActions
      .map((action) => `${action.source?.name}: executable=${action.executable} `
        + `choices=${action.unrepresentedChoices.map((choice) => choice.code).join(',') || 'none'}`)
      .join('; ')
  );
} else if (landSource) {
  const [before, after] = captures;
  assertLandTransition(before, after, landSource);
  const movedCardId = before.players
    .find((player) => player.seat === seat)
    .zones.hand.cards.find((card) => card.name === landSource).id;
  const resultingCard = after.players
    .find((player) => player.seat === seat)
    .zones.battlefield.cards.find((card) => card.id === movedCardId);
  if (!resultingCard) {
    throw new Error(`The raw card id ${movedCardId} that left hand is not on the battlefield`);
  }
  console.log(
    `Validated land transition (${before.fixture.kind} fixture): ${landSource} -> ${resultingCard.name}; `
    + `same raw card id ${movedCardId}; tapped=${resultingCard.tapped}`
  );
} else if (spellSource || targetedSpellSource) {
  const [before, onStack, resolved] = captures;
  if (targetedSpellSource) {
    assertTargetedSpellTransition(before, onStack, resolved, {
      sourceName: targetedSpellSource,
      manaSourceName: manaSource,
      targetPlayerSeat,
      alternativeManaSourceName: additionalManaSources[0]
    });
    console.log(
      `Validated targeted spell transition: ${targetedSpellSource}; `
      + `paid by ${manaSource}; target seat ${targetPlayerSeat}; damage=1; resolved to graveyard`
    );
  } else {
    assertSpellTransition(before, onStack, resolved, spellSource);
    console.log(
      `Validated spell transition: ${spellSource}; stack entries `
      + `${before.game.stack.length} -> ${onStack.game.stack.length} -> ${resolved.game.stack.length}; `
      + 'resolved to battlefield'
    );
  }
} else {
  console.log(
    `Validated schema v${primary.schemaVersion} (${primary.fixture.kind} fixture): `
    + `turn ${primary.game.turn} ${primary.game.phase}, seat ${seat}, `
    + `${primary.availableActions.actions.length} actions/candidates`
  );
}
