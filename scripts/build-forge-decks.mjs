import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForgeDecks } from './lib/decks.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDirectory);
const outputDirectory = path.join(projectRoot, 'build/forge-decks');

const results = await buildForgeDecks(projectRoot, outputDirectory);
for (const result of results) {
  console.log(`Built ${result.id}: ${result.outputPath}`);
  for (const substitution of result.substitutions) {
    console.log(`  Approved substitution: ${substitution.from} -> ${substitution.to}`);
  }
}

