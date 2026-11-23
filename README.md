# dj-animate 0.2

Space Pirates' layered music animation studio. Static HTML, CSS, ES modules,
Web Audio and WebGL. No build dependencies, accounts, monthly services, or server.

Music Videos: Unchained. Source: `cityplanners/dj-animate`.

## Run

Requires Node 20 or later:

```sh
npm test
npm run dev
```

Open http://localhost:3000. `npm run build` copies the static app into `dist/`.
The app works under a repository subpath and a custom hostname.

`npm run bundle:offline` creates a self-contained `dist/dj-animate.html` with
inline source, styles and demo media. Open that one HTML file in a browser;
it needs no local server or network. It has the same editor and upload controls.

## Workflow

1. Dissect an illustration into a clean background, transparent sprites, props,
   and optional light/shadow overlays **before animation**. This editor loads
   those prepared assets; it does not automatically segment a flattened photo.
2. Load images individually or drop several onto Scene layers. Use the layer
   inspector to change position, scale, alpha, type, depth, visibility and motion.
   Back/Front change compositing order. Maximum 20 layers.
3. Load audio or an MP4/WebM with audio. Decoding and analysis stay on the device.
4. Choose a preset, toggle individual effects, choose a driver band per effect,
   and set effect amounts, master intensity, audio gain and response smoothing.
5. Drag the Video selection start/end handles, or enter exact start/end seconds.
   The selected section is highlighted in the waveform, and the export button
   shows its duration. Choose **Full track** to export the entire loaded song.
   Exports seek to the selection start and record that range with audio; changing
   the playhead first does not change the selected export. The browser selects
   WebM or MP4 according to MediaRecorder support.
6. Save an embedded `.djscene.json` project to retain images, loaded audio,
   transforms, routes, selection range, and settings. Reopen it through Open project.
   Older project files remain compatible and default to a five-second selection.

The bundled sample is Backseat by DÊTRE, source 00:40–00:45 from the user's supplied
file. The demo contains a background plate and a Pendragon sprite generated for
this scene. Asset usage rights are not a software license; review demo media
before publicly distributing it. No full song is bundled.

## Audio algorithm

Four independent highpass → lowpass chains, each a two-pole Butterworth/Q=√½
RBJ biquad pair. The roll-offs overlap naturally. Web Audio's native filters
perform the browser analysis; `tools/analyze.py` matches their coefficients.
These are energy envelopes, not sine waves or separated instrument stems.

| Curve | Frequencies | Attack | Release | Typical visual role |
| --- | --- | --- | --- | --- |
| Bass | 30–160 Hz | 40 ms | 260 ms | Breathe, shockwave, lens depth |
| Low mids | 160–650 Hz | 80 ms | 340 ms | Body sway, depth drift, liquid motion |
| Upper mids | 650–4,000 Hz | 50 ms | 200 ms | Lead texture, echo, bloom |
| Highs | 4,000–10,000 Hz | 15 ms | 100 ms | Hats, prism edges, tape displacement |

Pipeline per band: filter → RMS in 1/60-second windows → noise floor derived
from the 10th percentile → robust 95th-percentile normalization → clamp →
smoothstep `x²(3−2x)` → asymmetric exponential attack/release.
Silence is explicitly zeroed. Normalize each band separately so strong bass
does not hide the others. Between analysis samples, interpolate against the
audio playback clock to stay aligned through seeks and variable frame rates.
The response menu scales attack and release together. The graph shows the
processed envelopes rather than a decorative oscillator.

Motion is limited and independently routed. The compositor draws layer depth
and anchor transforms, then a WebGL shader applies selected scene distortions.
Feedback history clears after a seek/loop and doesn't advance while paused.

## Effects

| Effect | What it does | Default driver |
| --- | --- | --- |
| Bass breathe | Subtle scale/anchor motion | Bass |
| Depth drift | Different displacement by layer depth | Low mids |
| Prism split | RGB edge separation | Highs |
| Shockwave | Concentric UV displacement | Bass |
| Heat haze | Sinusoidal liquid refraction | Low mids |
| Afterimage | Previous-frame feedback | Upper mids |
| Kaleidoscope | Sixfold radial reflection | Upper mids |
| Tape drift | Scan-line displacement | Highs |
| Neon bloom | Highlight halo | Upper mids |
| Sunset shift | Palette rotation | Low mids |
| Digital melt | Reactive pixelation | Highs |
| Vertigo | Radial distortion and vortex | Bass |

