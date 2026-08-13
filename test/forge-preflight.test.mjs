import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  PINNED_FORGE,
  assertForgeCardScriptResources,
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

/**
 * The resource gate is tested through its own export rather than through
 * `assertPinnedForgeDistribution`. Going through the combined function would
 * require a jar matching the pinned SHA-256, which is not reproducible here;
 * the hash gate would fire first and the test would pass without ever reaching
 * the resource check.
 */
test('a distribution root with no card-script resources is refused', async () => {
  const { root } = await fakeDistribution({ cardScripts: false });
  await assert.rejects(
    () => assertForgeCardScriptResources(root),
    (error) => {
      assert.match(error.message, /no card-script resources/);
      assert.match(error.message, /res\/cardsfolder/);
      assert.match(error.message, /not just the jar/);
      return true;
    }
  );
});

test('each accepted card-script location satisfies the resource gate', async () => {
  for (const location of ['res/cardsfolder', 'forge-gui/res/cardsfolder']) {
    const root = await mkdtemp(path.join(tmpdir(), 'forge-resources-'));
    await mkdir(path.join(root, location), { recursive: true });
    assert.equal(await assertForgeCardScriptResources(root), location);
  }
});

test('a zipped card-script bundle satisfies the resource gate', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'forge-resources-zip-'));
  await mkdir(path.join(root, 'res'), { recursive: true });
  await writeFile(path.join(root, 'res/cardsfolder.zip'), 'not a real zip');
  assert.equal(await assertForgeCardScriptResources(root), 'res/cardsfolder.zip');
});

test('the combined preflight still applies the hash gate first', async () => {
  // Card scripts present, jar wrong: the hash error must be the one reported,
  // proving the SHA-256 gate is not bypassed by a well-formed distribution.
  const { root, jar } = await fakeDistribution({ cardScripts: true });
  await assert.rejects(
    () => assertPinnedForgeDistribution(root, jar),
    (error) => {
      assert.match(error.message, /is not the pinned Forge build/);
      return true;
    }
  );
});

test('the pinned build constants are the ones this milestone verified against', () => {
  assert.equal(PINNED_FORGE.version, '2.0.15-SNAPSHOT-08.13');
  assert.equal(PINNED_FORGE.buildTimestamp, '2026-08-13 01:30:10');
  assert.equal(
    PINNED_FORGE.desktopJarSha256,
    'c93f367fb9799852230c6f878cf484fa0df031ddc597fd17d12a248577691f16'
  );
});
