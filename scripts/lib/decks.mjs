import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export const BASELINE_DECKS = [
  {
    id: 'ral-monsoon-mage-user',
    file: 'decks/user/ral-monsoon-mage.txt',
    commanders: ['Ral, Monsoon Mage'],
    output: 'ral.dck',
    userDeck: true
  },
  {
    id: 'blue-farm-matt-hayes-d-grid-2026-05-30',
    file: 'decks/candidates/blue-farm-matt-hayes-d-grid-2026-05-30.txt',
    commanders: ["Kraum, Ludevic's Opus", 'Tymna the Weaver'],
    output: 'blue-farm.dck'
  },
  {
    id: 'kinnan-jason-doan-siege-2026-06-13',
    file: 'decks/candidates/kinnan-jason-doan-siege-2026-06-13.txt',
    commanders: ['Kinnan, Bonder Prodigy'],
    output: 'kinnan.dck'
  },
  {
    id: 'sisay-matthew-swaney-eldritch-bastion-2026-06-27',
    file: 'decks/candidates/sisay-matthew-swaney-eldritch-bastion-2026-06-27.txt',
    commanders: ['Sisay, Weatherlight Captain'],
    output: 'sisay.dck'
  }
];

export function frontFaceName(name) {
  return name.split(/\s+\/\s+/, 1)[0].trim();
}

export function parsePlainDeck(text, source = '<deck>') {
  const cards = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^(\d+)\s+(.+?)\s*$/);
    if (!match) {
      throw new Error(`${source}:${index + 1}: unrecognized deck line: ${raw}`);
    }

    const quantity = Number.parseInt(match[1], 10);
    const withoutPrinting = match[2].replace(/\s+\([A-Z0-9]+\)\s+.*$/, '');
    cards.push({ quantity, requestedName: frontFaceName(withoutPrinting) });
  }

  const total = cards.reduce((sum, card) => sum + card.quantity, 0);
  if (total !== 100) {
    throw new Error(`${source}: expected 100 cards, found ${total}`);
  }
  return cards;
}

export function applyApprovedOverrides(cards, overrideDocument) {
  const substitutions = new Map(
    overrideDocument.substitutions
      .filter((entry) => entry.approved)
      .map((entry) => [entry.requestedName, entry.engineName])
  );

  return cards.map((card) => ({
    ...card,
    engineName: substitutions.get(card.requestedName) ?? card.requestedName,
    substituted: substitutions.has(card.requestedName)
  }));
}

export function assertOpponentApprovals(poolDocument, definitions = BASELINE_DECKS) {
  const poolById = new Map(poolDocument.decks.map((deck) => [deck.id, deck]));
  for (const definition of definitions.filter((deck) => !deck.userDeck)) {
    const poolEntry = poolById.get(definition.id);
    if (!poolEntry?.approved || !poolEntry?.enabled) {
      throw new Error(`Opponent deck is not approved and enabled: ${definition.id}`);
    }
  }
}

export function renderForgeDeck(deckName, commanders, cards) {
  const normalizedCommanders = commanders.map(frontFaceName);
  for (const commander of normalizedCommanders) {
    const matches = cards.filter((card) => card.engineName === commander);
    const count = matches.reduce((sum, card) => sum + card.quantity, 0);
    if (count !== 1) {
      throw new Error(`Commander must appear exactly once: ${commander} (found ${count})`);
    }
  }

  const main = cards.filter((card) => !normalizedCommanders.includes(card.engineName));
  const mainCount = main.reduce((sum, card) => sum + card.quantity, 0);
  if (mainCount + normalizedCommanders.length !== 100) {
    throw new Error(`Rendered deck does not contain 100 cards: ${deckName}`);
  }

  return [
    '[metadata]',
    `Name=${deckName}`,
    '[Commander]',
    ...normalizedCommanders.map((name) => `1 ${name}`),
    '[Main]',
    ...main.map((card) => `${card.quantity} ${card.engineName}`),
    ''
  ].join('\n');
}

export async function loadProjectDocuments(projectRoot) {
  const [pool, overrides] = await Promise.all([
    readFile(path.join(projectRoot, 'decks/pool.json'), 'utf8').then(JSON.parse),
    readFile(path.join(projectRoot, 'decks/card-overrides.json'), 'utf8').then(JSON.parse)
  ]);
  return { pool, overrides };
}

export async function buildForgeDecks(projectRoot, outputDirectory) {
  const { pool, overrides } = await loadProjectDocuments(projectRoot);
  assertOpponentApprovals(pool);
  await mkdir(outputDirectory, { recursive: true });

  const results = [];
  for (const definition of BASELINE_DECKS) {
    const inputPath = path.join(projectRoot, definition.file);
    const text = await readFile(inputPath, 'utf8');
    const cards = applyApprovedOverrides(parsePlainDeck(text, inputPath), overrides);
    const outputPath = path.join(outputDirectory, definition.output);
    await writeFile(
      outputPath,
      renderForgeDeck(definition.id, definition.commanders, cards),
      'utf8'
    );
    results.push({
      ...definition,
      outputPath,
      substitutions: cards
        .filter((card) => card.substituted)
        .map((card) => ({ from: card.requestedName, to: card.engineName }))
    });
  }
  return results;
}

