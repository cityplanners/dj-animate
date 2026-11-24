import { BANDS, clamp, quantile } from './dsp.mjs';

export function parseYouTube(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Paste a valid YouTube video link.');
  let input = value.trim();
  if (/^[\w-]{11}$/.test(input)) input = `https://www.youtube.com/watch?v=${input}`;
  if (/^(www\.|m\.|music\.)?youtube\.com\//i.test(input) || /^youtu\.be\//i.test(input)) input = 'https://' + input;
  let url; try { url = new URL(input); } catch { throw new Error('Paste a YouTube video link, such as https://youtu.be/VIDEO_ID.'); }
  const host = url.hostname.toLowerCase();
  const full = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com'];
  if (url.protocol !== 'https:' || url.username || url.password || url.port || (!full.includes(host) && !['youtu.be', 'www.youtu.be'].includes(host))) throw new Error('Use a YouTube HTTPS video link.');
  const parts = url.pathname.split('/').filter(Boolean);
  const id = host.endsWith('youtu.be') ? (parts.length === 1 ? parts[0] : '') : url.pathname === '/watch' ? url.searchParams.get('v') : ['shorts', 'live', 'embed', 'v'].includes(parts[0]) && parts.length === 2 ? parts[1] : '';
  if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) throw new Error('That link needs an individual YouTube video, rather than a playlist or channel.');
  const raw = url.searchParams.get('t') || url.searchParams.get('start') || new URLSearchParams(url.hash.slice(1)).get('t') || '0';
  let start;
  if (/^\d+(\.\d+)?s?$/.test(raw)) start = Number(raw.replace(/s$/, ''));
  else {
    const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!match || !match[0]) throw new Error('The YouTube link contains an invalid start time.');
    start = Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  }
  if (!Number.isFinite(start) || start > 1799.9) throw new Error('Choose a start time within the first 30 minutes.');
  return { id, start, url: `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}` : ''}` };
}

let youtubeAPIPromise;
export function loadYouTubeAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeAPIPromise) return youtubeAPIPromise;
  youtubeAPIPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const script = document.createElement('script');
    const timeout = setTimeout(() => { youtubeAPIPromise = null; script.remove(); reject(new Error('YouTube did not load. Check your connection or load a music file.')); }, 20000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timeout); if (typeof previous === 'function') { try { previous(); } catch {} } resolve(window.YT); };
    script.src = 'https://www.youtube.com/iframe_api'; script.async = true;
    script.onerror = () => { clearTimeout(timeout); youtubeAPIPromise = null; script.remove(); reject(new Error('YouTube is unavailable. Load an audio/video file instead.')); };
    document.head.append(script);
  });
  return youtubeAPIPromise;
}

export function youtubeError(code) {
  if ([101, 150].includes(code)) return 'The owner disabled embedded playback. Try another YouTube link or load a music file.';
  if (code === 100) return 'This YouTube video is private, removed, or unavailable.';
  if (code === 153) return 'YouTube could not identify this page. Use the HTTPS website rather than an offline file.';
  return `YouTube could not play this video (error ${code}). Try another link or load a music file.`;
}

// Media-like transport lets the studio keep one clock for local files and YouTube.
export class YouTubeTransport extends EventTarget {
  constructor({ element, origin, onChange = () => {}, onFailure = () => {}, loader = loadYouTubeAPI }) {
    super(); Object.assign(this, { element, origin, onChange, onFailure, loader });
    this.ready = false; this.loop = true; this.error = null; this.seeking = false; this.closed = false; this.lastDuration = 0; this.playRequested = false;
  }
  async open(source) {
    this.source = parseYouTube(source);
    const api = await this.loader();
    if (this.closed) throw new Error('YouTube loading was cancelled.');
    await new Promise((resolve, reject) => {
      this.openReject = reject;
      this.readyTimeout = setTimeout(() => reject(new Error('The YouTube player timed out. Try another link.')), 20000);
      this.player = new api.Player(this.element, {
        width: '100%', height: '100%', videoId: this.source.id,
        playerVars: { playsinline: 1, controls: 1, start: Math.floor(this.source.start), origin: this.origin },
        events: {
          onReady: () => { clearTimeout(this.readyTimeout); this.openReject = null; this.ready = true; this.onChange(); resolve(); },
          onStateChange: event => {
            if (this.closed) return;
            this.tick();
            if (event.data === 0) {
              this.dispatchEvent(new Event('ended'));
              if (this.loop) { this.player.seekTo(0, true); this.player.playVideo(); }
            }
            this.onChange(); this.dispatchEvent(new Event('statechange'));
          },
          onAutoplayBlocked: () => { this.onChange(); this.onFailure(new Error('Press Play in the YouTube player to start audio.')); },
          onError: event => {
            const error = this.error = new Error(youtubeError(event.data));
            clearTimeout(this.readyTimeout); this.dispatchEvent(new Event('error'));
            if (this.openReject) { this.openReject(error); this.openReject = null; } else this.onFailure(error);
          },
        },
      });
    });
    this.timer = setInterval(() => this.tick(), 100);
    this.tick(); return this;
  }
  get duration() { const n = this.player?.getDuration?.() || 0; return Number.isFinite(n) ? Math.min(1800, Math.max(0, n)) : 0; }
  get readyState() { return this.ready && !this.error && this.duration > 0 ? 2 : 0; }
  get paused() { return !this.playRequested && ![1, 3].includes(this.player?.getPlayerState?.()); }
  get buffering() { return this.playRequested || this.player?.getPlayerState?.() === 3; }
  get ended() { return this.player?.getPlayerState?.() === 0; }
  get currentTime() { return Math.max(0, this.player?.getCurrentTime?.() || 0); }
  set currentTime(seconds) { if (this.ready) this.player.seekTo(clamp(seconds, 0, this.duration || 1800), true); }
  async play(timeout = 15000) {
    if (this.error) throw this.error;
    if (!this.ready) throw new Error('Wait for the YouTube player to load.');
    this.playRequested = true; this.onChange();
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return; settled = true; this.playRequested = false;
        clearTimeout(timer); this.removeEventListener('statechange', check); this.removeEventListener('error', check); this.removeEventListener('close', check); this.removeEventListener('pause-request', check);
        this.onChange(); error ? reject(error) : resolve();
      };
      const check = event => {
        if (this.closed || this.error) { finish(this.error || new DOMException('YouTube was closed.', 'AbortError')); return; }
        if (event?.type === 'pause-request') { finish(new DOMException('YouTube playback was paused.', 'AbortError')); return; }
        const state = this.player.getPlayerState();
        if (state === 1) finish();
        else if (state === 2 && event?.type === 'statechange') finish(new DOMException('YouTube playback was paused.', 'AbortError'));
      };
      const timer = setTimeout(() => { finish(new Error('YouTube is still buffering. Try Play inside its player, another link, or a music file.')); this.pause(); }, timeout);
      this.addEventListener('statechange', check); this.addEventListener('error', check); this.addEventListener('close', check); this.addEventListener('pause-request', check);
      try { this.player.playVideo(); check(); } catch (error) { finish(error); }
    });
  }
  pause() { this.playRequested = false; if (this.ready) this.player.pauseVideo(); this.dispatchEvent(new Event('pause-request')); this.onChange(); }
  tick() {
    if (this.closed) return;
    if (this.duration && this.duration !== this.lastDuration) { this.lastDuration = this.duration; this.dispatchEvent(new Event('loadedmetadata')); this.onChange(); }
    if (this.currentTime >= 1800 && !this.paused) { this.pause(); this.dispatchEvent(new Event('ended')); }
    this.dispatchEvent(new Event('timeupdate'));
  }
  async seek(seconds, timeout = 12000) {
    if (!this.readyState) throw new Error('Play the YouTube video once to load its duration, then choose a clip.');
    const target = clamp(seconds, 0, this.duration), started = Date.now();
    this.seeking = true; this.currentTime = target;
    try {
      await new Promise((resolve, reject) => {
        const check = () => {
          if (this.closed || this.error) { reject(this.error || new Error('YouTube was closed.')); return; }
          if (Math.abs(this.currentTime - target) < .15) { resolve(); return; }
          if (Date.now() - started > timeout) { reject(new Error('YouTube could not seek to this clip. Play the video once and try again.')); return; }
          setTimeout(check, 50);
        }; check();
      });
    } finally { this.seeking = false; }
  }
  destroy() {
    this.closed = true; clearInterval(this.timer); clearTimeout(this.readyTimeout);
    this.dispatchEvent(new Event('close'));
    if (this.openReject) { this.openReject(new Error('YouTube loading was cancelled.')); this.openReject = null; }
    this.player?.destroy(); this.player = null;
  }
}

export class LiveEnergyFollower {
  constructor() { this.windows = BANDS.map(() => []); this.values = [0, 0, 0, 0]; }
  reset() { this.values.fill(0); }
  update(rms, dt, response = 1) {
    return BANDS.map((band, i) => {
      const raw = Math.max(0, rms[i] || 0), window = this.windows[i];
      window.push(raw); if (window.length > 120) window.shift();
      const floor = quantile(window, .1) * .35, peak = Math.max(.015, quantile(window, .95));
      const x = raw < 1e-7 ? 0 : clamp((raw - floor) / Math.max(1e-7, peak - floor));
      const target = x * x * (3 - 2 * x), previous = this.values[i];
      const tau = (target > previous ? band.attack : band.release) * response;
      return this.values[i] += (target - previous) * (1 - Math.exp(-clamp(dt, 0, .1) / tau));
    });
  }
}

export class LiveAudioBands {
  constructor(context, source) {
    this.source = source; this.follower = new LiveEnergyFollower(); this.nodes = []; this.lastTime = null;
    this.silent = context.createGain(); this.silent.gain.value = 0; this.silent.connect(context.destination);
    this.analysers = BANDS.map(band => {
      const hp = context.createBiquadFilter(), lp = context.createBiquadFilter(), analyser = context.createAnalyser();
      hp.type = 'highpass'; hp.frequency.value = band.range[0]; hp.Q.value = Math.SQRT1_2;
      lp.type = 'lowpass'; lp.frequency.value = Math.min(band.range[1], context.sampleRate * .45); lp.Q.value = Math.SQRT1_2;
      analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0;
      source.connect(hp); hp.connect(lp); lp.connect(analyser); analyser.connect(this.silent);
      this.nodes.push(hp, lp, analyser); return { analyser, samples: new Float32Array(analyser.fftSize) };
    });
  }
  read(time, dt, response) {
    if (this.lastTime !== null && (time < this.lastTime || Math.abs(time - this.lastTime) > .3)) this.follower.reset();
    this.lastTime = time;
    const raw = this.analysers.map(({ analyser, samples }) => {
      analyser.getFloatTimeDomainData(samples); let sum = 0;
      for (const n of samples) sum += n * n;
      return Math.sqrt(sum / samples.length);
    });
    return { raw, values: this.follower.update(raw, dt, response) };
  }
  destroy() { this.nodes.forEach(node => node.disconnect()); this.silent.disconnect(); }
}

export function blankYouTubeAnalysis(duration) {
  const rate = 60, frames = Math.max(2, Math.ceil(Math.min(1800, Math.max(0, duration)) * rate) + 2);
  return { live: true, duration, rate, raw: BANDS.map(() => new Float32Array(frames)), curves: BANDS.map(() => new Float32Array(frames)) };
}

export function writeLiveSample(analysis, time, raw, values) {
  const index = Math.min(analysis.curves[0].length - 1, Math.max(0, Math.floor(time * analysis.rate)));
  const previous = analysis.lastIndex;
  const from = previous !== undefined && index >= previous && index - previous < analysis.rate * .3 ? previous : index;
  for (let band = 0; band < 4; band++) {
    analysis.raw[band].fill(raw[band], from, index + 2);
    analysis.curves[band].fill(values[band], from, index + 2);
  }
  analysis.lastIndex = index;
}
