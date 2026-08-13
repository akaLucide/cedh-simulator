import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Structural guards on the probe controllers.
 *
 * The v2 contract says an action is executable only when nothing is left
 * unrepresented. That is only true if every controller which hands an ability to
 * Forge actually consults the gate — a property no capture can demonstrate,
 * because a capture records what was published, not what was executed.
 *
 * Source scanning follows the precedent already set by the A17 no-hardcoding
 * test in evidence.test.mjs.
 */

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const adapterDirectory = path.join(projectRoot, 'spike/src/main/java/cedh/sim');

/** Strips comments so a mention in prose cannot satisfy a structural check. */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

async function controllerSources() {
  const files = (await readdir(adapterDirectory))
    .filter((name) => name.endsWith('ControllerAi.java'))
    .sort();
  const sources = [];
  for (const file of files) {
    sources.push({
      file,
      code: withoutComments(await readFile(path.join(adapterDirectory, file), 'utf8'))
    });
  }
  return sources;
}

test('every probe controller that plays an ability consults the shared gate', async () => {
  const offenders = [];
  for (const { file, code } of await controllerSources()) {
    // ChoiceHookFaultControllerAi exists precisely to suppress the gate, and is
    // reachable only from its own test-only main.
    if (file === 'ChoiceHookFaultControllerAi.java') continue;
    if (!/return\s+List\.of\(\s*\w+\s*\)/.test(code)) continue;
    if (!code.includes('requireRepresented') && !code.includes('refuseIfIncomplete')) {
      offenders.push(file);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'A controller that returns an ability to Forge without consulting '
      + 'ActionChoiceAudit can execute an action the observation calls non-executable.'
  );
});

/** Body of a named method, by brace matching from its declaration. */
function methodBodyRange(code, methodName) {
  const declaration = code.indexOf(`${methodName}(`);
  if (declaration < 0) return null;
  const open = code.indexOf('{', declaration);
  if (open < 0) return null;
  let depth = 0;
  for (let index = open; index < code.length; index++) {
    if (code[index] === '{') depth++;
    else if (code[index] === '}' && --depth === 0) return [open, index];
  }
  return null;
}

test('the gate has exactly one definition', async () => {
  const audit = await readFile(path.join(adapterDirectory, 'ActionChoiceAudit.java'), 'utf8');
  const definitions = withoutComments(audit).match(/static\s+void\s+requireRepresented\b/g) ?? [];
  assert.equal(definitions.length, 1, 'requireRepresented must be declared once');
});

test('controllers refuse through the gate, except the hook of last resort', async () => {
  // payCostToPreventEffect is answering a question Forge asked directly, so it
  // constructs its own refusal rather than gating a pre-enumerated action. Every
  // other throw would be a second, drifting copy of the rule.
  const offenders = [];
  for (const { file, code } of await controllerSources()) {
    const hook = methodBodyRange(code, 'payCostToPreventEffect');
    const pattern = /throw\s+new\s+UnrepresentedChoiceException/g;
    for (let match = pattern.exec(code); match !== null; match = pattern.exec(code)) {
      const insideHook = hook !== null && match.index > hook[0] && match.index < hook[1];
      if (!insideHook) offenders.push(`${file}:${match.index}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'Outside the decision hook of last resort, a controller must refuse through '
      + 'ActionChoiceAudit.requireRepresented rather than its own throw.'
  );
});

test('the fault-injection bypass is reachable only from its own main', async () => {
  const files = (await readdir(adapterDirectory)).filter((name) => name.endsWith('.java'));
  const referring = [];
  for (const file of files) {
    if (file.startsWith('ChoiceHookFault')) continue;
    const code = withoutComments(await readFile(path.join(adapterDirectory, file), 'utf8'));
    if (code.includes('ChoiceHookFault')) referring.push(file);
  }
  assert.deepEqual(referring, [], 'no production source may reference the bypass classes');
});

test('no npm script routes an unaudited cast through the capture script', async () => {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const offenders = Object.entries(manifest.scripts)
    .filter(([, command]) => command.includes('--cast-spell'))
    .map(([name]) => name);
  assert.deepEqual(
    offenders,
    [],
    'A command that casts an unexpanded spell advertises an executable path the '
      + 'contract forbids. Use verify:spell-guard instead.'
  );
});
