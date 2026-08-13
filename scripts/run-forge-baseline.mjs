import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForgeDecks } from './lib/decks.mjs';

const MAX_CAPTURED_CHARACTERS = 1_000_000;

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer; received ${JSON.stringify(value)}`);
  }
  return parsed;
}

function integer(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be an integer; received ${JSON.stringify(value)}`);
  }
  return parsed;
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
    throw new Error(
      `Forge desktop build not found in ${forgeRoot}. Supply an extracted ` +
      'desktop snapshot, or build the source with: ' +
      'mvn -pl forge-gui-desktop -am -DskipTests package'
    );
  }
  return candidates.at(-1);
}

function appendTail(current, chunk) {
  const combined = current + chunk;
  return combined.length <= MAX_CAPTURED_CHARACTERS
    ? combined
    : combined.slice(-MAX_CAPTURED_CHARACTERS);
}

function parseRunOutput(output, processResult) {
  if (processResult.timedOut) {
    return { status: 'timeout', winner: null, engineDurationMs: null, error: null };
  }

  const knownErrors = [
    'StackOverflowError',
    'OutOfMemoryError',
    'ExecutionException',
    'InterruptedException',
    'Stopping slow match as draw',
    'Could not load deck',
    'match cannot start'
  ];
  const error = knownErrors.find((candidate) => output.includes(candidate));
  if (error || processResult.code !== 0) {
    return {
      status: 'engine-error',
      winner: null,
      engineDurationMs: null,
      error: error ?? `Java exited with code ${processResult.code}`
    };
  }

  const draw = output.match(/Game Result: Game 1 ended in a Draw! Took (\d+) ms\./);
  if (draw) {
    return { status: 'draw', winner: null, engineDurationMs: Number(draw[1]), error: null };
  }

  const win = output.match(/Game Result: Game 1 ended in (\d+) ms\. (.+?) has won!/);
  if (win) {
    return {
      status: 'completed',
      winner: win[2],
      engineDurationMs: Number(win[1]),
      error: null
    };
  }

  return {
    status: 'engine-error',
    winner: null,
    engineDurationMs: null,
    error: 'Forge exited without a recognizable game result'
  };
}

async function runProcess(command, args, options) {
  const started = Date.now();
  const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let timedOut = false;

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    output = appendTail(output, text);
    if (options.echo) process.stdout.write(text);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    output = appendTail(output, text);
    if (options.echo) process.stderr.write(text);
  });

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, options.timeoutMs);

  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    // `close` fires after stdout/stderr close, so the final result line is
    // guaranteed to be present before it is parsed.
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);

  return {
    ...result,
    timedOut,
    wallDurationMs: Date.now() - started,
    output
  };
}

const forgeRootOption = option('--forge-root');
if (!forgeRootOption) {
  throw new Error(
    'Usage: npm run simulate -- --forge-root <path-to-forge> ' +
    '[--games 1] [--seed 1] [--timeout 300] [--results <path>]'
  );
}

const forgeRoot = path.resolve(forgeRootOption);
const games = positiveInteger(option('--games', '1'), '--games');
const baseSeed = integer(option('--seed', '1'), '--seed');
const timeoutSeconds = positiveInteger(option('--timeout', '300'), '--timeout');
const dryRun = process.argv.includes('--dry-run');
const quiet = process.argv.includes('--quiet');
const headless = process.argv.includes('--headless');
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDirectory);
const outputDirectory = path.join(projectRoot, 'build/forge-decks');
const resultsOption = option('--results', path.join(projectRoot, 'build/baseline-results.json'));
const resultsPath = path.resolve(resultsOption);
const decks = await buildForgeDecks(projectRoot, outputDirectory);
const jar = await findForgeJar(forgeRoot);

// Forge's simulation CLI prepends its own Commander deck directory even when
// given an absolute path, so stage generated decks where that loader expects.
const forgeDeckDirectory = path.join(forgeRoot, 'data/decks/commander');
await mkdir(forgeDeckDirectory, { recursive: true });
for (const deck of decks) {
  await copyFile(deck.outputPath, path.join(forgeDeckDirectory, deck.output));
}

let launcherArgs;
if (headless) {
  const classes = path.join(projectRoot, 'spike/build/classes');
  const sources = [
    path.join(projectRoot, 'spike/src/main/java/cedh/sim/HeadlessGuiBase.java'),
    path.join(projectRoot, 'spike/src/main/java/cedh/sim/MinimalSimulationMain.java')
  ];
  if (!dryRun) {
    await mkdir(classes, { recursive: true });
    const compilation = spawnSync('java', [
      '-m', 'jdk.compiler/com.sun.tools.javac.Main',
      '-cp', jar,
      '-d', classes,
      ...sources
    ], { stdio: 'inherit' });
    if (compilation.status !== 0) {
      throw new Error(`Headless launcher compilation failed with exit code ${compilation.status}`);
    }
  }
  launcherArgs = [
    '-Xmx4096m',
    '-Dfile.encoding=UTF-8',
    '-cp', `${classes}${path.delimiter}${jar}`,
    'cedh.sim.MinimalSimulationMain'
  ];
} else {
  launcherArgs = ['-Xmx4096m', '-Dfile.encoding=UTF-8', '-jar', jar, 'sim'];
}

console.log(`Working directory: ${forgeRoot}`);
console.log(`Forge jar: ${jar}`);
console.log(`Games run in isolated Java processes: ${games}`);

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  forge: {
    root: forgeRoot,
    jar: path.basename(jar)
  },
  configuration: {
    format: 'commander',
    games,
    baseSeed,
    timeoutSeconds,
    processIsolation: true,
    decks: decks.map((deck, playerIndex) => ({
      player: playerIndex + 1,
      id: deck.id,
      file: deck.output
    }))
  },
  runs: []
};

for (let game = 1; game <= games; game += 1) {
  const seed = baseSeed + game - 1;
  // The wrapper must time out first. Forge's internal timeout currently emits
  // an invalid multiplayer outcome and can leave its worker thread running.
  const engineTimeoutSeconds = timeoutSeconds + 60;
  const simulationArgs = [
    '-d', ...decks.map((deck) => deck.output),
    '-n', '1',
    '-f', 'commander',
    '-s', String(seed),
    '-c', String(engineTimeoutSeconds)
  ];
  if (quiet) simulationArgs.push('-q');
  const args = [...launcherArgs, ...simulationArgs];

  if (dryRun) {
    console.log(`[dry run ${game}/${games}] java ${args.map((value) => JSON.stringify(value)).join(' ')}`);
    continue;
  }

  console.log(`Starting game ${game}/${games} with seed ${seed}`);
  const processResult = await runProcess('java', args, {
    cwd: forgeRoot,
    echo: !quiet,
    timeoutMs: timeoutSeconds * 1000
  });
  const parsed = parseRunOutput(processResult.output, processResult);
  const run = {
    game,
    seed,
    ...parsed,
    wallDurationMs: processResult.wallDurationMs,
    exitCode: processResult.code,
    signal: processResult.signal
  };
  if (run.status === 'engine-error') {
    run.diagnosticTail = processResult.output.slice(-4000);
  }
  report.runs.push(run);
  console.log(
    `Game ${game}/${games}: ${run.status}` +
    (run.winner ? `; winner ${run.winner}` : '') +
    (run.error ? `; ${run.error}` : '') +
    `; ${run.wallDurationMs} ms`
  );
}

if (!dryRun) {
  await mkdir(path.dirname(resultsPath), { recursive: true });
  await writeFile(resultsPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Results: ${resultsPath}`);
  if (report.runs.some((run) => run.status === 'engine-error')) process.exitCode = 2;
}
