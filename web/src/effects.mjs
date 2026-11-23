export const EFFECTS = [
  { id: 'breathe', name: 'Bass breathe', icon: '◉', band: 0, amount: .55, on: true, scope: 'Layer motion', detail: 'Foot-anchored pulse and eased scale.' },
  { id: 'parallax', name: 'Depth drift', icon: '▱', band: 1, amount: .5, on: true, scope: 'Layer motion', detail: 'Layers move at different speeds according to depth.' },
  { id: 'rgb', name: 'Prism split', icon: '◈', band: 3, amount: .35, on: true, scope: 'Scene', detail: 'Separate red and blue around bright edges.' },
  { id: 'ripple', name: 'Shockwave', icon: '◎', band: 0, amount: .3, on: false, scope: 'Scene', detail: 'Concentric ripples sweep out from the center.' },
  { id: 'liquid', name: 'Heat haze', icon: '≈', band: 1, amount: .4, on: false, scope: 'Scene', detail: 'Slow liquid refraction across the image.' },
  { id: 'echo', name: 'Afterimage', icon: '▧', band: 2, amount: .45, on: false, scope: 'Scene', detail: 'A fading history of the previous frames.' },
  { id: 'kaleido', name: 'Kaleidoscope', icon: '✧', band: 2, amount: .4, on: false, scope: 'Scene', detail: 'A sixfold mirrored world, blended with the original.' },
  { id: 'vhs', name: 'Tape drift', icon: '≋', band: 3, amount: .3, on: false, scope: 'Scene', detail: 'Rolling VHS bands and displaced scan lines.' },
  { id: 'bloom', name: 'Neon bloom', icon: '✺', band: 2, amount: .45, on: true, scope: 'Scene', detail: 'A warm halo around the brightest parts of the scene.' },
  { id: 'hue', name: 'Sunset shift', icon: '◐', band: 1, amount: .35, on: false, scope: 'Scene', detail: 'Rotate the color palette with the music.' },
  { id: 'pixel', name: 'Digital melt', icon: '▦', band: 3, amount: .3, on: false, scope: 'Scene', detail: 'Pixel blocks grow and dissolve with the hats.' },
  { id: 'tunnel', name: 'Vertigo', icon: '◌', band: 0, amount: .3, on: false, scope: 'Scene', detail: 'Radial lens distortion and a subtle vortex.' },
];
export function effectValues(effects, bands, master = 1) {
  return Object.fromEntries(effects.map(e => [e.id, e.on ? Math.min(1, Math.max(0, bands[e.band] * e.amount * master)) : 0]));
}
export function preset(name) {
  const e = EFFECTS.map(x => ({ ...x }));
  if (name === 'clean') e.forEach(x => { x.on = ['breathe', 'parallax'].includes(x.id); });
  if (name === 'fever') e.forEach(x => { x.on = ['breathe', 'parallax', 'rgb', 'liquid', 'echo', 'bloom', 'hue'].includes(x.id); });
  if (name === 'warp') e.forEach(x => { x.on = ['breathe', 'parallax', 'ripple', 'rgb', 'tunnel'].includes(x.id); });
  return e;
}
