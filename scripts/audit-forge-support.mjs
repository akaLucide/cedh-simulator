import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_DECKS,
  applyApprovedOverrides,
  assertOpponentApprovals,
  loadProjectDocuments,
  parsePlainDeck
} from './lib/decks.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function collectCardNames(directory, names = new Set()) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const itemPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectCardNames(itemPath, names);
    } else if (entry.name.endsWith('.txt')) {
      const text = await readFile(itemPath, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('Name:')) names.add(line.slice(5));
      }
    }
  }
  return names;
}

const forgeRoot = option('--forge-root');
if (!forgeRoot) {
  throw new Error('Usage: npm run audit:forge -- --forge-root <path-to-forge>');
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDirectory);
const { pool, overrides } = await loadProjectDocuments(projectRoot);
assertOpponentApprovals(pool);

const cardNames = await collectCardNames(path.join(forgeRoot, 'forge-gui/res/cardsfolder'));
let hasMissing = false;
for (const definition of BASELINE_DECKS) {
  const inputPath = path.join(projectRoot, definition.file);
  const cards = applyApprovedOverrides(
    parsePlainDeck(await readFile(inputPath, 'utf8'), inputPath),
    overrides
  );
  const missing = cards.filter((card) => !cardNames.has(card.engineName));
  const total = cards.reduce((sum, card) => sum + card.quantity, 0);
  const missingCount = missing.reduce((sum, card) => sum + card.quantity, 0);
  console.log(`${definition.id}: ${total - missingCount}/${total} engine names found`);
  for (const card of cards.filter((entry) => entry.substituted)) {
    console.log(`  approved substitution: ${card.requestedName} -> ${card.engineName}`);
  }
  for (const card of missing) {
    console.log(`  MISSING: ${card.engineName}`);
  }
  hasMissing ||= missing.length > 0;
}

if (hasMissing) process.exitCode = 1;

