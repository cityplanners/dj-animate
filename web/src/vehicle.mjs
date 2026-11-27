import { clamp } from './dsp.mjs';

export const VEHICLE_WHEELS = ['fl', 'fr', 'rl', 'rr'];
const vehicleNumber = (v, fallback, min, max) => Number.isFinite(v) ? clamp(v, min, max) : fallback;
export function normalizeVehicle(value = {}, resolve = value => value) {
  if (!value.model && !value.obj) throw new Error('A VEHICLE needs an OBJ model.');
  if (value.obj && (typeof value.obj !== 'string' || value.obj.length > 2000000)) throw new Error('Use an OBJ model under 2 MB.');
  return {
    ...(value.model ? { model: resolve(value.model) } : {}),
    ...(value.obj ? { obj: value.obj } : {}),
    view: ['sprite', 'model', 'wireframe'].includes(value.view) ? value.view : 'sprite',
    travel: vehicleNumber(value.travel, .18, 0, .65),
    stiffness: vehicleNumber(value.stiffness, 95, 20, 240),
    damping: vehicleNumber(value.damping, 11, 3, 30),
    wheelBands: VEHICLE_WHEELS.map((_, i) => Math.round(vehicleNumber(value.wheelBands?.[i], i, 0, 3))),
    wheelGains: VEHICLE_WHEELS.map((_, i) => vehicleNumber(value.wheelGains?.[i], 1, 0, 2)),
    wheels: (value.wheels || []).slice(0, 4).map(wheel => ({
      id: VEHICLE_WHEELS.includes(wheel.id) ? wheel.id : 'fl',
      x: vehicleNumber(wheel.x, .5, 0, 1), y: vehicleNumber(wheel.y, .5, 0, 1),
      rx: vehicleNumber(wheel.rx, .05, .005, .25), ry: vehicleNumber(wheel.ry, .15, .005, .4),
    })),
  };
}

// The reusable proxy has a chassis, open cabin, windscreen and four named wheel meshes.
export function makeDefaultVehicleOBJ() {
  const lines = ['# dj-animate VEHICLE proxy; metres; X front, Y up, Z right', '# Independent suspension groups: wheel_fl wheel_fr wheel_rl wheel_rr']; let count = 0;
  const vertex = point => { lines.push(`v ${point.map(v => v.toFixed(5)).join(' ')}`); return ++count; };
  const face = indices => lines.push(`f ${indices.join(' ')}`);
  function box(name, x0, x1, y0, y1, z0, z1) {
    lines.push(`g ${name}`);
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]].map(vertex);
    for (const f of [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2]]) face(f.map(i => v[i]));
  }
  box('body', -2.9, 2.9, .55, .88, -.94, .94);
  box('body', -2.8, 2.8, .88, 1.12, -.94, -.78);
  box('body', -2.8, 2.8, .88, 1.12, .78, .94);
  box('hood', .72, 2.86, .88, 1.12, -.78, .78);
  box('trunk', -2.86, -1.7, .88, 1.09, -.78, .78);
  box('interior', -1.7, .72, .88, .92, -.76, .76);
  box('interior', -1.5, -1.27, .94, 1.36, -.72, .72);
  box('interior', -.45, -.22, .94, 1.36, -.72, .72);
  lines.push('g glass');
  face([[.72, 1.12, -.77], [.72, 1.12, .77], [.37, 1.86, .75], [.37, 1.86, -.75]].map(vertex));
  for (const [i, id] of VEHICLE_WHEELS.entries()) {
    lines.push(`g wheel_${id}`); const x = i < 2 ? 1.98 : -1.98, z = i % 2 ? .94 : -.94, rings = [];
    for (const dz of [-.15, .15]) rings.push(Array.from({ length: 12 }, (_, j) => vertex([x + Math.cos(j * Math.PI / 6) * .44, .44 + Math.sin(j * Math.PI / 6) * .44, z + dz])));
    face([...rings[0]].reverse()); face(rings[1]);
    for (let j = 0; j < 12; j++) face([rings[0][j], rings[0][(j + 1) % 12], rings[1][(j + 1) % 12], rings[1][j]]);
  }
  return lines.join('\n') + '\n';
}

