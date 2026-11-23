import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSelection, moveSelection, formatClipTime, formatClipDuration, seekMedia } from '../web/src/selection.mjs';

test('new tracks default to five seconds or their complete shorter duration', () => {
  assert.deepEqual(normalizeSelection(180), { start: 0, end: 5 });
  assert.deepEqual(normalizeSelection(2.5), { start: 0, end: 2.5 });
  assert.deepEqual(normalizeSelection(0), { start: 0, end: 0 });
  assert.deepEqual(normalizeSelection(.05), { start: 0, end: .05 });
});
test('trim handles cannot cross and leave the opposite boundary fixed', () => {
  const clip = { start: 10, end: 20 };
  assert.deepEqual(moveSelection(clip, 'start', 22, 100), { start: 19.9, end: 20 });
  assert.deepEqual(moveSelection(clip, 'end', 3, 100), { start: 10, end: 10.1 });
  assert.deepEqual(moveSelection(clip, 'start', -100, 100), { start: 0, end: 20 });
  assert.deepEqual(moveSelection(clip, 'end', 900, 100), { start: 10, end: 100 });
});
test('saved ranges survive project restoration and clamp to a shorter replacement track', () => {
  assert.deepEqual(normalizeSelection(100, { start: 12.5, end: 65 }), { start: 12.5, end: 65 });
  assert.deepEqual(normalizeSelection(30, { start: 12.5, end: 65 }), { start: 12.5, end: 30 });
  assert.deepEqual(normalizeSelection(30, { start: 40, end: 65 }), { start: 29.9, end: 30 });
  assert.deepEqual(normalizeSelection(Infinity), { start: 0, end: 0 });
});
test('duration labels support sub-second clips and ranges longer than a minute', () => {
  assert.equal(formatClipTime(12.3), '00:12.3');
  assert.equal(formatClipTime(60.1), '01:00.1');
  assert.equal(formatClipTime(59.99), '01:00.0');
  assert.equal(formatClipDuration(2.5), '2.5s');
  assert.equal(formatClipDuration(92.5), '1m 32.5s');
});
class FakeMedia extends EventTarget {
  readyState = 2; duration = 100; seeking = false; error = null; position = 0; writes = 0;
  get currentTime() { return this.position; }
  set currentTime(value) { this.position = value; this.seeking = true; this.writes++; }
  finishSeek() { this.seeking = false; this.dispatchEvent(new Event('seeked')); }
}
test('export seeking waits for decoded media at the chosen start, not only an updated time property', async () => {
  const media = new FakeMedia(); let ready = false;
  const pending = seekMedia(media, 12.5).then(() => { ready = true; });
  await Promise.resolve();
  assert.equal(media.currentTime, 12.5); assert.equal(ready, false);
  media.finishSeek(); await pending; assert.equal(ready, true);
});
test('same-position exports do not wait for a seeked event that will never fire', async () => {
  const media = new FakeMedia(); await seekMedia(media, 0); assert.equal(media.writes, 0);
});
test('media loading failures reject promptly instead of leaving export locked', async () => {
  const media = new FakeMedia(); const pending = seekMedia(media, 8);
  media.dispatchEvent(new Event('error'));
  await assert.rejects(pending, /audio could not be loaded/);
});
