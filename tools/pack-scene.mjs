import { readFile, writeFile, mkdir, copyFile, realpath, stat, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeScene } from '../web/src/scene.mjs';

// Package bytes beside a small manifest. Publishing remains an explicit git push.
export async function packScene(inputFile, { id, baseURL = 'https://dj.cityplanners.co/', outputRoot = 'web/scenes', replace = false } = {}) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id || '')) throw new Error('Choose --id using lowercase letters, numbers and hyphens (up to 64 characters).');
  const site = new URL(baseURL); if (!['https:', 'http:'].includes(site.protocol) || site.username || site.password) throw new Error('Use an HTTPS site base URL.');
  site.search = ''; site.hash = ''; if (!site.pathname.endsWith('/')) site.pathname += '/';
  const inputRoot = await realpath(path.dirname(path.resolve(inputFile)));
  const project = JSON.parse(await readFile(inputFile, 'utf8'));
  const output = path.resolve(outputRoot, id), staging = `${output}.staging-${process.pid}`;
  try { await stat(output); if (!replace) throw new Error('That scene already exists. Choose another id or use --replace.'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  await mkdir(staging, { recursive: true });
  try {
    const copied = new Map();
    async function asset(src, kind) {
      if (typeof src !== 'string' || !src) throw new Error(`A ${kind} asset is missing.`);
      if (/^https:\/\//.test(src)) return src;
      if (/^[a-z][a-z0-9+.-]*:/i.test(src) || path.isAbsolute(src)) throw new Error('Package local relative assets or public HTTPS URLs.');
      const file = await realpath(path.resolve(inputRoot, src));
      if (!file.startsWith(inputRoot + path.sep)) throw new Error('Keep packaged assets inside the input scene directory.');
      if (copied.has(file)) return copied.get(file);
      const info = await stat(file);
      if (!info.isFile() || info.size > 134217728) throw new Error('Each scene asset must be a file under 128 MiB.');
      const allowed = kind === 'audio' ? ['.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.webm', '.flac'] : ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg'];
      const ext = path.extname(file).toLowerCase(); if (!allowed.includes(ext)) throw new Error(`Unsupported ${kind} file: ${path.basename(file)}`);
      const name = `${String(copied.size + 1).padStart(2, '0')}-${path.basename(file, path.extname(file)).replace(/[^a-z0-9-]/gi, '-').toLowerCase()}${ext}`;
      await copyFile(file, path.join(staging, name)); copied.set(file, name); return name;
    }
    if (!Array.isArray(project.layers)) throw new Error('The scene needs a layers array.');
    const layers = [];
    for (const l of project.layers) layers.push({ ...l, data: undefined, src: await asset(l.src, 'image') });
    const audio = project.audio?.source === 'youtube' ? project.audio : project.audio ? { ...project.audio, data: undefined, src: await asset(project.audio.src, 'audio') } : null;
    const storyboard = project.storyboard && { ...project.storyboard, frames: [] };
    if (storyboard) for (const frame of project.storyboard.frames) {
      storyboard.frames.push(frame.src ? { ...frame, data: undefined, src: await asset(frame.src, 'image') } : frame);
    }
    const manifestURL = new URL(`scenes/${id}/scene.djscene.json`, site);
    const normalized = normalizeScene({ ...project, layers, audio, storyboard }, manifestURL.href);
    // Validate absolute references, then retain portable paths for either hostname.
    normalized.layers.forEach((l, i) => { l.src = layers[i].src; });
    if (normalized.audio && normalized.audio.source !== 'youtube') normalized.audio.src = audio.src;
    normalized.storyboard?.frames.forEach((frame, i) => { frame.src = storyboard.frames[i].src; });
    if (project.source?.src) normalized.source = { src: await asset(project.source.src, 'image'), note: String(project.source.note || '').slice(0, 500) };
    await writeFile(path.join(staging, 'scene.djscene.json'), JSON.stringify(normalized, null, 2) + '\n');
    if (replace) await rm(output, { recursive: true, force: true });
    await rename(staging, output);
    const link = new URL(site); link.searchParams.set('scene', id);
    return { directory: output, manifest: path.join(output, 'scene.djscene.json'), url: link.href, assets: copied.size };
  } catch (e) { await rm(staging, { recursive: true, force: true }); throw e; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [inputFile, ...args] = process.argv.slice(2), arg = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
  if (!inputFile) { console.error('Usage: npm run scene:pack -- scene.json --id my-scene [--base https://dj.cityplanners.co/]'); process.exitCode = 1; }
  else {
    try { console.log(JSON.stringify(await packScene(inputFile, { id: arg('--id'), baseURL: arg('--base'), replace: args.includes('--replace') }), null, 2)); }
    catch (e) { console.error(e.message); process.exitCode = 1; }
  }
}
