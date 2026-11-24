import { clamp } from './dsp.mjs';
import { preset } from './effects.mjs';
import { parseYouTube } from './youtube.mjs';

export const SCENE_FORMAT = 'dj-animate';
export const MAX_LAYERS = 20;
export const MAX_MANIFEST_BYTES = 1024 * 1024;
const PRESETS = ['sunset', 'clean', 'fever', 'warp'];
const BLENDS = ['source-over', 'screen', 'lighter'];
const sceneFinite = (n, fallback, min, max) => Number.isFinite(n) ? clamp(n, min, max) : fallback;

// Public references must survive the conversation and keep the export canvas readable.
export function assetURL(value, baseURL, kind = 'image') {
  if (typeof value !== 'string' || !value) throw new Error(`A ${kind} asset is missing.`);
  if (value.startsWith('data:')) {
    if (kind === 'manifest') throw new Error('Use a hosted JSON manifest URL.');
    const pattern = kind === 'image' ? /^data:image\/(png|jpeg|jpg|webp|gif|avif|svg\+xml)[;,]/i : /^data:(audio\/|video\/|application\/octet-stream[;,])/i;
    if (!pattern.test(value)) throw new Error(`Invalid embedded ${kind}.`);
    return value;
  }
  const url = new URL(value, baseURL);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) {
    throw new Error('Scene assets need public HTTPS URLs or relative paths.');
  }
  return url.href;
}

export function normalizeScene(project, baseURL) {
  if (project?.format !== SCENE_FORMAT || project.version !== 1 || !Array.isArray(project.layers) || !project.layers.length || project.layers.length > MAX_LAYERS) {
    throw new Error('Choose a dj-animate version 1 scene with 1–20 prepared layers.');
  }
  const width = Math.round(sceneFinite(project.canvas?.width, 1280, 256, 3840));
  const height = Math.round(sceneFinite(project.canvas?.height, 720, 256, 3840));
  if (width * height > 4147200) throw new Error('Use a scene canvas of at most 4.1 megapixels.');
  const effects = preset(PRESETS.includes(project.preset) ? project.preset : 'sunset').map(effect => {
    const saved = Array.isArray(project.effects) ? project.effects.find(e => e.id === effect.id) : null;
    return saved ? { ...effect, on: saved.on === true, amount: sceneFinite(saved.amount, effect.amount, 0, 1), band: Math.round(sceneFinite(saved.band, effect.band, 0, 3)) } : effect;
  });
  const savedAudio = project.audio?.source === 'youtube'
    ? { source: 'youtube', url: parseYouTube(project.audio.url).url }
    : project.audio ? { name: String(project.audio.name || 'Scene music').slice(0, 120), src: assetURL(project.audio.src || project.audio.data, baseURL, 'audio') } : null;
  const sourceStart = savedAudio?.source === 'youtube' ? parseYouTube(savedAudio.url).start : 0;
  return {
    format: SCENE_FORMAT, version: 1, title: String(project.title || 'Your scene').slice(0, 120),
    canvas: { width, height },
    state: { master: sceneFinite(project.state?.master, .65, 0, 1.5), gain: sceneFinite(project.state?.gain, 1, 0, 2), response: [.55, 1, 1.8].includes(project.state?.response) ? project.state.response : 1 },
    selection: { start: sceneFinite(project.selection?.start, sourceStart, 0, 1800), end: sceneFinite(project.selection?.end, Math.min(1800, sourceStart + 5), 0, 1800) },
    effects,
    audio: savedAudio,
    layers: project.layers.map(l => {
      const background = l.role === 'background';
      return {
        name: String(l.name || 'Sprite').slice(0, 100), src: assetURL(l.src || l.data, baseURL),
        role: background ? 'background' : 'sprite', visible: l.visible !== false, motion: l.motion !== false,
        x: sceneFinite(l.x, 50, -20, 120), y: sceneFinite(l.y, background ? 50 : 97, -20, 120),
        scale: sceneFinite(l.scale, 1, .03, 3), opacity: sceneFinite(l.opacity, 1, 0, 1), depth: sceneFinite(l.depth, background ? -.35 : 1, -1, 2),
        blend: BLENDS.includes(l.blend) ? l.blend : 'source-over', band: Math.round(sceneFinite(l.band, 0, 0, 3)),
        pulse: sceneFinite(l.pulse, 0, 0, .1), flicker: sceneFinite(l.flicker, 0, 0, .3),
      };
    }),
  };
}

