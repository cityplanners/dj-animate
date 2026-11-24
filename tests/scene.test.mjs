import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeScene, sceneRequest, makeSceneLink, overrideScene, assetURL, layerPulse, fetchSceneJSON, MAX_MANIFEST_BYTES } from '../web/src/scene.mjs';
import { packScene } from '../tools/pack-scene.mjs';

const base = 'https://cityplanners.github.io/dj-animate/';
const sample = () => ({ format: 'dj-animate', version: 1, title: 'DJ · 岩', canvas: { width: 2560, height: 720 },
  selection: { start: 1, end: 4 }, layers: [{ name: 'Rocks', src: 'rocks.png', role: 'background' }, { name: 'DJ', src: 'dj.png', band: 3, pulse: .02, flicker: .1, blend: 'screen' }] });

test('normal visits retain the original GTA scene; imports require an explicit scene link', () => {
  for (const href of [base, base + '#studio', base + '#waves', base + '?utm_source=chat', 'https://dj.cityplanners.co/']) assert.equal(sceneRequest(href), null);
  assert.ok(sceneRequest(base + '?scene=first-order').manifestURL);
  assert.ok(sceneRequest(makeSceneLink(normalizeScene(sample(), base), base)).project);
  assert.equal(sceneRequest(base + '?master=0.5').manifestURL, undefined);
});

