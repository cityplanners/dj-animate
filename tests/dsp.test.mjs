import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEnergy, smoothEnvelope, sampleCurve, energyAt, BANDS } from '../web/src/dsp.mjs';
import { effectValues, preset } from '../web/src/effects.mjs';
import { prepareEnvelopes } from '../web/src/dsp.mjs';
import { readFileSync } from 'node:fs';
test('silence never creates animation energy', () => {
  assert.deepEqual([...normalizeEnergy(new Float32Array(600))], Array(600).fill(0));
});
test('attack is fast and release is gradual at both frame rates', () => {
  for (const rate of [30, 60]) {
    const c = smoothEnvelope([...Array(rate).fill(1), ...Array(rate).fill(0)], rate, .04, .3);
    assert.ok(c[Math.floor(rate * .2)] > .99);
    assert.ok(c[rate] > .85);
    assert.ok(c.at(-1) < .05);
  }
});
test('audio-time interpolation survives seek and different rendering frame rates', () => {
  assert.equal(sampleCurve([0, 1, 0], .5, 1), .5);
  assert.equal(sampleCurve([0, 1, 0], 100, 1), 0);
  assert.equal(sampleCurve([0, 1], -1, 1), 0);
  assert.deepEqual(energyAt({ curves: [[0, 1], [0, .5], [0, .3], [0, .2]], rate: 1 }, 1, 2), [1, 1, .6, .4]);
});
test('all four filter bands are ordered and non-overlapping at boundaries', () => {
  assert.equal(BANDS.length, 4);
  for (let i = 1; i < 4; i++) assert.equal(BANDS[i - 1].range[1], BANDS[i].range[0]);
});
test('effect toggles and selected band govern the actual routed value', () => {
  assert.equal(effectValues([{ id: 'x', on: false, band: 0, amount: 1 }], [1, 0, 0, 0]).x, 0);
  assert.equal(effectValues([{ id: 'x', on: true, band: 2, amount: .5 }], [1, 0, .8, 0]).x, .4);
  assert.ok(preset('clean').filter(e => e.on).every(e => ['breathe', 'parallax'].includes(e.id)));
});
test('browser envelope math matches all offline sample points', () => {
  const sample = JSON.parse(readFileSync(new URL('../web/assets/backseat-analysis.json', import.meta.url)));
  const curves = prepareEnvelopes(sample.raw, sample.rate);
  for (let b = 0; b < 4; b++) for (let i = 0; i < curves[b].length; i++) {
    assert.ok(Math.abs(curves[b][i] - sample.curves[b][i]) < 1e-6, `band ${b}, sample ${i}`);
  }
});
