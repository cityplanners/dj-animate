// Optional one-file editor: embedded media, CSS, and inline module source.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..'), web = path.join(root, 'web');
let html = await readFile(path.join(web, 'index.html'), 'utf8');
const css = await readFile(path.join(web, 'style.css'), 'utf8');
let script = '';
for (const name of ['dsp', 'effects', 'youtube', 'storyboard', 'scene', 'renderer', 'selection', 'app']) {
  const source = await readFile(path.join(web, 'src', name + '.mjs'), 'utf8');
  script += source.replace(/^import .*?;\s*$/gm, '').replace(/^export /gm, '') + '\n';
}
const assets = [
  ['mark.svg', 'image/svg+xml'], ['storefront.png', 'image/png'], ['pendragon.png', 'image/png'], ['ground-shadow.svg', 'image/svg+xml'],
  ['backseat-40-45.mp3', 'audio/mpeg'], ['backseat-analysis.json', 'application/json'],
  ['backseat-four-bands.png', 'image/png'], ['backseat-sample.gif', 'image/gif'],
];
for (const [file, mime] of assets) {
  const data = await readFile(path.join(web, 'assets', file));
  const uri = `data:${mime};base64,${data.toString('base64')}`;
  html = html.replaceAll('./assets/' + file, uri); script = script.replaceAll('./assets/' + file, uri);
}
html = html.replace('<link rel="stylesheet" href="./style.css">', `<style>${css}</style>`);
html = html.replace('<script type="module" src="./src/app.mjs"></script>', `<script type="module">${script.replaceAll('</script', '<\\/script')}</script>`);
const sceneArg = process.argv.indexOf('--scene');
if (sceneArg >= 0) {
  const id = process.argv[sceneArg + 1];
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id || '')) throw new Error('Invalid --scene id.');
  const folder = path.join(web, 'scenes', id), project = JSON.parse(await readFile(path.join(folder, 'scene.djscene.json'), 'utf8'));
  const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.mp4': 'video/mp4', '.webm': 'video/webm' };
  async function embed(src) {
    if (/^https:\/\//.test(src)) throw new Error('An offline scene must use packaged local assets.');
    const file = path.resolve(folder, src); if (!file.startsWith(folder + path.sep)) throw new Error('Invalid offline asset path.');
    return `data:${mimeTypes[path.extname(file)] || 'application/octet-stream'};base64,${(await readFile(file)).toString('base64')}`;
  }
  for (const layer of project.layers) { layer.data = await embed(layer.src); delete layer.src; }
  for (const frame of project.storyboard?.frames || []) if (frame.src) { frame.data = await embed(frame.src); delete frame.src; }
  if (project.audio?.source === 'youtube') throw new Error('YouTube playback requires the hosted HTTPS page. Use a music file for an offline scene bundle.');
  if (project.audio) { project.audio.data = await embed(project.audio.src); delete project.audio.src; }
  delete project.source;
  html = html.replace('<script type="module">', `<script type="application/json" id="embedded-scene">${JSON.stringify(project).replaceAll('<', '\\u003c')}</script>\n<script type="module">`);
}
const output = process.argv[2] || path.join(root, 'dist', 'dj-animate.html');
await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, html);
console.log('Saved portable editor:', output);