test('short scene links respect GitHub Pages subpaths and reject path traversal', () => {
  assert.equal(sceneRequest(base + '?scene=first-order').manifestURL, base + 'scenes/first-order/scene.djscene.json');
  for (const id of ['../private', '/other', '', 'x'.repeat(65)]) assert.throws(() => sceneRequest(base + '?scene=' + encodeURIComponent(id)), /scene name/);
  assert.equal(sceneRequest(base + '#waves'), null);
  assert.throws(() => sceneRequest(base + '?scene=one&manifest=two.json'), /one scene source/);
});
test('a scene link restores Unicode, asset locations, layer routes and trim after sharing', () => {
  const first = normalizeScene(sample(), base + 'scenes/one/scene.djscene.json');
  const link = makeSceneLink(first, base + '?scene=one#studio');
  assert.equal(new URL(link).search, '');
  const restored = normalizeScene(sceneRequest(link).project, base);
  assert.deepEqual(restored, first);
  assert.equal(restored.layers[1].src, base + 'scenes/one/dj.png');
});
test('deep links pass bounded settings and duration overrides without mutating a scene', () => {
  const request = sceneRequest(base + '?scene=one&preset=warp&master=0.4&start=1.2&duration=2.5&response=1.8');
  const scene = normalizeScene(sample(), base), updated = overrideScene(scene, request.overrides);
  assert.deepEqual(updated.selection, { start: 1.2, end: 3.7 });
  assert.equal(updated.state.master, .4); assert.equal(updated.state.response, 1.8);
  assert.equal(scene.state.master, .65); assert.equal(scene.selection.start, 1);
  for (const query of ['master=NaN', 'master=99', 'start=-1', 'duration=0', 'gain=', 'response=1.3', 'preset=bad']) assert.throws(() => sceneRequest(base + '?' + query));
});
test('unsafe, temporary and credential-bearing asset links cannot enter a scene', () => {
  for (const src of ['javascript:alert(1)', 'file:///tmp/image.png', 'blob:https://x/a', 'https://user:pass@example.com/image.png', 'http://example.com/image.png']) assert.throws(() => assetURL(src, base));
  assert.equal(assetURL('/image.png', base), 'https://cityplanners.github.io/image.png');
  const local = sample(); local.layers[0].data = 'data:image/png;base64,aGVsbG8='; delete local.layers[0].src;
  assert.equal(normalizeScene(local, base).layers[0].src, local.layers[0].data);
  assert.throws(() => makeSceneLink(local, base), /local uploads/);
  local.layers[0].src = 'blob:https://example.com/upload';
  assert.throws(() => makeSceneLink(local, base), /Save a project/);
  assert.throws(() => sceneRequest(base + '?manifest=data:audio/mpeg;base64,AAAA'), /hosted JSON/);
  assert.throws(() => sceneRequest(base + '#scene=%%%%'), /invalid/);
  assert.throws(() => sceneRequest(base + '#scene=' + 'a'.repeat(24001)), /too large/);
});
test('legacy embedded projects remain loadable and malformed collections fail before use', () => {
  const p = sample(); p.layers[0] = { data: 'data:image/png;base64,AAAA', role: 'background' }; p.layers.splice(1);
  const scene = normalizeScene(p, base); assert.equal(scene.layers[0].opacity, 1); assert.equal(scene.layers[0].motion, true);
  assert.throws(() => normalizeScene({ ...p, layers: [] }, base), /1–20/);
  assert.throws(() => normalizeScene({ ...p, layers: Array(21).fill(p.layers[0]) }, base), /1–20/);
  assert.throws(() => normalizeScene({ ...p, canvas: { width: 3840, height: 3840 } }, base), /megapixels/);
});
test('per-layer audio motion follows its own band, stays bounded and can be disabled', () => {
  const l = { band: 3, motion: true, pulse: .03, flicker: .1, opacity: .8 };
  assert.deepEqual(layerPulse(l, [1, 1, 1, 0], 1), { scale: 1, alpha: .8 });
  assert.deepEqual(layerPulse(l, [0, 0, 0, 1], 2), { scale: 1.03, alpha: .8 * .9 });
  assert.deepEqual(layerPulse({ ...l, motion: false }, [1, 1, 1, 1], 1), { scale: 1, alpha: .8 });
});
test('manifest fetch handles HTTP failures and bounds streamed bodies without a content length', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(sample()));
    assert.equal((await fetchSceneJSON(base)).title, 'DJ · 岩');
    globalThis.fetch = async () => new Response('missing', { status: 404 });
    await assert.rejects(fetchSceneJSON(base), /404/);
    globalThis.fetch = async () => new Response('x'.repeat(MAX_MANIFEST_BYTES + 1));
    await assert.rejects(fetchSceneJSON(base), /too large/);
  } finally { globalThis.fetch = original; }
});
test('scene packer copies durable assets, emits a portable manifest and refuses unsafe input', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'dj-scene-'));
  try {
    const input = path.join(temp, 'input'), outputRoot = path.join(temp, 'published'); await mkdir(input);
    await writeFile(path.join(input, 'rocks.png'), 'rock-bytes'); await writeFile(path.join(input, 'dj.png'), 'sprite-bytes');
    const file = path.join(input, 'scene.json'); await writeFile(file, JSON.stringify(sample()));
    const result = await packScene(file, { id: 'test', baseURL: base, outputRoot });
    assert.equal(result.url, base + '?scene=test'); assert.equal(result.assets, 2);
    const manifest = JSON.parse(await readFile(result.manifest, 'utf8'));
    assert.equal(await readFile(path.join(result.directory, manifest.layers[1].src), 'utf8'), 'sprite-bytes');
    assert.equal(normalizeScene(manifest, base + 'scenes/test/scene.djscene.json').layers[0].src, base + 'scenes/test/01-rocks.png');
    await assert.rejects(packScene(file, { id: 'test', outputRoot }), /already exists/);
    await assert.rejects(packScene(file, { id: '../escape', outputRoot }), /--id/);
    await writeFile(path.join(temp, 'private.png'), 'private'); await symlink(path.join(temp, 'private.png'), path.join(input, 'escape.png'));
    const bad = sample(); bad.layers[0].src = 'escape.png'; await writeFile(file, JSON.stringify(bad));
    await assert.rejects(packScene(file, { id: 'escape', outputRoot }), /inside the input/);
    assert.equal(await readFile(path.join(result.directory, manifest.layers[0].src), 'utf8'), 'rock-bytes');
  } finally { await rm(temp, { recursive: true, force: true }); }
});
