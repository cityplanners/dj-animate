import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeScene } from '../web/src/scene.mjs';

test('the portable editor contains executable combined modules and the selected offline scene', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'dj-offline-'));
  try {
    const file = path.join(temp, 'first-order.html');
    await promisify(execFile)(process.execPath, ['tools/standalone.mjs', file, '--scene', 'first-order']);
    const html = await readFile(file, 'utf8');
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script); assert.doesNotThrow(() => new Function(script));
    assert.ok(!html.includes('src="./src/app.mjs"'));
    const embedded = JSON.parse(html.match(/<script type="application\/json" id="embedded-scene">([\s\S]*?)<\/script>/)[1]);
    const scene = normalizeScene(embedded, 'file:///first-order.html');
    assert.equal(scene.canvas.width, 2560); assert.equal(scene.layers.length, 3);
    assert.ok(scene.layers.every(layer => layer.src.startsWith('data:image/png;base64,')));
  } finally { await rm(temp, { recursive: true, force: true }); }
});
