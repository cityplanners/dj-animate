import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseYouTube, YouTubeTransport, LiveEnergyFollower, blankYouTubeAnalysis, writeLiveSample, youtubeError } from '../web/src/youtube.mjs';
import { normalizeScene, sceneRequest, overrideScene, makeSceneLink } from '../web/src/scene.mjs';
import { energyAt } from '../web/src/dsp.mjs';
import { packScene } from '../tools/pack-scene.mjs';

const id = 'M7lc1UVf-VE', base = 'https://cityplanners.github.io/dj-animate/';
const project = () => ({ format: 'dj-animate', version: 1, layers: [{ name: 'GTA', src: 'image.png', role: 'background' }], audio: { source: 'youtube', url: `https://youtu.be/${id}?t=1m2s` } });

test('YouTube links accept watch, short, mobile, music, shorts, live and embed formats', () => {
  for (const url of [id, `https://youtu.be/${id}`, `youtu.be/${id}`, `https://www.youtube.com/watch?v=${id}&list=ignored`, `https://music.youtube.com/watch?v=${id}`, `https://m.youtube.com/watch?v=${id}`, `https://youtube.com/shorts/${id}`, `https://youtube.com/live/${id}`, `https://www.youtube-nocookie.com/embed/${id}`]) {
    assert.deepEqual(parseYouTube(url), { id, start: 0, url: `https://www.youtube.com/watch?v=${id}` });
  }
  assert.equal(parseYouTube(`https://youtu.be/${id}?t=1m2s`).start, 62);
  assert.equal(parseYouTube(`https://youtube.com/watch?v=${id}&start=12.5`).start, 12.5);
  assert.equal(parseYouTube(`https://youtu.be/${id}#t=7`).start, 7);
});
test('YouTube parsing rejects misleading hosts, credentials, playlists, code and invalid timestamps', () => {
  for (const url of [`https://youtube.com.evil.test/watch?v=${id}`, `https://user:pass@youtube.com/watch?v=${id}`, `http://youtu.be/${id}`, `javascript:alert(1)`, `https://youtu.be:8443/${id}`, 'https://youtube.com/playlist?list=abc', 'https://youtube.com/@channel', 'https://youtu.be/bad-id', `https://youtu.be/${id}?t=bad`, `https://youtu.be/${id}?t=1h`]) assert.throws(() => parseYouTube(url));
});
test('YouTube audio and its timestamp survive projects, scene links, and query overrides', () => {
  const scene = normalizeScene(project(), base);
  assert.deepEqual(scene.selection, { start: 62, end: 67 });
  const link = makeSceneLink(scene, base), decoded = normalizeScene(sceneRequest(link).project, base);
  assert.deepEqual(decoded.audio, scene.audio); assert.deepEqual(decoded.selection, scene.selection);
  const request = sceneRequest(base + '?scene=first-order&yt=' + encodeURIComponent(`https://youtu.be/${id}?t=4`) + '&duration=3');
  const mixed = overrideScene(scene, request.overrides);
  assert.deepEqual(mixed.selection, { start: 4, end: 7 }); assert.equal(mixed.audio.source, 'youtube');
  assert.throws(() => sceneRequest(base + '?yt=' + encodeURIComponent(`https://youtu.be/${id}`) + '&youtube=bad'), /one YouTube/);
  assert.equal(sceneRequest(base), null);
});
test('YouTube mode starts with no made-up audio energy and only fills listened-to portions', () => {
  const analysis = blankYouTubeAnalysis(100);
  assert.deepEqual(energyAt(analysis, 20), [0, 0, 0, 0]);
  writeLiveSample(analysis, 20, [.02, .03, .04, .05], [.1, .2, .3, .4]);
  energyAt(analysis, 20).forEach((n, i) => assert.ok(Math.abs(n - (i + 1) / 10) < 1e-6));
  assert.deepEqual(energyAt(analysis, 50), [0, 0, 0, 0]);
  writeLiveSample(analysis, 50, [1, 1, 1, 1], [.5, .5, .5, .5]);
  assert.deepEqual(energyAt(analysis, 40), [0, 0, 0, 0]);
});
test('live audio remains still in silence, follows independent bands, and eases its release', () => {
  const follower = new LiveEnergyFollower();
  for (let i = 0; i < 60; i++) assert.deepEqual(follower.update([0, 0, 0, 0], 1 / 30), [0, 0, 0, 0]);
  const first = follower.update([.1, 0, 0, 0], 1 / 30);
  assert.ok(first[0] > .2 && first[0] < 1); assert.deepEqual(first.slice(1), [0, 0, 0]);
  const released = follower.update([0, 0, 0, 0], 1 / 30);
  assert.ok(released[0] > 0 && released[0] < first[0]);
  for (let i = 0; i < 180; i++) follower.update([0, 0, 0, 0], 1 / 30);
  assert.ok(follower.values[0] < 1e-8);
});

