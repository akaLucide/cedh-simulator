import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_DECKS,
  applyApprovedOverrides,
  loadProjectDocuments,
  parsePlainDeck
} from '../scripts/lib/decks.mjs';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Frozen at the start of the v2 milestone. These artifacts are the evidence the
 * v1 contract was verified against; regenerating them would destroy the record
 * of what was actually observed, so they are never rewritten. New behaviour goes
 * into *-v2.json captures instead.
 */
const FROZEN_V2_EVIDENCE = {
  'examples/priority-observation-v2.json': '5d09b7aa0ed5dec44c187856df11a7c863ff80c8454830e7c92bc77f0f3ff2bd',
  'examples/spell-action-before-v2.json': '93237e5d0841866b8adfb7f30f9fdfff337aa91e147540f4b06686a9a4e1d601',
  'examples/staged-choice-free-land-after-v2.json': 'a71f2dfa5432ae81f8daca96358048debb4d8e1cce0a6b464ef8fe046ad08d80',
  'examples/staged-choice-free-land-before-v2.json': '896cd25692624ea769b38337dfbd8be1e196bfc1b740131ee125612a7b30e0fc',
  'examples/staged-optional-cost-land-before-v2.json': '68f8ae36bc6e4c2d4e4edfe12d94fd79deaca9a309ea2788f6fe5cce098de1df',
  'examples/targeted-spell-before-v2.json': '36137579006aa105913d17422792189678749c2cf76bdd60306c2ff49bbed6c2',
  'schemas/observation-v2.schema.json': '7bac45864bfc1be755587891441e22bc02e190eedabb1b3a3712dc8da04cc251'
};

const FROZEN_V1_EVIDENCE = {
  'examples/land-action-after-v1.json': '57caeb482cbe8c7e79878fe99136ab2eee901ca6a515030a472cef88acd43f4e',
  'examples/land-action-before-v1.json': '8cc42b701cbfc7a5c1de6274c20ced8d2e1ccff48491e0e2139500bdc54bff8e',
  'examples/priority-observation-v1.json': '8cc42b701cbfc7a5c1de6274c20ced8d2e1ccff48491e0e2139500bdc54bff8e',
  'examples/spell-action-before-v1.json': '5bc5ba9689867078ef07a4fd52ed5a9e58952bd9ed5d2bb6791f8fe30f048fc8',
  'examples/spell-action-resolved-v1.json': 'f800b605ef268b2946c24f017a620bfedd49a1ab1ab33d1f2d7c23c20f94ad4b',
  'examples/spell-action-stack-v1.json': 'd8b904c46bbd65ebf18a0e0fd0e5a77aa09cb84d876def45eaf9f5e5df2ccf76',
  'examples/targeted-spell-before-v1.json': 'decb6929141f7202c8f288dd4f8e015b91fd4723ffedea387e573c4695de1ee7',
  'examples/targeted-spell-resolved-v1.json': '0e1d6f832e12e0e0b435d8161543b1ae5d64c25e0688ad61eba17a0806c556db',
  'examples/targeted-spell-stack-v1.json': 'fc3648b31d27024ed3444956fe0bfb8c3926b81ac9c0f051e9c56fef7a9e8652',
  'schemas/observation-v1.schema.json': '19f3eee186dd73bc05f2311b1e0370d84e37eecc6d402992a9a184c2ea444528'
};

async function sha256(relativePath) {
  const bytes = await readFile(path.join(projectRoot, relativePath));
  return createHash('sha256').update(bytes).digest('hex');
}

/** Java string literals, so a card name in a comment is not a false positive. */
function stringLiterals(source) {
  return source.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
}

test('A12: frozen v1 evidence is byte-unchanged', async () => {
  const actual = {};
  for (const relativePath of Object.keys(FROZEN_V1_EVIDENCE)) {
    actual[relativePath] = await sha256(relativePath);
  }
  assert.deepEqual(actual, FROZEN_V1_EVIDENCE);
});

/**
 * v2 joins v1 as frozen evidence. Adding v3 must not regenerate the captures
 * that proved v2, or the record of what v2 actually produced is destroyed.
 */
test('frozen v2 evidence is byte-unchanged', async () => {
  const actual = {};
  for (const relativePath of Object.keys(FROZEN_V2_EVIDENCE)) {
    actual[relativePath] = await sha256(relativePath);
  }
  assert.deepEqual(actual, FROZEN_V2_EVIDENCE);
});

test('A17: no adapter source hardcodes an approved card name', async () => {
  const { overrides } = await loadProjectDocuments(projectRoot);
  const cardNames = new Set();
  for (const definition of BASELINE_DECKS) {
    const text = await readFile(path.join(projectRoot, definition.file), 'utf8');
    for (const card of applyApprovedOverrides(parsePlainDeck(text, definition.file), overrides)) {
      cardNames.add(card.requestedName);
      cardNames.add(card.engineName);
    }
  }

  const adapterDirectory = path.join(projectRoot, 'spike/src/main/java/cedh/sim');
  const offenders = [];
  for (const file of (await readdir(adapterDirectory)).filter((name) => name.endsWith('.java'))) {
    const source = await readFile(path.join(adapterDirectory, file), 'utf8');
    for (const literal of stringLiterals(source)) {
      for (const cardName of cardNames) {
        if (literal.includes(cardName)) offenders.push(`${file}: ${literal}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'Choice detection must come from Forge rules data, not per-card special cases. '
      + 'Card names belong in deck lists and CLI arguments, never in adapter logic.'
  );
});
