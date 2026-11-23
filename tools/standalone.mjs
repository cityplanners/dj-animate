// Optional one-file editor: embedded media, CSS, and inline module source.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..'), web = path.join(root, 'web');
let html = await readFile(path.join(web, 'index.html'), 'utf8');
const css = await readFile(path.join(web, 'style.css'), 'utf8');
let script = '';
for (const name of ['dsp', 'effects', 'renderer', 'selection', 'app']) {
  const source = await readFile(path.join(web, 'src', name + '.mjs'), 'utf8');
  script += source.replace(/^import .*?;\s*$/gm, '').replace(/^export /gm, '') + '\n';
}
const assets = [
  ['mark.svg', 'image/svg+xml'], ['storefront.png', 'image/png'], ['pendragon.png', 'image/png'],
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
const output = process.argv[2] || path.join(root, 'dist', 'dj-animate.html');
await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, html);
console.log('Saved portable editor:', output);
