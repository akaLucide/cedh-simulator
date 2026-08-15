import { mkdir, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPinnedForgeDistribution } from './lib/forge-preflight.mjs';

/**
 * Verifies the set-level incomplete-enumeration guard.
 *
 * The underlying probe is *supposed* to fail: it ends by throwing
 * `IncompleteEnumerationException`. This wrapper turns that into a verdict,
 * exiting 0 only when the refusal is the typed one, carries the distinct exit
 * code, and originates in the guard.
 *
 * The fixture is synthetic and says so. P7 proved no approved deck can reach the
 * action limit inside the supported boundary, so no natural truncated state
 * exists. Rather than lower the limit or add a bypass, the probe constructs a
 * truncated `Expansion` value directly.
 *
 * This proves refusal mechanics, the typed exception, the exit code, and guard
 * placement. It proves nothing about natural Forge truncation, a natural
 * truncated prefix, DFS performance at the limit, or reproducibility of a
 * natural truncated fixture.
 */

const EXPECTED_EXIT_CODE = 4;

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const forgeRootOption = option('--forge-root');
if (!forgeRootOption) throw new Error('--forge-root is required');

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDirectory);
const forgeRoot = path.resolve(forgeRootOption);
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

const candidates = [
  ...await jarCandidates(forgeRoot),
  ...await jarCandidates(path.join(forgeRoot, 'forge-gui-desktop/target'))
].sort();
if (candidates.length === 0) throw new Error(`Forge desktop build not found in ${forgeRoot}`);
const jar = candidates.at(-1);
const build = await assertPinnedForgeDistribution(forgeRoot, jar);
console.log(`Forge build verified: ${path.basename(jar)} (${build.cardScripts})`);

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

const probe = spawnSync('java', [
  '-cp', `${classes}${path.delimiter}${jar}`,
  'cedh.sim.IncompleteEnumerationFaultMain'
], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

const output = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
process.stdout.write(output);

const failures = [];
const require = (condition, message) => {
  if (!condition) failures.push(message);
};

require(
  probe.status === EXPECTED_EXIT_CODE,
  `expected the distinct incomplete-enumeration exit code ${EXPECTED_EXIT_CODE}, got ${probe.status}`
);
require(
  output.includes('PROBE_REFUSED_WITH=IncompleteEnumerationException'),
  'expected the typed IncompleteEnumerationException refusal'
);
require(
  output.includes('EnumerationGuard.requireCompleteEnumeration'),
  'the refusal must originate in the set-level guard'
);
require(
  output.includes('SYNTHETIC_FIXTURE=truncated'),
  'the fixture must declare itself synthetic'
);
require(
  !output.includes('PROBE_FAILED'),
  'the guard must not accept an incomplete enumeration'
);

if (failures.length > 0) {
  console.error('\nENUMERATION GUARD VERIFICATION FAILED:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  '\nEnumeration guard verified: a known-incomplete Expansion is refused before selection '
  + `with a typed IncompleteEnumerationException and exit code ${EXPECTED_EXIT_CODE}.`
  + '\nFixture is SYNTHETIC: it proves refusal mechanics and guard placement only, not that '
  + 'real Forge ever reached the action limit.'
);