export function sceneRequest(href) {
  const url = new URL(href), query = url.searchParams, hash = new URLSearchParams(url.hash.slice(1));
  const overrides = {};
  if (query.has('yt') || query.has('youtube')) {
    if (query.has('yt') && query.has('youtube')) throw new Error('Use one YouTube audio link.');
    overrides.youtube = parseYouTube(query.get('yt') || query.get('youtube'));
  }
  if (query.has('preset')) {
    if (!PRESETS.includes(query.get('preset'))) throw new Error('Unknown effect preset in the scene link.');
    overrides.preset = query.get('preset');
  }
  for (const [name, min, max] of [['master', 0, 1.5], ['gain', 0, 2], ['response', .55, 1.8], ['start', 0, 1800], ['end', 0, 1800], ['duration', .1, 1800]]) {
    if (!query.has(name)) continue;
    const raw = query.get(name), value = Number(raw);
    if (!raw.trim() || !Number.isFinite(value) || value < min || value > max || (name === 'response' && ![.55, 1, 1.8].includes(value))) throw new Error(`Invalid ${name} in the scene link.`);
    overrides[name] = value;
  }
  const sources = [query.has('scene'), query.has('manifest'), hash.has('scene')].filter(Boolean).length;
  if (sources > 1) throw new Error('Use one scene source per link.');
  if (hash.has('scene')) {
    const encoded = hash.get('scene');
    if (!encoded || encoded.length > 24000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('The scene link is invalid or too large.');
    try {
      const bytes = Uint8Array.from(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
      return { project: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), baseURL: url.href, overrides };
    } catch { throw new Error('The scene link could not be decoded.'); }
  }
  if (query.has('scene')) {
    const id = query.get('scene');
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('Invalid scene name.');
    return { manifestURL: new URL(`./scenes/${id}/scene.djscene.json`, url).href, overrides };
  }
  if (query.has('manifest')) return { manifestURL: assetURL(query.get('manifest'), url.href, 'manifest'), overrides };
  return Object.keys(overrides).length ? { overrides } : null;
}

export function overrideScene(scene, overrides = {}) {
  const out = { ...scene, state: { ...scene.state }, selection: { ...scene.selection } };
  if (overrides.youtube) {
    out.audio = { source: 'youtube', url: overrides.youtube.url };
    out.selection = { start: overrides.youtube.start, end: Math.min(1800, overrides.youtube.start + 5) };
  }
  if (overrides.preset) out.effects = preset(overrides.preset);
  for (const key of ['master', 'gain', 'response']) if (overrides[key] !== undefined) out.state[key] = overrides[key];
  if (overrides.start !== undefined) out.selection.start = overrides.start;
  if (overrides.end !== undefined) out.selection.end = overrides.end;
  else if (overrides.duration !== undefined) out.selection.end = out.selection.start + overrides.duration;
  return out;
}

export function makeSceneLink(project, href) {
  const references = [...(project.layers || []).map(l => l.src || l.data), ...(project.audio ? [project.audio.src || project.audio.data] : [])];
  if (references.some(src => /^(blob:|data:|file:)/i.test(src || ''))) throw new Error('Save a project to keep local uploads. A scene link needs hosted image and music files.');
  const normalized = normalizeScene(project, href);
  const urls = [...normalized.layers.map(l => l.src), ...(normalized.audio?.src ? [normalized.audio.src] : [])];
  if (urls.some(src => src.startsWith('data:'))) throw new Error('Save a project to keep local uploads. A scene link needs hosted image and music files.');
  const bytes = new TextEncoder().encode(JSON.stringify(normalized));
  const encoded = btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  if (encoded.length > 24000) throw new Error('This scene is too large for a link. Save a project instead.');
  const url = new URL(href); url.search = ''; url.hash = `scene=${encoded}`;
  return url.href;
}

export async function fetchSceneJSON(url) {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Scene could not be opened (${response.status}). Check its published link.`);
  if (Number(response.headers.get('content-length')) > MAX_MANIFEST_BYTES) throw new Error('The scene manifest is too large.');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_MANIFEST_BYTES) throw new Error('The scene manifest is too large.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(data));
}

export function layerPulse(layer, bands, master) {
  const energy = layer.motion ? clamp((bands[layer.band || 0] || 0) * master) : 0;
  return { scale: 1 + energy * (layer.pulse || 0), alpha: layer.opacity * (1 - energy * (layer.flicker || 0)) };
}
