import test from 'node:test';
import assert from 'node:assert/strict';
import { formatStoryboard, parseStoryboard, storyboardAt, storyboardDuration } from '../web/src/storyboard.mjs';
import { makeSceneLink, normalizeScene, sceneRequest } from '../web/src/scene.mjs';

test('compact timing is reversible and rejects malformed or out-of-range values', () => {
  const timing = '(0) 5.8 | (1.2) 1.1 | (1.4) 3.6 | (1.4) 0.45';
  const frames = parseStoryboard(timing);
  assert.equal(formatStoryboard(frames), timing);
  assert.equal(storyboardDuration(frames).toFixed(2), '14.95');
  assert.throws(() => parseStoryboard('(1) 4'), /four/);
  assert.throws(() => parseStoryboard(timing.replace('5.8', '1801')), /1800/);
  assert.throws(() => parseStoryboard(timing.replace('5.8', '-1')), /seconds/);
});

test('the source clock selects the same shot after seeking, looping, or crossing a boundary', () => {
  const frames = parseStoryboard('(0) 5.8 | (1.2) 1.1 | (1.4) 3.6 | (1.4) 0.45')
    .map((frame, i) => ({ ...frame, image: i + 1 }));
  assert.deepEqual(storyboardAt(frames, 0), { current: 1, mix: 1 });
  assert.deepEqual(storyboardAt(frames, 6.4), { previous: 1, current: 2, mix: .5 });
  assert.deepEqual(storyboardAt(frames, 7), { current: 2, mix: 1 });
  assert.deepEqual(storyboardAt(frames, 8.1), { previous: 2, current: 3, mix: 0 });
  assert.deepEqual(storyboardAt(frames, 14.5), { current: 4, mix: 1 });
  assert.equal(storyboardAt(frames, 14.95), null);
});

test('video, timed inversion and four image slots round-trip through a saved scene link', () => {
  const base = 'https://dj.cityplanners.co/';
  const project = {
    format: 'dj-animate', version: 1,
    storyboard: { loop: false, frames: [{ src: 'black.webp', transition: 0, hold: 5 }, {}, {}, {}] },
    audio: { src: 'video.mp4', video: true }, layers: [
      { src: '407.svg', blend: 'difference', cue: { start: 15.45, end: 20.3 } },
    ],
  };
  const restored = normalizeScene(sceneRequest(makeSceneLink(project, base)).project, base);
  assert.equal(restored.storyboard.loop, false);
  assert.equal(restored.storyboard.frames[0].src, base + 'black.webp');
  assert.equal(restored.storyboard.frames[1].src, undefined);
  assert.equal(restored.audio.video, true);
  assert.equal(restored.layers[0].blend, 'difference');
  assert.deepEqual(restored.layers[0].cue, { start: 15.45, end: 20.3 });
  assert.throws(() => makeSceneLink({ ...project, storyboard: {
    frames: [{ data: 'data:image/webp;base64,AAAA' }, {}, {}, {}],
  } }, base), /local uploads/);
});
