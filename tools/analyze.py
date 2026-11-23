"""Four RBJ filter bands and shared 60 Hz audio response data.

Matches the browser's Web Audio highpass/lowpass filter chain and dsp.mjs
normalization, response curve, and attack/release constants.
"""
import json
import subprocess
from pathlib import Path
import numpy as np
from scipy.signal import lfilter

BANDS = [
    ('Bass', 30, 160, .04, .26, '#ff73b7'),
    ('Low mids', 160, 650, .08, .34, '#ffb878'),
    ('Upper mids', 650, 4000, .05, .20, '#b695ff'),
    ('Highs', 4000, 10000, .015, .10, '#67dfd2'),
]

def biquad(data, cutoff, sr, highpass=False):
    w = 2 * np.pi * cutoff / sr
    c = np.cos(w)
    alpha = np.sin(w) / (2 * np.sqrt(.5))
    b = np.array([(1 + c) / 2, -(1 + c), (1 + c) / 2] if highpass else [(1 - c) / 2, 1 - c, (1 - c) / 2])
    a = np.array([1 + alpha, -2 * c, 1 - alpha])
    return lfilter(b / a[0], a / a[0], data)

def curves_from_raw(raw, rate=60):
    curves = []
    for values, band in zip(raw, BANDS):
        floor = np.quantile(values, .1) * .35
        ceiling = np.quantile(values, .95)
        if ceiling < 1e-7:
            curves.append(np.zeros_like(values)); continue
        x = np.clip((values - floor) / max(1e-7, ceiling - floor), 0, 1)
        x = x * x * (3 - 2 * x)
        v = 0.; smoothed = []
        for sample in x:
            tau = band[3] if sample > v else band[4]
            v += (sample - v) * (1 - np.exp(-1 / (rate * tau)))
            smoothed.append(v)
        curves.append(np.array(smoothed))
    return np.array(curves)

def analyze(audio_path, start=40, duration=5, sr=24000, rate=60):
    # Filter preceding audio as well to retain the filter state at the in point.
    decoded = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(audio_path), '-t', str(start + duration), '-vn', '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'])
    a = np.frombuffer(decoded, np.float32)
    start_sample = round(start * sr); end = min(len(a), round((start + duration) * sr))
    if end <= start_sample: raise ValueError('The selected segment is outside the audio.')
    hop = round(sr / rate); count = int(np.ceil((end - start_sample) / hop))
    raw = []
    for _, low, high, *_ in BANDS:
        filtered = biquad(biquad(a, low, sr, True), min(high, sr * .45), sr)[start_sample:end]
        padded = np.pad(filtered, (0, count * hop - len(filtered)))
        raw.append(np.sqrt(np.mean(padded.reshape(-1, hop) ** 2, axis=1)))
    raw = np.array(raw)
    return {'rate': rate, 'duration': (end - start_sample) / sr, 'source_start': start, 'raw': raw.tolist(), 'curves': curves_from_raw(raw, rate).tolist()}

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('audio', type=Path)
    parser.add_argument('--start', type=float, default=40)
    parser.add_argument('--duration', type=float, default=5)
    parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parents[1] / 'web/assets/backseat-analysis.json')
    args = parser.parse_args()
    result = analyze(args.audio, args.start, args.duration)
    args.out.write_text(json.dumps(result, separators=(',', ':')))
    print(f'Analyzed {result["duration"]:.2f}s into four 60 Hz curves: {args.out}')
