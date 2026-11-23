// Clip selection uses source-audio seconds, independent of playback/render fps.
const bounded = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const finite = n => Number.isFinite(n);
export const MIN_CLIP = .1;
export function normalizeSelection(duration, saved) {
  const total = finite(duration) ? Math.max(0, duration) : 0;
  const gap = Math.min(MIN_CLIP, total);
  const start = bounded(finite(saved?.start) ? saved.start : 0, 0, Math.max(0, total - gap));
  const end = bounded(finite(saved?.end) ? saved.end : Math.min(5, total), start + gap, total);
  return { start, end };
}
export function moveSelection(selection, edge, value, duration) {
  const clip = normalizeSelection(duration, selection);
  const total = finite(duration) ? Math.max(0, duration) : 0;
  const gap = Math.min(MIN_CLIP, total);
  if (!finite(value)) return clip;
  if (edge === 'start') clip.start = bounded(value, 0, clip.end - gap);
  if (edge === 'end') clip.end = bounded(value, clip.start + gap, total);
  return clip;
}
export function formatClipTime(seconds) {
  const ticks = Math.round(Math.max(0, finite(seconds) ? seconds : 0) * 10);
  return `${String(Math.floor(ticks / 600)).padStart(2, '0')}:${String(Math.floor(ticks % 600 / 10)).padStart(2, '0')}.${ticks % 10}`;
}
export function formatClipDuration(seconds) {
  const ticks = Math.round(Math.max(0, finite(seconds) ? seconds : 0) * 10);
  const secondsPart = (ticks % 600) / 10;
  return ticks >= 600 ? `${Math.floor(ticks / 600)}m ${secondsPart}s` : `${ticks / 10}s`;
}
function mediaEvent(media, event, ready, action, timeout) {
  return new Promise((resolve, reject) => {
    let timer;
    const clear = () => { clearTimeout(timer); media.removeEventListener(event, check); media.removeEventListener('error', error); };
    const check = () => { if (ready()) { clear(); resolve(); } };
    const error = () => { clear(); reject(new Error('The audio could not be loaded for export.')); };
    media.addEventListener(event, check); media.addEventListener('error', error);
    timer = setTimeout(() => { clear(); reject(new Error('Audio seeking timed out. Try loading the music again.')); }, timeout);
    try { if (media.error) { error(); return; } action?.(); check(); } catch (e) { clear(); reject(e); }
  });
}
export async function seekMedia(media, seconds, timeout = 15000) {
  if (media.readyState < 1) await mediaEvent(media, 'loadedmetadata', () => media.readyState >= 1, null, timeout);
  if (!finite(media.duration) || media.duration <= 0) throw new Error('Load a finite audio track before exporting.');
  const target = bounded(seconds, 0, media.duration);
  if (Math.abs(media.currentTime - target) < .001 && !media.seeking) {
    if (media.readyState < 2) await mediaEvent(media, 'loadeddata', () => media.readyState >= 2, null, timeout);
    return;
  }
  await mediaEvent(media, 'seeked', () => !media.seeking && media.readyState >= 2 && Math.abs(media.currentTime - target) < .02,
    () => { media.currentTime = target; }, timeout);
}
