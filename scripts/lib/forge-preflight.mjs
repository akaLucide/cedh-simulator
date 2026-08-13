import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * The single Forge build this milestone is verified against.
 *
 * Probes need the full official desktop distribution, not just the jar: Forge
 * resolves card scripts and other resources relative to the distribution root.
 * The runtime is never committed — it lives outside the repository.
 */
export const PINNED_FORGE = {
  version: '2.0.15-SNAPSHOT-08.13',
  buildTimestamp: '2026-08-13 01:30:10',
  desktopJarSha256: 'c93f367fb9799852230c6f878cf484fa0df031ddc597fd17d12a248577691f16'
};

/** Locations that indicate a full distribution rather than a bare jar. */
const CARD_SCRIPT_LOCATIONS = [
  'res/cardsfolder',
  'res/cardsfolder.zip',
  'forge-gui/res/cardsfolder'
];

export async function sha256OfFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Refuses to run against anything other than the pinned build.
 *
 * Deliberately minimal for this milestone: it proves the runtime is the one the
 * captures were verified against, and nothing more. Recording the version into
 * result files, and fixing the unsound lexicographic jar selection, are M4.
 */
export async function assertPinnedForgeDistribution(forgeRoot, jarPath) {
  const actual = await sha256OfFile(jarPath);
  if (actual !== PINNED_FORGE.desktopJarSha256) {
    throw new Error(
      `Refusing to run: ${path.basename(jarPath)} is not the pinned Forge build.\n`
      + `  expected SHA-256 ${PINNED_FORGE.desktopJarSha256} (${PINNED_FORGE.version}, `
      + `built ${PINNED_FORGE.buildTimestamp})\n`
      + `  actual   SHA-256 ${actual}\n`
      + 'Captured evidence is only comparable across identical Forge builds.'
    );
  }

  const found = [];
  for (const location of CARD_SCRIPT_LOCATIONS) {
    if (await exists(path.join(forgeRoot, location))) found.push(location);
  }
  if (found.length === 0) {
    throw new Error(
      `Refusing to run: ${forgeRoot} has the pinned jar but no card-script resources.\n`
      + `  looked for: ${CARD_SCRIPT_LOCATIONS.join(', ')}\n`
      + 'The probes need the full desktop distribution, not just the jar.'
    );
  }
  return { jarSha256: actual, cardScripts: found[0] };
}
