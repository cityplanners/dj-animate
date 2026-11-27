import { BANDS, clamp, analyzeAudio, energyAt, prepareEnvelopes } from './dsp.mjs';
import { preset } from './effects.mjs';
import { SceneRenderer } from './renderer.mjs';
import { normalizeSelection, moveSelection, formatClipTime, formatClipDuration, seekMedia } from './selection.mjs';
import { normalizeScene, sceneRequest, overrideScene, makeSceneLink, fetchSceneJSON } from './scene.mjs';
import { parseYouTube, YouTubeTransport, LiveAudioBands, blankYouTubeAnalysis, writeLiveSample } from './youtube.mjs';
import { defaultStoryboard, formatStoryboard, parseStoryboard, storyboardDuration, storyboardTiming } from './storyboard.mjs';
import { VEHICLE_WHEELS, normalizeVehicle, prepareVehicleLayer, makeDefaultVehicleOBJ } from './vehicle.mjs';
const $ = id => document.getElementById(id);
const audio = $('audio'), canvas = $('stage');
let clock = audio, youtube = null, liveBands = null, tabAudioStream = null, tabAudioNode = null, youtubeSelection = null;
let renderer, analysis, demoAnalysis, layers = [], selected = '', effects = preset('sunset');
let audioContext, mediaSource, recordBus, recorder, recordEnd = 0, audioFile = null, busy = false;
let recordingLoop = true, toastTimer, serial = 0;
let clip = normalizeSelection(5), exportBusy = false, exportPreparing = false;
let dirty = true, lastAudioTime = -1;
let sceneLoading = false, audioSourceURL = null, sourceVideo = false, storyboard = defaultStoryboard();
const transitionCanvas = document.createElement('canvas');
for (const event of ['input', 'click', 'change']) document.addEventListener(event, () => { dirty = true; });
const state = { master: .65, gain: 1, response: 1 };
const formatTime = s => `${String(Math.floor((s || 0) / 60)).padStart(2, '0')}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500); }
function fail(error) { console.error(error); toast(error.message || String(error)); $('status').textContent = 'Something needs attention.'; }
function el(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; }
function download(blob, filename) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
const loadImage = src => new Promise((resolve, reject) => {
  const i = new Image(), timeout = setTimeout(() => { i.src = ''; reject(new Error('An image took too long to load. Check its hosted URL.')); }, 20000);
  if (/^https?:/i.test(new URL(src, document.baseURI).protocol)) i.crossOrigin = 'anonymous';
  i.onload = () => { clearTimeout(timeout); i.naturalWidth * i.naturalHeight > 16777216 ? reject(new Error('Use images under 16 megapixels.')) : resolve(i); };
  i.onerror = () => { clearTimeout(timeout); reject(new Error('An image could not be loaded. Remote hosts must allow cross-origin image access.')); }; i.src = src;
});
const fileData = blob => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
function layer(name, image, role, extra = {}) { return { id: `layer-${++serial}`, name, image, role, visible: true, motion: true, opacity: 1, scale: 1, depth: role === 'background' ? -.35 : 1, x: 50, y: role === 'background' ? 50 : 97, blend: 'source-over', band: 0, pulse: 0, flicker: 0, ...extra }; }
async function prepareLayer(l) {
  if (l.alphaCutoff) {
    const c = document.createElement('canvas'); c.width = l.image.naturalWidth; c.height = l.image.naturalHeight;
    const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(l.image, 0, 0);
    const pixels = cx.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < pixels.data.length; i += 4) if (pixels.data[i] < l.alphaCutoff * 255) pixels.data[i] = 0;
    cx.putImageData(pixels, 0, 0); c.naturalWidth = c.width; c.naturalHeight = c.height; l.renderImage = c;
  }
  if (l.role === 'vehicle') await prepareVehicleLayer(l);
  return l;
}
async function demoLayers() {
  const [bg, man] = await Promise.all([loadImage('./assets/storefront.png'), loadImage('./assets/pendragon.png')]);
  const shadow = await loadImage('./assets/ground-shadow.svg');
  layers = [layer('Vice City storefront', bg, 'background', { scale: 1.04 }), layer('Ground shadow', shadow, 'sprite', { x: 49, y: 96, scale: .075, depth: .8, motion: false }), layer('Pendragon + album', man, 'sprite', { x: 49, scale: .98 })];
  selected = layers.at(-1).id; drawLayers();
}
function drawLayers() {
  dirty = true;
  $('layer-count').textContent = String(layers.length); $('layer-list').replaceChildren();
  // Show the topmost sprite first, matching common timeline compositors.
  for (const l of [...layers].reverse()) {
    const row = el('div', `layer-item${l.id === selected ? ' selected' : ''}`); row.tabIndex = 0; row.setAttribute('role', 'button'); row.setAttribute('aria-label', `Select ${l.name}`);
    row.onclick = () => { selected = l.id; drawLayers(); }; row.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } };
    const image = el('img', 'layer-thumb'); image.src = l.image.src; image.alt = '';
    const title = el('div', 'layer-title'); title.append(el('strong', '', l.name), el('small', '', l.role === 'vehicle' ? 'VEHICLE · four-wheel suspension' : l.role === 'background' ? 'Background' : 'Alpha / sprite'));
    const eye = el('button', `eye-button${l.visible ? '' : ' off'}`, l.visible ? '◉' : '○'); eye.setAttribute('aria-label', `${l.visible ? 'Hide' : 'Show'} ${l.name}`);
    eye.onclick = e => { e.stopPropagation(); l.visible = !l.visible; drawLayers(); };
    row.append(image, title, eye); $('layer-list').append(row);
  }
  const box = $('layer-inspector'); box.replaceChildren(); const l = layers.find(x => x.id === selected); if (!l) return;
  box.append(el('h3', '', l.name));
  function range(label, key, min, max, step, suffix = '', target = l) {
    const wrap = el('label'), name = el('span', '', label), input = el('input'); input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = target[key]; input.setAttribute('aria-label', `${l.name} ${label}`);
    name.title = `${target[key]}${suffix}`; input.oninput = () => { target[key] = Number(input.value); name.title = `${target[key]}${suffix}`; };
    wrap.append(name, input); box.append(wrap);
  }
  const roleLabel = el('label', '', 'Layer type'), role = el('select');
  for (const [value, name] of [['sprite', 'Sprite'], ['background', 'Background'], ['vehicle', 'VEHICLE']]) { const o = el('option', '', name); o.value = value; o.selected = l.role === value; role.append(o); }
  role.setAttribute('aria-label', `${l.name} Layer type`);
  role.onchange = async () => {
    if (sceneLoading || exportBusy || busy) { role.value = l.role; return; }
    const previous = l.role; l.role = role.value;
    try {
      if (l.role === 'vehicle') {
        l.vehicle ||= normalizeVehicle(location.protocol === 'file:' ? { obj: makeDefaultVehicleOBJ() } : { model: new URL('./assets/vehicle.obj', document.baseURI).href });
        await prepareVehicleLayer(l);
      } else if (l.role === 'background' || previous === 'background') l.y = l.role === 'background' ? 50 : 97;
    } catch (error) { l.role = previous; fail(error); }
    drawLayers();
  }; roleLabel.append(role); box.append(roleLabel);
  range('Horizontal', 'x', -20, 120, .5); range('Vertical', 'y', -20, 120, .5); range('Scale', 'scale', .03, 3, .01); range('Opacity', 'opacity', 0, 1, .01); range('Depth', 'depth', -1, 2, .05);
  const bandLabel = el('label', '', 'Layer audio band'), band = el('select');
  BANDS.forEach((b, i) => { const option = el('option', '', b.name); option.value = i; option.selected = l.band === i; band.append(option); });
  band.onchange = () => { l.band = Number(band.value); if (l.sway) l.sway.band = l.band; }; bandLabel.append(band); box.append(bandLabel);
  range('Pulse', 'pulse', 0, .1, .001); range('Flicker', 'flicker', 0, .3, .01);
  const blendLabel = el('label', '', 'Blend'), blend = el('select');
  for (const [value, name] of [['source-over', 'Normal'], ['screen', 'Screen'], ['lighter', 'Add light'], ['difference', 'Invert / difference'], ['multiply', 'Shadow / multiply']]) { const option = el('option', '', name); option.value = value; option.selected = l.blend === value; blend.append(option); }
  blend.onchange = () => { l.blend = blend.value; }; blendLabel.append(blend); box.append(blendLabel);
  if (l.role === 'vehicle') drawVehicleInspector(box, l, range);
  else {
    const windLabel = el('label', 'check-label'), wind = el('input'); wind.type = 'checkbox'; wind.checked = !!l.sway;
    wind.onchange = () => { if (wind.checked) l.sway = { amount: 3, rate: .45, band: l.band }; else delete l.sway; drawLayers(); };
    windLabel.append(wind, document.createTextNode('Cloth / leaf sway')); box.append(windLabel);
    if (l.sway) { range('Sway amount', 'amount', 0, 16, .25, '', l.sway); range('Sway speed', 'rate', .05, 4, .05, '', l.sway); }
  }
  if (l.cue) {
    for (const edge of ['start', 'end']) {
      const label = el('label', '', `Cue ${edge} (s)`), input = el('input');
      input.type = 'number'; input.min = 0; input.max = 1800; input.step = .001; input.value = l.cue[edge];
      input.onchange = () => {
        try {
          const cue = { ...l.cue, [edge]: storyboardTiming(input.valueAsNumber) };
          if (cue.end <= cue.start) throw new Error('The cue end must follow its start.');
          l.cue = cue;
        } catch (error) { toast(error.message); input.value = l.cue[edge]; }
      };
      label.append(input); box.append(label);
    }
  }
  const moveLabel = el('label', 'check-label'), motion = el('input'); motion.type = 'checkbox'; motion.checked = l.motion; motion.onchange = () => { l.motion = motion.checked; }; moveLabel.append(motion, document.createTextNode('Animate this layer')); box.append(moveLabel);
  const actions = el('div', 'layer-buttons');
  for (const [name, delta] of [['Back', -1], ['Front', 1]]) { const b = el('button', '', name); b.onclick = () => { const i = layers.indexOf(l), j = clamp(i + delta, 0, layers.length - 1); [layers[i], layers[j]] = [layers[j], layers[i]]; drawLayers(); }; actions.append(b); }
  const remove = el('button', 'danger', 'Remove'); remove.onclick = () => { layers = layers.filter(x => x !== l); if (l.objectURL) URL.revokeObjectURL(l.objectURL); selected = layers.at(-1)?.id || ''; drawLayers(); }; actions.append(remove); box.append(actions);
}
function drawVehicleInspector(box, l, range) {
  box.append(el('h3', '', 'VEHICLE suspension'));
  const label = el('label', '', 'Vehicle view'), view = el('select'); view.setAttribute('aria-label', 'Vehicle view');
  for (const [value, name] of [['sprite', 'Illustrated car'], ['model', 'Rough 3D model'], ['wireframe', 'OBJ wireframe']]) {
    const option = el('option', '', name); option.value = value; option.selected = l.vehicle.view === value; view.append(option);
  }
  view.onchange = () => { l.vehicle.view = view.value; }; label.append(view); box.append(label);
  range('Suspension travel', 'travel', 0, .65, .01, '', l.vehicle);
  range('Spring stiffness', 'stiffness', 20, 240, 1, '', l.vehicle);
  range('Spring damping', 'damping', 3, 30, .5, '', l.vehicle);
  const names = ['Front left', 'Front right', 'Rear left', 'Rear right'];
  VEHICLE_WHEELS.forEach((wheel, i) => {
    const label = el('label', '', `${names[i]} music`), select = el('select'); select.setAttribute('aria-label', `${names[i]} music`);
    BANDS.forEach((band, j) => { const option = el('option', '', band.name); option.value = j; option.selected = l.vehicle.wheelBands[i] === j; select.append(option); });
    select.onchange = () => { l.vehicle.wheelBands[i] = Number(select.value); }; label.append(select); box.append(label);
  });
  const fileLabel = el('label', 'text-button file-button', 'Load .obj'), file = el('input'); file.type = 'file'; file.accept = '.obj,text/plain'; file.setAttribute('aria-label', 'Load vehicle OBJ');
  file.onchange = async () => {
    const chosen = file.files[0]; if (!chosen || sceneLoading || exportBusy || busy) return;
    const previous = l.vehicle;
    try {
      if (chosen.size > 2000000) throw new Error('Use an OBJ model under 2 MB.');
      l.vehicle = normalizeVehicle({ ...previous, model: undefined, obj: await chosen.text() }); await prepareVehicleLayer(l); toast('Vehicle model loaded. Save project to keep the OBJ.');
    } catch (error) { l.vehicle = previous; fail(error); }
    drawLayers();
  };
  fileLabel.append(file); const downloadModel = el('button', 'text-button', 'Download .obj');
  downloadModel.onclick = () => download(new Blob([l.vehicleRuntime.text], { type: 'text/plain' }), 'vehicle.obj');
  const actions = el('div', 'layer-buttons'); actions.append(fileLabel, downloadModel); box.append(actions);
}
function syncStoryboardTiming() {
  $('storyboard-timing').value = formatStoryboard(storyboard.frames);
  $('storyboard-duration').value = `${formatClipDuration(storyboardDuration(storyboard.frames))} of ${formatClipDuration(analysis?.duration || 0)}`;
  dirty = true;
}

function drawStoryboardInputs() {
  const list = $('storyboard-frames');
  list.replaceChildren();
  storyboard.frames.forEach((shot, i) => {
    const name = `Frame ${i + 1}`, row = el('fieldset', 'storyboard-frame');
    row.append(el('legend', '', name));
    const preview = el('button', 'storyboard-thumb', shot.image ? undefined : 'Empty');
    preview.type = 'button'; preview.setAttribute('aria-label', `Seek to ${name.toLowerCase()}`);
    if (shot.image) { const thumb = shot.image.cloneNode(); thumb.alt = ''; preview.append(thumb); }
    preview.onclick = () => {
      const start = storyboardDuration(storyboard.frames.slice(0, i)) + shot.transition;
      seekClock(Math.min(start, Math.max(0, (analysis?.duration || 0) - .001))).then(() => { dirty = true; }).catch(fail);
    };
    const picker = el('label', 'text-button file-button', shot.image ? 'Replace' : 'Load image');
    const file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.setAttribute('aria-label', `Load ${name.toLowerCase()}`);
    file.onchange = async () => {
      const chosen = file.files[0];
      if (!chosen || busy || sceneLoading || exportBusy) return;
      const url = URL.createObjectURL(chosen);
      try {
        const image = await loadImage(url);
        if (storyboard.frames[i] !== shot || !file.isConnected || busy || sceneLoading || exportBusy) { URL.revokeObjectURL(url); return; }
        if (shot.objectURL) URL.revokeObjectURL(shot.objectURL);
        Object.assign(shot, { image, objectURL: url });
        drawStoryboardInputs();
      } catch (error) { URL.revokeObjectURL(url); fail(error); }
      finally { file.value = ''; }
    };
    picker.append(file); row.append(preview, picker);
    if (shot.image) {
      const remove = el('button', 'text-button', 'Remove'); remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${name.toLowerCase()}`);
      remove.onclick = () => {
        if (shot.objectURL) URL.revokeObjectURL(shot.objectURL);
        delete shot.image; delete shot.objectURL; drawStoryboardInputs();
      };
      row.append(remove);
    }
    const times = el('div', 'storyboard-frame-time');
    for (const [key, caption] of [['transition', 'Crossfade (s)'], ['hold', 'Hold (s)']]) {
      const label = el('label', '', caption), input = el('input');
      input.type = 'number'; input.min = 0; input.max = 1800; input.step = .001; input.value = shot[key];
      input.onchange = () => {
        try { shot[key] = storyboardTiming(input.valueAsNumber); $('storyboard-error').textContent = ''; }
        catch (error) { $('storyboard-error').textContent = error.message; }
        input.value = shot[key]; syncStoryboardTiming();
      };
      label.append(input); times.append(label);
    }
    row.append(times); list.append(row);
  });
  syncStoryboardTiming();
}

