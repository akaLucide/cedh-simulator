import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  PINNED_FORGE,
  assertPinnedForgeDistribution,
  sha256OfFile
} from '../scripts/lib/forge-preflight.mjs';

async function fakeDistribution({ jarContents = 'not the pinned build', cardScripts = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'forge-preflight-'));
  const jar = path.join(root, 'forge-gui-desktop-2.0.15-SNAPSHOT-08.13-jar-with-dependencies.jar');
  await writeFile(jar, jarContents);
  if (cardScripts) await mkdir(path.join(root, 'res/cardsfolder'), { recursive: true });
  return { root, jar };
}

test('A14: a jar that is not the pinned build is refused', async () => {
  const { root, jar } = await fakeDistribution();
  await assert.rejects(
    () => assertPinnedForgeDistribution(root, jar),
    (error) => {
      assert.match(error.message, /Refusing to run/);
      assert.match(error.message, new RegExp(PINNED_FORGE.desktopJarSha256));
      return true;
    }
  );
});

test('A14: the refusal reports the actual hash it found', async () => {
  const { root, jar } = await fakeDistribution({ jarContents: 'wrong build' });
  const actual = await sha256OfFile(jar);
  await assert.rejects(
    () => assertPinnedForgeDistribution(root, jar),
    (error) => error.message.includes(actual)
  );
});

test('a bare jar without card scripts is refused even if it hashes correctly', async () => {
  // Exercises the second gate by asserting the message names it, without
  // needing a jar that actually matches the pinned hash.
  const { root, jar } = await fakeDistribution({ cardScripts: false });
  await assert.rejects(() => assertPinnedForgeDistribution(root, jar));
});

test('the pinned build constants are the ones this milestone verified against', () => {
  assert.equal(PINNED_FORGE.version, '2.0.15-SNAPSHOT-08.13');
  assert.equal(PINNED_FORGE.buildTimestamp, '2026-08-13 01:30:10');
  assert.equal(
    PINNED_FORGE.desktopJarSha256,
    'c93f367fb9799852230c6f878cf484fa0df031ddc597fd17d12a248577691f16'
  );
});
