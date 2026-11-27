import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeVehicle, makeDefaultVehicleOBJ, parseVehicleOBJ, createVehicleRig, vehiclePose, rotateVehiclePoint } from '../web/src/vehicle.mjs';
import { normalizeScene, makeSceneLink, sceneRequest } from '../web/src/scene.mjs';
import { packScene } from '../tools/pack-scene.mjs';

const base = 'https://dj.cityplanners.co/';
const vehicle = () => ({ format: 'dj-animate', version: 1, layers: [{ name: 'Convertible', role: 'vehicle', src: 'car.png', vehicle: { model: 'car.obj', wheelBands: [0, 1, 2, 3], wheels: [{ id: 'fl', x: .59, y: .8, rx: .06, ry: .18 }] } }] });

test('each wheel responds to its own music band and produces chassis heave, pitch and roll', () => {
  const config = normalizeVehicle({ obj: makeDefaultVehicleOBJ() }), rig = createVehicleRig(); let pose;
  for (let frame = 0; frame <= 120; frame++) pose = vehiclePose(rig, config, [1, 0, 0, 0], frame / 60);
  assert.ok(pose.wheels[0] > .17); assert.deepEqual(pose.wheels.slice(1), [0, 0, 0]);
  assert.ok(pose.heave > 0); assert.ok(pose.pitch > 0); assert.ok(pose.roll > 0);
  const left = rotateVehiclePoint([1, 0, -1], pose), right = rotateVehiclePoint([1, 0, 1], pose);
  assert.notEqual(left[1], right[1]); assert.notEqual(left[2], -right[2]);
  for (let frame = 121; frame <= 480; frame++) pose = vehiclePose(rig, config, [0, 0, 0, 0], frame / 60);
  assert.ok(pose.wheels.every(w => Math.abs(w) < .00001));
});

test('suspension stays still in silence and resets on seek, pause and disabled motion', () => {
  const config = normalizeVehicle({ obj: makeDefaultVehicleOBJ() }), rig = createVehicleRig();
  for (let i = 0; i <= 120; i++) assert.equal(vehiclePose(rig, config, [0, 0, 0, 0], i / 60).heave, 0);
  for (let i = 121; i <= 200; i++) vehiclePose(rig, config, [1, 1, 1, 1], i / 60);
  assert.ok(rig.positions.every(w => w > 0));
  assert.equal(vehiclePose(rig, config, [1, 1, 1, 1], 0).heave, 0);
  for (let i = 1; i <= 120; i++) vehiclePose(rig, config, [1, 1, 1, 1], i / 60);
  assert.equal(vehiclePose(rig, config, [1, 1, 1, 1], 2, 1, false).heave, 0);
  for (let i = 121; i <= 240; i++) assert.equal(vehiclePose(rig, config, [1, 1, 1, 1], i / 60, 0).heave, 0);
});

test('damped springs remain bounded under extreme settings and agree across rendering rates', () => {
  const config = normalizeVehicle({ obj: makeDefaultVehicleOBJ(), stiffness: 240, damping: 3, travel: .65 });
  const run = fps => { const rig = createVehicleRig(); let pose; for (let i = 0; i <= fps * 4; i++) pose = vehiclePose(rig, config, [1, .3, .8, .2], i / fps, 1.5); return pose; };
  const a = run(30), b = run(60);
  assert.ok(a.wheels.every(w => Number.isFinite(w) && Math.abs(w) <= config.travel * 1.7));
  a.wheels.forEach((v, i) => assert.ok(Math.abs(v - b.wheels[i]) < .015));
});

test('the rough OBJ has real depth and four independently addressable wheel meshes', () => {
  const model = parseVehicleOBJ(makeDefaultVehicleOBJ());
  assert.ok(model.size.every(size => size > 0));
  for (const wheel of ['fl', 'fr', 'rl', 'rr']) assert.ok(model.faces.some(face => face.group === 'wheel_' + wheel));
  assert.throws(() => parseVehicleOBJ('v NaN 0 0\nf 1 2 3'), /vertex/);
  assert.throws(() => parseVehicleOBJ('v 0 0 0\nf 1 2 3'), /face/);
  assert.throws(() => parseVehicleOBJ('mtllib https://external/file.mtl'), /vertices/);
});

test('VEHICLE models and four routes survive portable scene packing and shared links', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'dj-vehicle-'));
  try {
    await writeFile(path.join(temp, 'car.png'), 'sprite'); await writeFile(path.join(temp, 'car.obj'), makeDefaultVehicleOBJ());
    await writeFile(path.join(temp, 'scene.json'), JSON.stringify(vehicle()));
    const result = await packScene(path.join(temp, 'scene.json'), { id: 'convertible', baseURL: base, outputRoot: path.join(temp, 'output') });
    const packed = JSON.parse(await readFile(result.manifest, 'utf8'));
    assert.equal(packed.layers[0].vehicle.model, '02-car.obj');
    assert.ok(parseVehicleOBJ(await readFile(path.join(result.directory, packed.layers[0].vehicle.model), 'utf8')).faces.length);
    const normalized = normalizeScene(packed, base + 'scenes/convertible/scene.djscene.json');
    const restored = normalizeScene(sceneRequest(makeSceneLink(normalized, base)).project, base);
    assert.deepEqual(restored.layers[0].vehicle, normalized.layers[0].vehicle);
    assert.equal(restored.layers[0].role, 'vehicle');
    assert.throws(() => normalizeScene({ ...vehicle(), layers: [{ ...vehicle().layers[0], vehicle: { model: 'file:///private.obj' } }] }, base), /HTTPS/);
    const embedded = vehicle(); embedded.layers[0].vehicle = { obj: makeDefaultVehicleOBJ() };
    assert.throws(() => makeSceneLink(embedded, base), /Save a project/);
    assert.ok(normalizeScene(embedded, base).layers[0].vehicle.obj);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