// Wavefront geometry only: OBJ never runs code or loads external materials.
export function parseVehicleOBJ(text) {
  if (typeof text !== 'string' || text.length > 2000000) throw new Error('Use an OBJ model under 2 MB.');
  const vertices = [], faces = []; let group = 'body';
  for (const line of text.split(/\r?\n/)) {
    const [type, ...args] = line.trim().split(/\s+/);
    if (type === 'v') {
      const point = args.slice(0, 3).map(Number);
      if (point.length !== 3 || point.some(v => !Number.isFinite(v) || Math.abs(v) > 100000)) throw new Error('Invalid OBJ vertex.');
      vertices.push(point);
    } else if (type === 'g' || type === 'o') group = args[0] || 'body';
    else if (type === 'f') {
      const indices = args.map(part => {
        const n = Number(part.split('/')[0]);
        const index = n < 0 ? vertices.length + n : n - 1;
        if (!Number.isInteger(n) || !n || index < 0 || index >= vertices.length) throw new Error('Invalid OBJ face.');
        return index;
      });
      if (indices.length < 3 || indices.length > 64) throw new Error('Invalid OBJ face.');
      for (let i = 1; i < indices.length - 1; i++) faces.push({ group, indices: [indices[0], indices[i], indices[i + 1]] });
    }
    if (vertices.length > 20000 || faces.length > 40000) throw new Error('Use a rough OBJ with at most 20,000 vertices and 40,000 triangles.');
  }
  if (vertices.length < 3 || !faces.length) throw new Error('The OBJ needs vertices and faces.');
  const min = [0, 1, 2].map(axis => Math.min(...vertices.map(v => v[axis])));
  const max = [0, 1, 2].map(axis => Math.max(...vertices.map(v => v[axis])));
  const size = max.map((v, i) => v - min[i]);
  if (size[0] < .001 || size[1] < .001 || size[2] < .001) throw new Error('The vehicle model must have width, height and depth.');
  return { vertices, faces, min, max, size };
}

export function createVehicleRig() { return { time: null, positions: [0, 0, 0, 0], velocities: [0, 0, 0, 0] }; }
export function vehiclePose(rig, config, bands, time, master = 1, playing = true) {
  if (rig.time === null || time < rig.time || time - rig.time > .25 || !playing) {
    if (rig.time === null || time !== rig.time || !playing) { rig.positions.fill(0); rig.velocities.fill(0); }
    rig.time = time;
  }
  const dt = clamp(time - rig.time, 0, .25);
  const targets = VEHICLE_WHEELS.map((_, i) => config.travel * clamp((bands[config.wheelBands[i]] || 0) * master * config.wheelGains[i], 0, 1.5));
  const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
  for (let step = 0; step < steps; step++) for (let i = 0; i < 4; i++) {
    rig.velocities[i] += (config.stiffness * (targets[i] - rig.positions[i]) - config.damping * rig.velocities[i]) * h;
    rig.positions[i] = clamp(rig.positions[i] + rig.velocities[i] * h, -config.travel * .3, config.travel * 1.7);
  }
  rig.time = time;
  const [fl, fr, rl, rr] = rig.positions;
  return { heave: (fl + fr + rl + rr) / 4,
    pitch: Math.atan2((fl + fr - rl - rr) / 2, 4),
    roll: Math.atan2((fl + rl - fr - rr) / 2, 1.9),
    wheels: [...rig.positions] };
}

export function rotateVehiclePoint([x, y, z], pose) {
  // X is longitudinal, Y is up, Z is across the axles.
  const cp = Math.cos(pose.pitch), sp = Math.sin(pose.pitch), cr = Math.cos(pose.roll), sr = Math.sin(pose.roll);
  const xp = x * cp - y * sp, yp = x * sp + y * cp;
  return [xp, yp * cr - z * sr + pose.heave, yp * sr + z * cr];
}