Additional directions for later: displacement-map masking, per-sprite RGB
splits, flow-map hair/cloth motion, beat-triggered slit scan, luma key trails,
datamosh via motion vectors, and signed-distance edge glow. Those are ideas,
not implemented toggles in this release.

## Files

- `web/src/dsp.mjs`: envelope normalization, smoothing, audio-time sampling,
  and browser filter bank.
- `web/src/renderer.mjs`: layer compositor and WebGL distortions.
- `web/src/effects.mjs`: real effect routing and presets.
- `web/src/app.mjs`: editor, uploads, playback, graph, project I/O and export.
- `tools/analyze.py`: matching offline analysis and sample data generation.
- `tools/plot_waves.py`: publication-size PNG/SVG graph and CSV data.
- `web/src/selection.mjs`: clip bounds, duration labels, and seek-before-record handling.
- `tools/standalone.mjs`: optional portable one-file editor.
- `tools/make_gif.py`: turn an exported video into an exact five-second GIF
  with `python tools/make_gif.py recording.webm --out sample.gif` (FFmpeg required).
- `tests/dsp.test.mjs`: meaningful silence, timing, smoothing and routing checks.
- `web/assets/backseat-analysis.json`: measured four-band sample data.

## GitHub Pages: City Planners

The production hostname is `dj.cityplanners.co`, served by GitHub Pages from
`cityplanners/dj-animate`.

The included workflow tests, builds, uploads `dist/`, and deploys on pushes to
`main` or manual dispatch. There is no Site hosting registration; GitHub Pages
is the intended production host.

1. Put this source in the desired GitHub repository. Push a `main` branch.
2. Repository Settings → Pages → Build and deployment → **GitHub Actions**.
3. In the same Pages settings, set the custom domain to **dj.cityplanners.co**.
   The bundled CNAME file documents the intended hostname; Actions deployments
   do not configure the repository's custom-domain setting through CNAME.
4. In Squarespace DNS, add CNAME **dj** → **cityplanners.github.io** (no protocol, path, or repo
   name). Remove a conflicting A/AAAA/CNAME for that exact subdomain first.
5. After DNS validation and certificate provisioning, enable Enforce HTTPS.
6. Run the Pages workflow. Verify the deployed scene, upload flow and audio.

GitHub Pages is enabled with the included Actions workflow. Custom-domain
routing requires both the Pages custom-domain setting and the Squarespace DNS
record. GitHub provisions the HTTPS certificate once the DNS check succeeds.

The static document head includes Twitter large-image and Open Graph metadata,
with `dj.cityplanners.co` as its canonical address. The preview image is the
original Pendragon mural illustration, unchanged. Its absolute public GitHub
image URL keeps the image reachable independently of custom-domain DNS.

Official references:
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
- https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext
- https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder

## Limits

Preview and recording are real-time and depend on browser/GPU speed. Frame rate
may drop on large scenes. The graph and motion still use the audio clock, but a
browser recording is not a deterministic offline renderer. WebGL uses the native
720p canvas; devices without WebGL use a 480×270 Canvas fallback with the same
effects, scaled to the 720p export canvas. Canvas capture/MediaRecorder are
required for video export. GIFs
are silent; use the browser's video export to include audio. Uploaded tracks
are limited to 30 minutes to bound analysis memory. The demo GIF is five seconds.

## Validation for this package

- Node tests cover browser/offline envelope parity, clip bounds, saved range
  restoration, and waiting for media seeking before export.
- Browser checks passed for Canvas preview, audio upload and four-band analysis,
  sprite upload, visibility, effect toggles and routing, and embedded project
  save/reopen (images, audio, transforms and selected routes restored).
- Five-second browser video export includes both 1280×720 video and audio.
  The requested silent GIF is converted from that actual editor export:
  100 frames at 20 fps, exactly 5,000 ms, 960×540.
- Browser trim checks cover dragging a handle, a 1.0–8.5-second selection on
  a longer uploaded track, export with video/audio from that selection, and
  saving/reopening the selected range. MediaRecorder output includes browser
  timing overhead; selection is not a frame-accurate offline trim.
- The preview browser did not expose WebGL. The shader path is implemented
  but could not be exercised there; the Canvas fallback was the path tested.
- Custom-domain DNS and mobile hardware have not been exercised.
