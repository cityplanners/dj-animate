// Shared envelope math. Animation samples the audio clock, never the frame count.
export const BANDS = [
  { id: 'bass', name: 'Bass', range: [30, 160], color: '#ff73b7', attack: .04, release: .26 },
  { id: 'body', name: 'Low mids', range: [160, 650], color: '#ffb878', attack: .08, release: .34 },
  { id: 'lead', name: 'Upper mids', range: [650, 4000], color: '#b695ff', attack: .05, release: .20 },
  { id: 'air', name: 'Highs', range: [4000, 10000], color: '#67dfd2', attack: .015, release: .10 },
];
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export function quantile(values, q) {
  const a = Array.from(values).sort((x, y) => x - y);
  if (!a.length) return 0;
  const p = (a.length - 1) * q, lo = Math.floor(p);
  return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (p - lo);
}
export function normalizeEnergy(raw) {
  const floor = quantile(raw, .1) * .35, ceiling = quantile(raw, .95);
  if (ceiling < 1e-7) return Float32Array.from(raw, () => 0);
  return Float32Array.from(raw, v => {
    const x = clamp((v - floor) / Math.max(1e-7, ceiling - floor));
    return x * x * (3 - 2 * x);
  });
}
export function smoothEnvelope(raw, rate, attack, release) {
  let v = 0;
  return Float32Array.from(raw, x => {
    const tau = Math.max(.001, x > v ? attack : release);
    v += (x - v) * (1 - Math.exp(-1 / (rate * tau)));
    return v;
  });
}
export function sampleCurve(values, seconds, rate = 60) {
  if (!values?.length) return 0;
  const p = clamp(seconds * rate, 0, values.length - 1), i = Math.floor(p);
  return values[i] + (values[Math.min(i + 1, values.length - 1)] - values[i]) * (p - i);
}
export function prepareEnvelopes(raw, rate, response = 1) {
  return BANDS.map((band, i) => smoothEnvelope(normalizeEnergy(raw[i]), rate,
    band.attack * response, band.release * response));
}
export function energyAt(analysis, t, gain = 1) {
  return BANDS.map((_, i) => clamp(sampleCurve(analysis?.curves?.[i], t, analysis?.rate ?? 60) * gain));
}
// Two-pole high + low pass filters match the offline Python RBJ biquads.
export async function analyzeAudio(buffer) {
  const rate = 60, sr = buffer.sampleRate;
  const offline = new OfflineAudioContext(4, buffer.length, sr);
  const source = offline.createBufferSource(); source.buffer = buffer;
  const merge = offline.createChannelMerger(4);
  for (let i = 0; i < 4; i++) {
    const hp = offline.createBiquadFilter(), lp = offline.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = BANDS[i].range[0]; hp.Q.value = Math.SQRT1_2;
    lp.type = 'lowpass'; lp.frequency.value = Math.min(BANDS[i].range[1], sr * .45); lp.Q.value = Math.SQRT1_2;
    source.connect(hp); hp.connect(lp); lp.connect(merge, 0, i);
  }
  merge.connect(offline.destination); source.start();
  const filtered = await offline.startRendering();
  const hop = Math.round(sr / rate), count = Math.ceil(buffer.length / hop);
  const raw = BANDS.map((_, i) => {
    const data = filtered.getChannelData(i), result = new Float32Array(count);
    for (let f = 0; f < count; f++) {
      let sum = 0; const start = f * hop, end = Math.min(start + hop, data.length);
      for (let j = start; j < end; j++) sum += data[j] * data[j];
      result[f] = Math.sqrt(sum / Math.max(1, end - start));
    }
    return result;
  });
  return { rate, raw, curves: prepareEnvelopes(raw, rate), duration: buffer.duration };
}