async function vehicleModelText(config) {
  if (config.obj) return config.obj;
  const response = await fetch(config.model, { mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Vehicle OBJ could not be loaded (${response.status}).`);
  if (Number(response.headers.get('content-length')) > 2000000) throw new Error('Use an OBJ model under 2 MB.');
  // Bound streamed bodies too, including servers without a content-length.
  const reader = response.body.getReader(), chunks = []; let count = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      count += value.length; if (count > 2000000) throw new Error('Use an OBJ model under 2 MB.'); chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(count); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

export async function prepareVehicleLayer(layer) {
  const text = await vehicleModelText(layer.vehicle), geometry = parseVehicleOBJ(text);
  const body = document.createElement('canvas'); body.width = layer.image.naturalWidth; body.height = layer.image.naturalHeight;
  const ctx = body.getContext('2d'); ctx.drawImage(layer.image, 0, 0);
  const wheels = layer.vehicle.wheels.map(w => {
    const canvas = document.createElement('canvas'); canvas.width = body.width; canvas.height = body.height;
    const wc = canvas.getContext('2d'); wc.beginPath(); wc.ellipse(w.x * body.width, w.y * body.height, w.rx * body.width, w.ry * body.height, 0, 0, Math.PI * 2); wc.clip(); wc.drawImage(layer.image, 0, 0);
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.ellipse(w.x * body.width, w.y * body.height, w.rx * body.width, w.ry * body.height, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    return { ...w, image: canvas };
  });
  layer.vehicleRuntime = { geometry, text, body, wheels, rig: createVehicleRig() };
  return layer;
}

function vehicleTriangle(ctx, image, source, target) {
  const [s0, s1, s2] = source, [d0, d1, d2] = target;
  const sx1 = s1[0] - s0[0], sy1 = s1[1] - s0[1], sx2 = s2[0] - s0[0], sy2 = s2[1] - s0[1];
  const determinant = sx1 * sy2 - sx2 * sy1; if (Math.abs(determinant) < .0001) return;
  const dx1 = d1[0] - d0[0], dy1 = d1[1] - d0[1], dx2 = d2[0] - d0[0], dy2 = d2[1] - d0[1];
  const a = (dx1 * sy2 - dx2 * sy1) / determinant, c = (dx2 * sx1 - dx1 * sx2) / determinant;
  const b = (dy1 * sy2 - dy2 * sy1) / determinant, d = (dy2 * sx1 - dy1 * sx2) / determinant;
  const center = [(d0[0] + d1[0] + d2[0]) / 3, (d0[1] + d1[1] + d2[1]) / 3];
  const expanded = target.map(p => { const length = Math.hypot(p[0] - center[0], p[1] - center[1]) || 1; return [p[0] + (p[0] - center[0]) / length * .4, p[1] + (p[1] - center[1]) / length * .4]; });
  ctx.save(); ctx.beginPath(); ctx.moveTo(...expanded[0]); ctx.lineTo(...expanded[1]); ctx.lineTo(...expanded[2]); ctx.closePath(); ctx.clip();
  ctx.transform(a, b, c, d, d0[0] - a * s0[0] - c * s0[1], d0[1] - b * s0[0] - d * s0[1]); ctx.drawImage(image, 0, 0); ctx.restore();
}

function drawVehicleSprite(ctx, image, width, height, pose, lift = 0) {
  // Project a subdivided textured plane; pitch and roll alter depth as well as translation.
  const iw = image.width || image.naturalWidth, ih = image.height || image.naturalHeight;
  if (!pose.heave && !pose.pitch && !pose.roll) { ctx.drawImage(image, -width / 2, -height, width, height); return; }
  const unit = width / 6, tilt = pose.pitch * .92 + pose.roll * .35, cosine = Math.cos(tilt), sine = Math.sin(tilt);
  function project(u, v) {
    const x = (u - .5) * width, y = (v - .54) * height;
    const z = Math.sin(pose.roll) * y + Math.sin(pose.pitch) * x * .32;
    const perspective = 1 / (1 + z / (width * 2.7));
    return [(x * cosine - y * sine) * perspective, (x * sine + y * cosine) * perspective - height * .46 - (pose.heave - lift) * unit];
  }
  for (let x = 0; x < 4; x++) for (let y = 0; y < 2; y++) {
    const uv = [[x / 4, y / 2], [(x + 1) / 4, y / 2], [(x + 1) / 4, (y + 1) / 2], [x / 4, (y + 1) / 2]];
    const src = uv.map(([u, v]) => [u * iw, v * ih]), dst = uv.map(([u, v]) => project(u, v));
    for (const triangle of [[0, 1, 2], [0, 2, 3]]) vehicleTriangle(ctx, image, triangle.map(i => src[i]), triangle.map(i => dst[i]));
  }
}

function drawVehicleModel(ctx, runtime, config, width, height, pose) {
  const { geometry } = runtime, scale = 6 / geometry.size[0], centerX = (geometry.min[0] + geometry.max[0]) / 2, centerZ = (geometry.min[2] + geometry.max[2]) / 2;
  const projected = geometry.faces.map(face => {
    const wheel = VEHICLE_WHEELS.findIndex(id => face.group === `wheel_${id}`);
    const points = face.indices.map(i => {
      const vertex = geometry.vertices[i], p = [(vertex[0] - centerX) * scale, (vertex[1] - geometry.min[1]) * scale, (vertex[2] - centerZ) * scale];
      const transformed = rotateVehiclePoint(p, wheel < 0 ? pose : { heave: pose.wheels[wheel] * .14, pitch: 0, roll: 0 });
      const [x, y, z] = transformed, depth = -x * .40 + z * .916, perspective = 1 / (1 + depth / 20);
      return { x: (x * .916 + z * .40) * width / 6.5 * perspective, y: (-y * .95 - depth * .25) * width / 6.5 * perspective - height * .10, depth };
    });
    return { face, points, depth: points.reduce((n, p) => n + p.depth, 0) / 3 };
  }).sort((a, b) => b.depth - a.depth);
  for (const { face, points } of projected) {
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); for (const p of points.slice(1)) ctx.lineTo(p.x, p.y); ctx.closePath();
    const isWheel = face.group.startsWith('wheel_');
    ctx.fillStyle = isWheel ? '#181a22' : face.group === 'interior' ? '#613b4c' : face.group === 'glass' ? '#81b9d5' : '#becbd3';
    if (config.view === 'model') ctx.fill();
    ctx.strokeStyle = config.view === 'wireframe' ? '#80f1d1' : '#34414d'; ctx.lineWidth = config.view === 'wireframe' ? 1 : .7; ctx.stroke();
  }
}

export function drawVehicle(ctx, layer, bands, time, master, playing, width, height) {
  const runtime = layer.vehicleRuntime;
  if (!runtime) { ctx.drawImage(layer.image, -width / 2, -height, width, height); return; }
  const pose = vehiclePose(runtime.rig, layer.vehicle, bands, time, master, playing && layer.motion);
  if (layer.vehicle.view !== 'sprite') { drawVehicleModel(ctx, runtime, layer.vehicle, width, height, pose); return; }
  for (const wheel of runtime.wheels) {
    const index = VEHICLE_WHEELS.indexOf(wheel.id);
    // Wheel hubs travel with their own joint; most tyre displacement remains at road contact.
    drawVehicleSprite(ctx, wheel.image, width, height, { heave: pose.wheels[index] * .14, pitch: 0, roll: 0 });
  }
  drawVehicleSprite(ctx, runtime.body, width, height, pose);
}