function playerFixture() {
  let instance;
  class Player {
    constructor(element, config) { this.config = config; this.position = 0; this.state = 5; this.seconds = 120; instance = this; queueMicrotask(() => config.events.onReady({ target: this })); }
    getDuration() { return this.seconds; }
    getPlayerState() { return this.state; }
    getCurrentTime() { return this.position; }
    seekTo(t) { this.position = t; }
    playVideo() { this.state = 1; this.config.events.onStateChange({ data: 1 }); }
    pauseVideo() { this.state = 2; this.config.events.onStateChange({ data: 2 }); }
    destroy() { this.destroyed = true; }
  }
  return { api: { Player }, get player() { return instance; } };
}
test('YouTube playback and seeking share the studio clock; transport teardown stops polling', async () => {
  const fixture = playerFixture(); const media = new YouTubeTransport({ element: {}, origin: base, loader: async () => fixture.api });
  try {
    await media.open(`https://youtu.be/${id}`);
    assert.equal(media.duration, 120); assert.equal(media.readyState, 2); assert.equal(media.paused, true);
    await media.play(); assert.equal(media.paused, false); media.pause();
    await media.seek(25); assert.equal(media.currentTime, 25); assert.equal(media.seeking, false);
    media.loop = false; fixture.player.state = 0; let ended = 0;
    media.addEventListener('ended', () => ended++); fixture.player.config.events.onStateChange({ data: 0 });
    assert.equal(ended, 1); assert.equal(fixture.player.state, 0);
  } finally { media.destroy(); }
  assert.equal(fixture.player.destroyed, true); assert.equal(media.closed, true);
});
test('embedding failures and missing metadata give actionable errors without hanging export', async () => {
  assert.match(youtubeError(150), /disabled embedded/); assert.match(youtubeError(153), /HTTPS/);
  const fixture = playerFixture(); const media = new YouTubeTransport({ element: {}, origin: base, loader: async () => fixture.api });
  try {
    await media.open(id); fixture.player.seconds = 0;
    await assert.rejects(media.seek(10), /Play.*once/);
    fixture.player.seconds = 120; fixture.player.seekTo = () => {};
    await assert.rejects(media.seek(10, 10), /could not seek/);
    assert.equal(media.seeking, false);
  } finally { media.destroy(); }
});
test('buffering remains pausable and a stalled YouTube stream fails without locking the studio', async () => {
  const fixture = playerFixture(); const media = new YouTubeTransport({ element: {}, origin: base, loader: async () => fixture.api });
  try {
    await media.open(id);
    fixture.player.playVideo = () => { fixture.player.state = 3; fixture.player.config.events.onStateChange({ data: 3 }); };
    const pending = media.play(10);
    assert.equal(media.paused, false); assert.equal(media.buffering, true);
    await assert.rejects(pending, /still buffering/);
    assert.equal(media.paused, true);
    const cancelled = media.play(1000); media.pause();
    await assert.rejects(cancelled, error => error.name === 'AbortError');
  } finally { media.destroy(); }
});
test('restarting a paused YouTube player waits for its asynchronous play acknowledgement', async () => {
  const fixture = playerFixture(); const media = new YouTubeTransport({ element: {}, origin: base, loader: async () => fixture.api });
  try {
    await media.open(id); media.pause();
    fixture.player.playVideo = () => setTimeout(() => { fixture.player.state = 1; fixture.player.config.events.onStateChange({ data: 1 }); }, 5);
    await media.play(1000); assert.equal(media.paused, false);
  } finally { media.destroy(); }
});
test('scene packaging retains a canonical YouTube source instead of downloading media', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'dj-youtube-'));
  try {
    const input = path.join(temp, 'input'); await mkdir(input);
    await writeFile(path.join(input, 'image.png'), 'image-bytes');
    const file = path.join(input, 'scene.json'); await writeFile(file, JSON.stringify(project()));
    const result = await packScene(file, { id: 'youtube', baseURL: base, outputRoot: path.join(temp, 'out') });
    assert.equal(result.assets, 1);
    const saved = JSON.parse(await readFile(result.manifest));
    assert.equal(saved.audio.source, 'youtube'); assert.equal(saved.audio.url, `https://www.youtube.com/watch?v=${id}&t=62`);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