function applyStoryboard(next) {
  for (const frame of storyboard.frames) if (frame.objectURL) URL.revokeObjectURL(frame.objectURL);
  storyboard = next || defaultStoryboard();
  $('loop').checked = clock.loop = storyboard.loop;
  $('storyboard').open = sourceVideo || !!next?.frames.some(frame => frame.image);
  $('storyboard-error').textContent = '';
  drawStoryboardInputs();
}

function storyboardProject() {
  return {
    loop: $('loop').checked,
    frames: storyboard.frames.map(({ image, transition, hold }) => ({
      transition, hold, ...(image ? { src: image.src } : {}),
    })),
  };
}

function renderAt(time, energy, playing = false) {
  const video = !youtube && sourceVideo ? audio : undefined;
  const hasFrames = storyboard.frames.some(frame => frame.image);
  renderer.render(layers, effects, energy, time, state.master, playing,
    video || hasFrames ? { video, frames: storyboard.frames, transitionCanvas } : undefined);
}

function drawEffects() {
  dirty = true;
  $('effect-list').replaceChildren(); $('effect-count').textContent = `${effects.filter(e => e.on).length} on`;
  for (const e of effects) {
    const card = el('div', `effect-card${e.on ? ' enabled' : ''}`); card.title = e.detail;
    const head = el('div', 'effect-head'), title = el('div', 'effect-title'); title.append(el('strong', '', e.name), el('small', '', e.scope));
    const toggle = el('input', 'toggle'); toggle.type = 'checkbox'; toggle.checked = e.on; toggle.setAttribute('aria-label', e.name);
    toggle.onchange = () => { e.on = toggle.checked; card.classList.toggle('enabled', e.on); $('effect-count').textContent = `${effects.filter(x => x.on).length} on`; clearPreset(); };
    head.append(el('span', 'effect-icon', e.icon), title, toggle);
    const route = el('div', 'effect-routes'), select = el('select'); select.setAttribute('aria-label', `${e.name} audio band`);
    BANDS.forEach((b, i) => { const option = el('option', '', b.name); option.value = i; option.selected = e.band === i; select.append(option); });
    select.onchange = () => { e.band = Number(select.value); clearPreset(); };
    const slider = el('input'); slider.type = 'range'; slider.min = 0; slider.max = 1; slider.step = .01; slider.value = e.amount; slider.setAttribute('aria-label', `${e.name} intensity`);
    const value = el('output', '', Math.round(e.amount * 100) + '%'); slider.oninput = () => { e.amount = Number(slider.value); value.value = Math.round(e.amount * 100) + '%'; clearPreset(); };
    route.append(select, slider, value); card.append(head, route); $('effect-list').append(card);
  }
}
function clearPreset() { document.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active')); }
function drawLegend() {
  for (const [i, b] of BANDS.entries()) {
    const key = el('div', 'band-key'), dot = el('span'); dot.style.background = b.color;
    const range = b.range[1] >= 1000 ? `${b.range[0]}–${b.range[1] / 1000}k Hz` : `${b.range[0]}–${b.range[1]} Hz`;
    const value = el('output', '', '0%'); value.id = `band-value-${i}`;
    key.append(dot, document.createTextNode(b.name), el('small', '', range), value); $('band-legend').append(key);
  }
}
function drawGraph(t, energy) {
  const c = $('wave-graph'), dpr = Math.min(devicePixelRatio || 1, 2), w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const L = 26, R = w - 8, T = 12, B = h - 25, span = Math.min(10, analysis?.duration || 5);
  const start = clamp(t - span * .6, 0, Math.max(0, (analysis?.duration || 5) - span));
  const selectionLeft = L + clamp((clip.start - start) / span) * (R - L);
  const selectionRight = L + clamp((clip.end - start) / span) * (R - L);
  g.fillStyle = '#ff79b31a'; g.fillRect(selectionLeft, T, selectionRight - selectionLeft, B - T);
  g.strokeStyle = '#ffb87888'; g.lineWidth = 1;
  for (const x of [selectionLeft, selectionRight]) { g.beginPath(); g.moveTo(x, T); g.lineTo(x, B); g.stroke(); }
  g.font = '10px monospace'; g.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) { const y = T + (B - T) * i / 4; g.strokeStyle = '#52405d55'; g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); g.fillStyle = '#aa94b6'; g.fillText((1 - i / 4).toFixed(1), 0, y); }
  for (let i = 0; i <= 5; i++) { const x = L + (R - L) * i / 5; g.fillStyle = '#aa94b6'; g.fillText((start + span * i / 5).toFixed(1) + 's', x - 10, h - 7); }
  if (!analysis) return;
  for (const [i, b] of BANDS.entries()) {
    g.beginPath();
    const points = Math.max(120, Math.floor(w));
    for (let j = 0; j <= points; j++) { const seconds = start + j / points * span; const e = energyAt(analysis, seconds, state.gain)[i]; const x = L + j / points * (R - L), y = B - e * (B - T); j ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = b.color; g.lineWidth = 1.65; g.stroke();
    $(`band-value-${i}`).value = Math.round(energy[i] * 100) + '%';
  }
  const cursor = L + clamp((t - start) / span) * (R - L); g.setLineDash([3, 4]); g.strokeStyle = '#fff1f480'; g.beginPath(); g.moveTo(cursor, T); g.lineTo(cursor, B); g.stroke(); g.setLineDash([]);
  c.dataset.start = start; c.dataset.span = span;
}
function ensureAudio() {
  if (!audioContext) {
    audioContext = new AudioContext(); mediaSource = audioContext.createMediaElementSource(audio);
    recordBus = audioContext.createMediaStreamDestination(); mediaSource.connect(audioContext.destination); mediaSource.connect(recordBus);
  }
  return audioContext.resume();
}
const seekClock = seconds => youtube ? youtube.seek(seconds) : seekMedia(audio, seconds);
function syncPlaybackUI() {
  $('play').textContent = clock.paused ? '▶' : 'Ⅱ';
  $('play').setAttribute('aria-label', clock.paused ? 'Play audio' : 'Pause audio');
  dirty = true;
}
function syncYouTube() {
  if (!youtube || clock !== youtube) return;
  const duration = youtube.duration;
  if (duration && Math.abs(duration - analysis.duration) > .1) {
    analysis = blankYouTubeAnalysis(duration);
    clip = normalizeSelection(duration, youtubeSelection || clip); youtubeSelection = null;
    $('seek').max = duration; syncSelection();
  }
  syncPlaybackUI();
  if (!busy && !exportBusy) {
    if (youtube.buffering) $('status').textContent = 'YouTube is buffering…';
    else if (!youtube.paused) $('status').textContent = tabAudioStream ? 'Playing YouTube with live tab audio.' : 'Playing YouTube. Connect tab audio for reactive motion and export.';
    else if (youtube.readyState) $('status').textContent = 'YouTube paused.';
  }
}
function captureHelp() {
  const available = !!navigator.mediaDevices?.getDisplayMedia;
  $('youtube-connect').disabled = !youtube || !available || busy || exportBusy || sceneLoading;
  $('youtube-connect').textContent = tabAudioStream ? 'Disconnect tab audio' : 'Connect tab audio';
  $('youtube-info').textContent = !youtube ? 'Play a YouTube link here, or load a music file for full audio analysis and export.' : available
    ? tabAudioStream ? 'Live tab audio drives the bands and is included in exports.' : 'For reactive motion and export, connect this browser tab and enable Share tab audio.'
    : 'YouTube playback works here. For reactive motion and export on this browser, load an audio/video file.';
  $('analysis-note').textContent = youtube
    ? tabAudioStream ? 'Live filtered tab audio. The graph fills as you listen; unplayed parts have no measurements.' : 'YouTube playback only. Connect tab audio or load a music file to measure the four bands.'
    : 'Real filtered energy with eased attack and release. Frequency bands overlap at their filter slopes; they don’t isolate instruments.';
}
function stopTabAudio() {
  const stream = tabAudioStream; tabAudioStream = null;
  tabAudioNode?.disconnect(); tabAudioNode = null; liveBands?.destroy(); liveBands = null;
  stream?.getTracks().forEach(track => track.stop());
  if (youtube && analysis?.live) analysis = blankYouTubeAnalysis(analysis.duration);
  captureHelp(); syncSelection(); dirty = true;
}
function closeYouTube() {
  if (tabAudioStream) stopTabAudio();
  youtube?.destroy(); youtube = null; clock = audio; youtubeSelection = null;
  $('youtube-panel').hidden = true; $('youtube-mount').replaceChildren();
  captureHelp(); syncPlaybackUI();
}
async function loadYouTube(value, { selection, throwErrors = false } = {}) {
  if (busy || exportBusy) return;
  let source;
  try { source = parseYouTube(value); } catch (error) { if (throwErrors) throw error; toast(error.message); return; }
  busy = true; clock.pause(); syncSelection();
  const wasYouTube = !!youtube; closeYouTube();
  $('youtube-panel').hidden = false; $('youtube-url').value = source.url;
  const mount = el('div'); $('youtube-mount').append(mount);
  const candidate = new YouTubeTransport({ element: mount, origin: location.origin, onChange: syncYouTube,
    onFailure: error => {
      if (recorder?.state === 'recording') { recorder.captureError = error; stopRecording(); }
      $('status').textContent = error.message; captureHelp(); syncSelection();
    } });
  candidate.addEventListener('timeupdate', checkRecordingEnd); candidate.addEventListener('ended', stopRecording);
  youtube = candidate; $('status').textContent = 'Opening YouTube…';
  try {
    await candidate.open(source.url);
    clock = youtube; candidate.loop = $('loop').checked;
    youtubeSelection = selection || { start: source.start, end: source.start + 5 };
    analysis = blankYouTubeAnalysis(candidate.duration || Math.min(1800, Math.max(5, youtubeSelection.end)));
    clip = normalizeSelection(analysis.duration, youtubeSelection);
    if (candidate.duration) youtubeSelection = null;
    audioFile = null; audioSourceURL = null; sourceVideo = false;
    if (audio.dataset.objectUrl) { URL.revokeObjectURL(audio.dataset.objectUrl); delete audio.dataset.objectUrl; }
    $('track-name').textContent = `YouTube · ${source.id}`;
    $('track-detail').textContent = 'YouTube playback · connect tab audio for reactive animation and export';
    $('seek').max = analysis.duration; renderer.clearHistory(); syncYouTube(); captureHelp();
    $('status').textContent = 'YouTube ready. Press play, or connect tab audio to animate from the music.';
  } catch (error) {
    closeYouTube(); if (wasYouTube) restoreDemoAudio();
    if (throwErrors) throw error; fail(error);
  } finally { busy = false; syncSelection(); captureHelp(); }
}
async function connectTabAudio() {
  if (tabAudioStream) { stopTabAudio(); $('status').textContent = 'Tab audio disconnected. YouTube playback is still available.'; return; }
  if (!youtube || !navigator.mediaDevices?.getDisplayMedia || busy || exportBusy) return;
  const active = youtube; let stream;
  try {
    // Start the browser prompt in the click handler, before any await loses activation.
    const pending = navigator.mediaDevices.getDisplayMedia({ video: true,
      audio: { suppressLocalAudioPlayback: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      preferCurrentTab: true, selfBrowserSurface: 'include', monitorTypeSurfaces: 'exclude', systemAudio: 'exclude' });
    stream = await pending;
    if (youtube !== active || exportBusy) { stream.getTracks().forEach(track => track.stop()); return; }
    if (!stream.getAudioTracks().length) throw new Error('No audio was shared. Choose this browser tab and turn on Share tab audio.');
    const surface = stream.getVideoTracks()[0]?.getSettings?.().displaySurface;
    if (surface && surface !== 'browser') throw new Error('Choose a browser tab with audio, rather than an entire screen or window.');
    await ensureAudio();
    if (youtube !== active || exportBusy) { stream.getTracks().forEach(track => track.stop()); return; }
    tabAudioNode = audioContext.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    tabAudioNode.connect(recordBus); liveBands = new LiveAudioBands(audioContext, tabAudioNode); tabAudioStream = stream;
    const stopped = () => {
      if (tabAudioStream !== stream) return;
      if (recorder?.state === 'recording') { recorder.captureError = new Error('Tab audio sharing stopped during export. Reconnect and export again.'); stopRecording(); }
      stopTabAudio(); $('status').textContent = 'Tab audio sharing stopped. Reconnect it or load a music file.';
    };
    stream.getTracks().forEach(track => track.addEventListener('ended', stopped, { once: true }));
    captureHelp(); syncSelection(); $('status').textContent = 'Tab audio connected. Press play; the real audio now drives your scene.';
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    stopTabAudio();
    toast(error.name === 'NotAllowedError' ? 'Audio sharing was cancelled. You can try again or load a music file.' : error.message);
  }
}
function syncSelection(editingInput = '') {
  const duration = analysis?.duration || 0;
  const locked = busy || exportBusy || sceneLoading;
  $('storyboard-duration').value = `${formatClipDuration(storyboardDuration(storyboard.frames))} of ${formatClipDuration(duration)}`;
  $('storyboard').querySelectorAll('input, button').forEach(control => { control.disabled = locked; });
  if (duration) clip = normalizeSelection(duration, clip);
  for (const [id, value] of [['clip-start', clip.start], ['clip-end', clip.end], ['clip-start-time', clip.start], ['clip-end-time', clip.end]]) {
    $(id).max = duration || 5;
    if (id !== editingInput) $(id).value = Number(value.toFixed(3));
    $(id).disabled = locked || !duration;
  }
  $('clip-start').setAttribute('aria-valuetext', formatClipTime(clip.start));
  $('clip-end').setAttribute('aria-valuetext', formatClipTime(clip.end));
  $('clip-duration').value = `${formatClipDuration(clip.end - clip.start)} selected`;
  $('clip-timecode').value = `${formatClipTime(clip.start)} – ${formatClipTime(clip.end)}`;
  $('clip-highlight').style.left = `${duration ? clip.start / duration * 100 : 0}%`;
  $('clip-highlight').style.width = `${duration ? (clip.end - clip.start) / duration * 100 : 100}%`;
  $('clip-full').disabled = locked || !duration;
  for (const id of ['seek', 'play', 'loop', 'audio-file', 'video-file', 'project-file', 'layer-files', 'save-project', 'copy-link', 'reset-scene', 'youtube-url', 'youtube-load', 'youtube-close']) $(id).disabled = locked || !duration;
  $('youtube-connect').disabled = locked || !youtube || !navigator.mediaDevices?.getDisplayMedia;
  $('record').disabled = busy || sceneLoading || exportPreparing || !duration || !!(youtube && (!liveBands || youtube.error || !youtube.readyState));
  if (!exportBusy) $('record').textContent = `Export ${formatClipDuration(clip.end - clip.start)}`;
  dirty = true;
}
function changeSelection(edge, value, editingInput = '') {
  if (exportBusy || busy) return;
  clip = moveSelection(clip, edge, value, analysis?.duration || 0);
  syncSelection(editingInput);
  if (clock.paused && clock.readyState >= 1) { clock.currentTime = clip.start; renderer.clearHistory(); }
}
function restoreDemoAudio() {
  closeYouTube();
  if (audio.dataset.objectUrl) { URL.revokeObjectURL(audio.dataset.objectUrl); delete audio.dataset.objectUrl; }
  audioFile = null; audioSourceURL = null; sourceVideo = false; audio.src = './assets/backseat-40-45.mp3';
  analysis = { ...demoAnalysis, curves: prepareEnvelopes(demoAnalysis.raw, demoAnalysis.rate, state.response) };
  $('track-name').replaceChildren(document.createTextNode('Backseat '), el('span', '', '— DÊTRE'));
  $('track-detail').textContent = '5-second study · 00:40–00:45 of the original track';
  $('seek').max = analysis.duration;
}
function stopRecording() {
  if (recorder?.state === 'recording') {
    clock.pause(); exportPreparing = true; $('record').textContent = 'Finishing…'; syncSelection(); recorder.stop();
  }
}
function checkRecordingEnd() {
  if (recorder?.state === 'recording' && clock.currentTime >= recordEnd - .005) stopRecording();
}
async function record() {
  if (recorder?.state === 'recording') { stopRecording(); return; }
  if (exportBusy || busy || !analysis || (youtube && !liveBands)) return;
  if (!window.MediaRecorder || !canvas.captureStream) { toast('Video export is unavailable in this browser. Try current Chrome, Firefox, or Safari.'); return; }
  exportBusy = true; exportPreparing = true; recordingLoop = clock.loop;
  $('record').textContent = 'Preparing…'; $('status').textContent = 'Seeking to the selection start…'; syncSelection();
  let stream, recordingError;
  const release = () => {
    stream?.getVideoTracks().forEach(t => t.stop()); clock.pause(); clock.loop = recordingLoop;
    recorder = null; exportBusy = false; exportPreparing = false; syncSelection();
  };
  try {
    await ensureAudio();
    clock.pause(); clock.loop = false;
    if (clock.readyState < 1) await seekClock(0);
    const chosen = normalizeSelection(Math.min(analysis.duration, clock.duration), clip);
    if (chosen.end <= chosen.start) throw new Error('Choose a non-empty clip before exporting.');
    await seekClock(chosen.start);
    renderer.clearHistory();
    renderAt(chosen.start, energyAt(analysis, chosen.start, state.gain));
    stream = canvas.captureStream(30); for (const track of recordBus.stream.getAudioTracks()) stream.addTrack(track);
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4'].find(s => MediaRecorder.isTypeSupported(s));
    const active = recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6000000 } : undefined);
    const chunks = []; active.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    active.onstop = () => {
      release();
      if (recordingError || active.captureError) { fail(recordingError || active.captureError); return; }
      if (!chunks.length) { fail(new Error('The browser returned an empty recording. Please try again.')); return; }
      download(new Blob(chunks, { type: active.mimeType }), `dj-animate-${chosen.start.toFixed(1)}-${chosen.end.toFixed(1)}-${Date.now()}.${active.mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'}`);
      $('status').textContent = 'Video exported with audio.';
    };
    active.onerror = () => { recordingError = new Error('The browser could not record this scene. Try another browser or a smaller image.'); stopRecording(); };
    recordEnd = chosen.end; active.start(); exportPreparing = false; syncSelection();
    $('record').textContent = 'Stop export'; await clock.play();
  } catch (e) {
    recordingError = e;
    if (recorder?.state === 'recording') stopRecording(); else { release(); fail(e); }
  }
}
async function addFiles(files) {
  if (sceneLoading || exportBusy) return;
  const chosen = [...files].filter(f => f.type.startsWith('image/'));
  if (!chosen.length) { toast('Choose an image file for a sprite layer.'); return; }
  for (const file of chosen.slice(0, Math.max(0, 20 - layers.length))) {
    const url = URL.createObjectURL(file);
    try { const image = await loadImage(url); const l = layer(file.name.replace(/\.[^.]+$/, ''), image, layers.length ? 'sprite' : 'background', { objectURL: url }); layers.push(l); selected = l.id; }
    catch (e) { URL.revokeObjectURL(url); fail(e); }
  }
  drawLayers(); $('scene-label').textContent = 'Your scene'; $('status').textContent = 'Layer added. Select it to position and scale.';
}
async function loadAudio(file, { throwErrors = false, video = false, resize = true } = {}) {
  if (!file || busy || exportBusy) return;
  busy = true; clock.pause(); $('status').textContent = video ? 'Preparing video…' : 'Analyzing four frequency bands…'; syncSelection();
  let url = URL.createObjectURL(file);
  try {
    let duration, width, height;
    if (video) {
      const probe = document.createElement('video');
      probe.preload = 'auto'; probe.src = url;
      try {
        await seekMedia(probe, 0);
        if (!probe.videoWidth) throw new Error('Choose a file with a video track.');
        ({ duration, videoWidth: width, videoHeight: height } = probe);
      } finally { probe.removeAttribute('src'); probe.load(); }
    }
    if (duration > 1800) throw new Error('For this browser editor, use media under 30 minutes.');
    const bytes = await file.arrayBuffer(), decoder = new OfflineAudioContext(1, 1, 24000);
    const buffer = await decoder.decodeAudioData(bytes).catch(error => { if (!video) throw error; return null; });
    duration ??= buffer.duration;
    if (duration > 1800) throw new Error('For this browser editor, use media under 30 minutes.');
    const result = buffer ? await analyzeAudio(buffer) : blankYouTubeAnalysis(duration);
    closeYouTube();
    if (audio.dataset.objectUrl) URL.revokeObjectURL(audio.dataset.objectUrl);
    audio.dataset.objectUrl = url; audio.src = url; url = null; audioFile = file; audioSourceURL = null; sourceVideo = video;
    analysis = result; analysis.duration = duration;
    analysis.curves = prepareEnvelopes(analysis.raw, analysis.rate, state.response);
    clip = normalizeSelection(duration, video ? { start: 0, end: duration } : undefined);
    if (video && resize) {
      const scale = Math.min(1, 3840 / Math.max(width, height), Math.sqrt(4147200 / (width * height)));
      setCanvasSize(Math.max(256, Math.round(width * scale)), Math.max(256, Math.round(height * scale)));
      $('storyboard').open = true;
    }
    $('track-name').textContent = file.name;
    $('track-detail').textContent = video ? `${formatTime(duration)} · video timeline` : `${formatTime(duration)} · four bands analyzed locally`;
    $('seek').max = duration; $('status').textContent = video ? 'Video ready. Load four frames or press play.' : 'Your music is ready. Press play.';
  } catch (e) { if (throwErrors) throw e; fail(e); }
  finally { if (url) URL.revokeObjectURL(url); busy = false; syncSelection(); }
}
async function saveProject() {
  const button = $('save-project'); button.disabled = true;
  try {
    const savedLayers = await Promise.all(layers.map(async l => {
      const { image, renderImage, vehicleRuntime, objectURL, src, ...settings } = l;
      const data = await fileData(await (await fetch(image.src)).blob());
      if (settings.role === 'vehicle') settings.vehicle = { ...settings.vehicle, model: undefined, obj: vehicleRuntime.text };
      return { ...settings, data };
    }));
    const project = currentProject();
    project.layers = savedLayers;
    project.storyboard.frames = await Promise.all(project.storyboard.frames.map(async ({ src, ...settings }) =>
      src ? { ...settings, data: await fileData(await (await fetch(src)).blob()) } : settings));
    if (audioFile) project.audio = { name: audioFile.name, video: sourceVideo, data: await fileData(audioFile) };
    download(new Blob([JSON.stringify(project)], { type: 'application/json' }), 'my-scene.djscene.json'); toast('Project saved with its frames and media.');
  } catch (e) { fail(e); } finally { button.disabled = false; }
}
function setCanvasSize(width, height) {
  canvas.width = width; canvas.height = height; renderer.resize();
  canvas.parentElement.style.aspectRatio = `${width} / ${height}`;
  const gcd = (a, b) => b ? gcd(b, a % b) : a, divisor = gcd(width, height);
  const ratio = `${width / divisor}:${height / divisor}`;
  $('frame-ratio').textContent = ratio;
  $('frame-detail').textContent = `${ratio} · ${width} × ${height} · 30 fps`;
}
function currentProject() {
  return { format: 'dj-animate', version: 1, title: $('scene-label').textContent,
    canvas: { width: canvas.width, height: canvas.height }, state: { ...state }, selection: { ...clip }, effects, storyboard: storyboardProject(),
    layers: layers.map(({ image, renderImage, vehicleRuntime, objectURL, ...settings }) => ({ ...settings, src: image.src })),
    audio: youtube ? { source: 'youtube', url: youtube.source.url } : audioFile ? { name: audioFile.name, src: audioSourceURL || audio.src, video: sourceVideo } : null };
}
function applyControls(scene) {
  Object.assign(state, scene.state); effects = scene.effects;
  $('master').value = state.master; $('master-value').value = Math.round(state.master * 100) + '%';
  $('gain').value = state.gain; $('gain-value').value = state.gain.toFixed(2) + '×'; $('response').value = state.response;
  if (analysis && !analysis.live) analysis.curves = prepareEnvelopes(analysis.raw, analysis.rate, state.response);
  clip = normalizeSelection(analysis.duration, scene.selection);
  drawEffects(); clearPreset(); syncSelection(); renderer.clearHistory();
}
async function applyScene(project, baseURL = document.baseURI, overrides = {}) {
  const scene = overrideScene(normalizeScene(project, baseURL), overrides);
  const imported = await Promise.all(scene.layers.map(async ({ src, name, role, ...settings }) => prepareLayer(layer(name, await loadImage(src), role, settings))));
  const board = scene.storyboard && {
    ...scene.storyboard,
    frames: await Promise.all(scene.storyboard.frames.map(async ({ src, ...timing }) =>
      src ? { ...timing, image: await loadImage(src) } : timing)),
  };
  if (scene.audio?.source === 'youtube') {
    await loadYouTube(scene.audio.url, { selection: scene.selection, throwErrors: true });
  } else if (scene.audio) {
    const response = await fetch(scene.audio.src, { credentials: 'omit', mode: 'cors', signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error('Scene music could not be loaded. Check its URL and cross-origin access.');
    if (Number(response.headers.get('content-length')) > 134217728) throw new Error('Use music files under 128 MiB.');
    const blob = await response.blob();
    if (blob.size > 134217728) throw new Error('Use music files under 128 MiB.');
    await loadAudio(new File([blob], scene.audio.name, { type: blob.type }), { throwErrors: true, video: scene.audio.video, resize: false });
    audioSourceURL = scene.audio.src;
  } else restoreDemoAudio();
  clock.pause();
  layers.forEach(l => { if (l.objectURL) URL.revokeObjectURL(l.objectURL); });
  layers = imported; selected = layers.at(-1)?.id || '';
  setCanvasSize(scene.canvas.width, scene.canvas.height); applyStoryboard(board); applyControls(scene); drawLayers();
  $('scene-label').textContent = scene.title;
  if (!youtube || youtube.readyState) await seekClock(clip.start);
  $('status').textContent = youtube ? 'Scene loaded with YouTube. Press play; connect tab audio for reactive motion and export.' : 'Scene loaded. Press play to animate, or load your music.';
}
async function openProject(file) {
  if (!file || busy || exportBusy || sceneLoading) return;
  sceneLoading = true; syncSelection(); clock.pause();
  try {
    const p = JSON.parse(await file.text());
    await applyScene({ ...p, title: p.title || file.name.replace('.djscene.json', '') });
    toast('Project opened.');
  } catch (e) { fail(e); }
  finally { sceneLoading = false; syncSelection(); }
}
async function openSceneLink() {
  if (sceneLoading || busy || exportBusy) return;
  let request;
  try { request = sceneRequest(location.href); } catch (e) { fail(e); return; }
  if (!request) return;
  sceneLoading = true; clock.pause(); syncSelection(); $('status').textContent = 'Opening your prepared scene…';
  try {
    if (request.manifestURL || request.project) {
      const p = request.project || await fetchSceneJSON(request.manifestURL);
      await applyScene(p, request.manifestURL || request.baseURL, request.overrides);
    } else {
      const next = overrideScene(normalizeScene(currentProject(), document.baseURI), request.overrides);
      if (next.audio?.source === 'youtube') await loadYouTube(next.audio.url, { selection: next.selection, throwErrors: true });
      applyControls(next);
    }
  } catch (e) { fail(e); }
  finally { sceneLoading = false; syncSelection(); }
}
async function copySceneLink() {
  try {
    const url = makeSceneLink(currentProject(), location.href);
    $('scene-link').value = url;
    try { await navigator.clipboard.writeText(url); toast('Scene link copied, including layers, effects and clip range.'); }
    catch { $('link-dialog').showModal(); $('scene-link').select(); }
  } catch (e) { toast(e.message); }
}

function bind() {
  $('play').onclick = async () => { try { if (clock.paused) { if (clock.ended) clock.currentTime = 0; if (!youtube) await ensureAudio(); await clock.play(); } else clock.pause(); } catch (e) { if (e.name !== 'AbortError') fail(e); } };
  audio.onplay = () => { $('play').textContent = 'Ⅱ'; $('play').setAttribute('aria-label', 'Pause audio'); };
  audio.onpause = () => { $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Play audio'); };
  audio.onended = stopRecording;
  audio.onseeked = audio.onloadeddata = () => { dirty = true; };
  audio.addEventListener('timeupdate', checkRecordingEnd);
  $('seek').oninput = () => { clock.currentTime = Number($('seek').value); renderer.clearHistory(); };
  $('loop').onchange = () => { clock.loop = $('loop').checked; };
  $('storyboard-form').onsubmit = event => {
    event.preventDefault();
    const errorLabel = $('storyboard-error');
    try {
      parseStoryboard($('storyboard-timing').value).forEach((timing, i) => Object.assign(storyboard.frames[i], timing));
      errorLabel.textContent = ''; drawStoryboardInputs();
    } catch (error) { errorLabel.textContent = error.message; }
  };
  for (const edge of ['start', 'end']) {
    $(`clip-${edge}`).oninput = e => changeSelection(edge, Number(e.target.value));
    const timeInput = $(`clip-${edge}-time`);
    timeInput.oninput = e => {
      if (e.target.value !== '' && !e.target.validity.badInput) changeSelection(edge, Number(e.target.value), e.target.id);
    };
    timeInput.onchange = e => changeSelection(edge, e.target.value === '' ? NaN : Number(e.target.value));
    timeInput.onblur = () => syncSelection();
  }
  $('clip-full').onclick = () => { clip = normalizeSelection(analysis?.duration || 0, { start: 0, end: analysis?.duration || 0 }); syncSelection(); };
  $('video-file').onchange = e => { loadAudio(e.target.files[0], { video: true }); e.target.value = ''; };
  $('audio-file').onchange = e => loadAudio(e.target.files[0]); $('layer-files').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  const drop = $('layer-drop');
  for (const event of ['dragover', 'dragenter']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.add('dragging'); });
  for (const event of ['dragleave', 'drop']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.remove('dragging'); });
  drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
  document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { effects = preset(b.dataset.preset); clearPreset(); b.classList.add('active'); drawEffects(); renderer.clearHistory(); });
  $('master').oninput = () => { state.master = Number($('master').value); $('master-value').value = Math.round(state.master * 100) + '%'; };
  $('gain').oninput = () => { state.gain = Number($('gain').value); $('gain-value').value = state.gain.toFixed(2) + '×'; };
  $('response').onchange = () => { state.response = Number($('response').value); if (analysis && !analysis.live) analysis.curves = prepareEnvelopes(analysis.raw, analysis.rate, state.response); };
  $('youtube-form').onsubmit = e => { e.preventDefault(); loadYouTube($('youtube-url').value); };
  $('youtube-connect').onclick = connectTabAudio;
  $('youtube-close').onclick = () => { restoreDemoAudio(); clip = normalizeSelection(analysis.duration); syncSelection(); renderer.clearHistory(); $('status').textContent = 'Backseat demo restored.'; };
  $('record').onclick = record; $('save-project').onclick = saveProject; $('copy-link').onclick = copySceneLink;
  $('project-file').onchange = e => openProject(e.target.files[0]);
  $('reset-scene').onclick = () => { setCanvasSize(1280, 720); if (sourceVideo) { restoreDemoAudio(); clip = normalizeSelection(analysis.duration); } applyStoryboard(); syncSelection(); demoLayers().catch(fail); $('scene-label').textContent = 'Pendragon × Backseat'; };
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#scene=')) openSceneLink(); });
  window.addEventListener('popstate', openSceneLink);
  $('fullscreen').onclick = () => { const wrap = canvas.parentElement; (document.fullscreenElement ? document.exitFullscreen() : wrap.requestFullscreen()).catch(fail); };
  $('wave-graph').onclick = e => { if (exportBusy) return; const c = $('wave-graph'), r = c.getBoundingClientRect(); const fraction = clamp((e.clientX - r.left - 26) / (r.width - 34)); clock.currentTime = Number(c.dataset.start || 0) + fraction * Number(c.dataset.span || 5); renderer.clearHistory(); };
  document.addEventListener('keydown', e => { if (e.code === 'Space' && !['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(e.target.tagName)) { e.preventDefault(); $('play').click(); } });
}
let last = 0;
function frame(now) {
  requestAnimationFrame(frame); if (now - last < 1000 / 30) return; last = now;
  if (clock.paused && !dirty && clock.currentTime === lastAudioTime) return;
  const t = clock.currentTime || 0;
  if (youtube && liveBands && !clock.paused) {
    const measured = liveBands.read(t, Math.min(.1, (now - (frame.lastSample || now - 33)) / 1000), state.response);
    writeLiveSample(analysis, t, measured.raw, measured.values);
  }
  frame.lastSample = now;
  const energy = energyAt(analysis, t, state.gain);
  dirty = false; lastAudioTime = t;
  renderAt(t, energy, !clock.paused);
  drawGraph(t, energy); $('seek').value = t; $('time').textContent = `${formatTime(t)} / ${formatTime(analysis?.duration || 5)}`;
  if (recorder?.state === 'recording') {
    $('status').textContent = `Recording… ${Math.max(0, recordEnd - t).toFixed(1)}s left`;
    checkRecordingEnd();
  }
}
async function boot() {
  try {
    renderer = new SceneRenderer(canvas); drawLegend(); drawEffects(); bind(); drawStoryboardInputs(); syncSelection();
    const [, data] = await Promise.all([demoLayers(), fetch('./assets/backseat-analysis.json').then(r => { if (!r.ok) throw new Error('Sample analysis missing.'); return r.json(); })]);
    demoAnalysis = { ...data, raw: data.raw.map(x => Float32Array.from(x)) };
    analysis = { ...demoAnalysis, curves: prepareEnvelopes(demoAnalysis.raw, demoAnalysis.rate, state.response) };
    clip = normalizeSelection(analysis.duration); syncSelection();
    $('loading').hidden = true;
    if (renderer.mode === 'canvas') $('status').textContent = 'Canvas compatibility preview.';
    const embedded = $('embedded-scene');
    if (embedded) await applyScene(JSON.parse(embedded.textContent)); else await openSceneLink();
    requestAnimationFrame(frame);
  } catch (e) { $('loading').textContent = e.message; fail(e); }
}
boot();
