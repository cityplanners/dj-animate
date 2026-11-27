import { effectValues } from './effects.mjs';
import { layerPulse } from './scene.mjs';
import { storyboardAt } from './storyboard.mjs';
import { drawVehicle } from './vehicle.mjs';

function drawLayerArt(ctx, layer, image, anchorX, anchorY, bands, t, master) {
  const w = image.naturalWidth, h = image.naturalHeight;
  if (layer.clip) {
    ctx.beginPath(); layer.clip.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x * w - anchorX, y * h - anchorY)); ctx.closePath(); ctx.clip();
  }
  if (!layer.sway || !layer.motion) { ctx.drawImage(image, -anchorX, -anchorY); return; }
  const sway = layer.sway, energy = Math.min(1.5, Math.max(0, (bands[sway.band] || 0) * master));
  if (energy < .0001) { ctx.drawImage(image, -anchorX, -anchorY); return; }
  for (let i = 0; i < 48; i++) {
    const top = Math.max(0, Math.floor(h * i / 48) - 1), bottom = Math.min(h, Math.floor(h * (i + 1) / 48) + 1), progress = (i + .5) / 48;
    const dx = Math.sin(t * sway.rate * Math.PI * 2 - progress * 3) * sway.amount * energy * progress * progress * h / 720;
    ctx.drawImage(image, 0, top, w, bottom - top, -anchorX + dx, top - anchorY, w, bottom - top);
  }
}

function drawCover(ctx, image, iw, ih, width, height) {
  const scale = Math.max(width / iw, height / ih);
  const w = iw * scale, h = ih * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

function drawStoryboard(ctx, width, height, scene, time) {
  const { frames, transitionCanvas } = scene;
  const shot = storyboardAt(frames, time);
  if (!shot || (!shot.current && !shot.previous)) return;
  if (shot.mix === 1) {
    drawCover(ctx, shot.current, shot.current.naturalWidth, shot.current.naturalHeight, width, height);
    return;
  }

  // Compose in premultiplied alpha so transparent PNGs crossfade over the video.
  if (transitionCanvas.width !== width) transitionCanvas.width = width;
  if (transitionCanvas.height !== height) transitionCanvas.height = height;
  const blend = transitionCanvas.getContext('2d');
  blend.clearRect(0, 0, width, height);
  blend.save();
  blend.globalCompositeOperation = 'lighter';
  for (const [image, opacity] of [[shot.previous, 1 - shot.mix], [shot.current, shot.mix]]) {
    if (!image || !opacity) continue;
    blend.globalAlpha = opacity;
    drawCover(blend, image, image.naturalWidth, image.naturalHeight, width, height);
  }
  blend.restore();
  ctx.drawImage(transitionCanvas, 0, 0);
}

function renderOrder(layers, scene) {
  if (!scene) return layers;
  return [...layers.filter(layer => !layer.cue), null, ...layers.filter(layer => layer.cue)];
}

function drawVideo(ctx, width, height, video) {
  if (video?.readyState >= 2 && video.videoWidth) drawCover(ctx, video, video.videoWidth, video.videoHeight, width, height);
}

function layerVisible(layer, t, video) {
  return layer.visible && layer.image && !(video && layer.role === 'background')
    && (!layer.cue || (t >= layer.cue.start && t < layer.cue.end));
}
const VERTEX = `attribute vec2 position; varying vec2 uv; void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
const FRAGMENT = `precision mediump float;
varying vec2 uv; uniform sampler2D image; uniform sampler2D history;
uniform float time, rgb, ripple, liquid, echo, kaleido, vhs, bloom, hue, pixel, tunnel;
uniform vec2 resolution;
vec2 safeUV(vec2 p){return clamp(p,vec2(.002),vec2(.998));}
vec3 fetch(vec2 p){return texture2D(image,safeUV(p)).rgb;}
void main(){
 vec2 p=uv, center=p-.5;
 float radius=length(center*vec2(resolution.x/resolution.y,1.));
 p+=center*(sin(radius*19.-time*3.)*.035*tunnel);
 p+=vec2(-center.y,center.x)*sin(radius*8.-time*.7)*tunnel*.06;
 p+=normalize(center+vec2(.0001))*sin(radius*42.-time*6.)*.012*ripple;
 p+=vec2(sin(p.y*16.+time*.8),cos(p.x*13.+time*.65))*.012*liquid;
 if(kaleido>.001){
   vec2 c=p-.5; float r=length(c), a=atan(c.y,c.x), sector=1.0471976;
   a=abs(mod(a+time*.03,sector)-sector*.5);
   vec2 k=vec2(cos(a),sin(a))*r+.5; p=mix(p,k,kaleido*.85);
 }
 p.x+=sin(p.y*260.+time*19.)*.004*vhs;
 p.x+=smoothstep(.96,1.,sin(p.y*7.-time*1.3))*.035*vhs;
 if(pixel>.001){float grid=640./(1.+pixel*22.);p=floor(p*vec2(grid,grid*resolution.y/resolution.x))/vec2(grid,grid*resolution.y/resolution.x);}
 vec2 shift=vec2(.010*rgb, .002*rgb);
 vec3 color=vec3(fetch(p+shift).r,fetch(p).g,fetch(p-shift).b);
 if(bloom>.001){
  vec2 d=vec2(5.)/resolution;
  vec3 glow=(fetch(p+d)+fetch(p-d)+fetch(p+vec2(d.x,-d.y))+fetch(p+vec2(-d.x,d.y)))*.25;
  color+=max(glow-.55,0.)*bloom*.9;
 }
 if(hue>.001){vec3 axis=normalize(vec3(1.));float angle=hue*2.7;color=color*cos(angle)+cross(axis,color)*sin(angle)+axis*dot(axis,color)*(1.-cos(angle));}
 color*=1.-vhs*.10*(.5+.5*sin(uv.y*resolution.y*3.14159));
 vec3 old=texture2D(history,uv+vec2(.002*echo,0.)).rgb;
 color=mix(color,old,echo*.72);
 gl_FragColor=vec4(clamp(color,0.,1.),1.);
}`;

export class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.work = document.createElement('canvas'); this.work.width = canvas.width; this.work.height = canvas.height;
    this.ctx = this.work.getContext('2d', { alpha: false });
    const gl = this.gl = canvas.getContext('webgl', { alpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) return new SoftwareRenderer(canvas);
    const compile = (type, source) => {
      const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = this.program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const verts = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, verts);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const attr = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(attr); gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
    this.uniforms = {};
    for (const name of ['image', 'history', 'resolution', 'time', 'rgb', 'ripple', 'liquid', 'echo', 'kaleido', 'vhs', 'bloom', 'hue', 'pixel', 'tunnel']) this.uniforms[name] = gl.getUniformLocation(program, name);
    this.textures = [0, 1].map(unit => {
      gl.activeTexture(gl.TEXTURE0 + unit); const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); return tex;
    });
    gl.uniform1i(this.uniforms.image, 0); gl.uniform1i(this.uniforms.history, 1);
    gl.uniform2f(this.uniforms.resolution, canvas.width, canvas.height); this.previousTime = -1;
  }
  clearHistory() {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.textures[1]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  resize() {
    const { canvas, gl } = this;
    this.work.width = canvas.width; this.work.height = canvas.height;
    gl.useProgram(this.program); gl.uniform2f(this.uniforms.resolution, canvas.width, canvas.height);
    this.clearHistory(); this.previousTime = -1;
  }
  render(layers, effects, bands, t, master = 1, playing = true, scene) {
    const { canvas, ctx, gl } = this, W = canvas.width, H = canvas.height;
    const fx = effectValues(effects, bands, master);
    if (t < this.previousTime || Math.abs(t - this.previousTime) > .3) this.clearHistory();
    this.previousTime = t;
    ctx.fillStyle = '#171222'; ctx.fillRect(0, 0, W, H);
    drawVideo(ctx, W, H, scene?.video);
    for (const layer of renderOrder(layers, scene)) {
      if (!layer) { drawStoryboard(ctx, W, H, scene, t); continue; }
      if (!layerVisible(layer, t, scene?.video)) continue;
      const image = layer.renderImage || layer.image, naturalW = image.naturalWidth, naturalH = image.naturalHeight;
      const base = layer.role === 'background' ? Math.max(W / naturalW, H / naturalH) : H * .93 / naturalH;
      const motion = layer.motion ? 1 : 0, depth = layer.depth;
      const breathing = fx.breathe * .025 * motion;
      const pulse = layerPulse(layer, bands, master);
      const scale = base * layer.scale * (1 + breathing) * pulse.scale;
      const driftX = Math.sin(t * .42) * 18 * fx.parallax * depth * motion;
      const driftY = Math.cos(t * .33) * 5 * fx.parallax * depth * motion;
      ctx.save(); ctx.globalAlpha = pulse.alpha; ctx.globalCompositeOperation = layer.blend || 'source-over';
      const px = layer.x / 100 * W + driftX, py = layer.y / 100 * H + driftY;
      ctx.translate(px, py);
      if (layer.role === 'vehicle') { drawVehicle(ctx, layer, bands, t, master, playing, naturalW * base * layer.scale, naturalH * base * layer.scale); ctx.restore(); continue; }
      const anchored = layer.role !== 'background';
      if (anchored && !layer.sway) ctx.rotate((Math.sin(t * 1.4) * .006 + fx.breathe * .005) * motion);
      ctx.scale(scale, scale);
      const anchorX = naturalW / 2, anchorY = anchored ? naturalH : naturalH / 2;
      drawLayerArt(ctx, layer, image, anchorX, anchorY, bands, t, master); ctx.restore();
    }
    gl.viewport(0, 0, W, H); gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.work);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.textures[1]);
    gl.uniform1f(this.uniforms.time, t);
    for (const name of ['rgb', 'ripple', 'liquid', 'echo', 'kaleido', 'vhs', 'bloom', 'hue', 'pixel', 'tunnel']) gl.uniform1f(this.uniforms[name], fx[name] || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // Only advance the feedback buffer with the audio clock, not while paused.
    if (playing) gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, W, H);
  }
}

// Canvas fallback keeps the full editor usable on devices without WebGL.
// Keep at least the original fallback's vertical detail in ultrawide scenes.
class SoftwareRenderer {
  constructor(canvas) {
    this.canvas = canvas; this.mode = 'canvas'; this.output = canvas.getContext('2d', { alpha: false });
    this.work = document.createElement('canvas');
    this.ctx = this.work.getContext('2d', { willReadFrequently: true });
    this.processed = document.createElement('canvas');
    this.direct = document.createElement('canvas'); this.dc = this.direct.getContext('2d');
    this.pc = this.processed.getContext('2d'); this.resize();
  }
  resize() {
    const W = Math.max(480, Math.min(960, Math.round(270 * this.canvas.width / this.canvas.height)));
    const H = Math.round(W * this.canvas.height / this.canvas.width);
    this.direct.width = this.canvas.width; this.direct.height = this.canvas.height;
    this.work.width = this.processed.width = W; this.work.height = this.processed.height = H;
    this.pixels = this.pc.createImageData(W, H); this.history = new Uint8ClampedArray(W * H * 4); this.previousTime = -1;
  }
  clearHistory() { this.history.fill(0); }
  render(layers, effects, bands, t, master = 1, playing = true, scene) {
    const fx = effectValues(effects, bands, master);
    const post = ['rgb', 'ripple', 'liquid', 'echo', 'kaleido', 'vhs', 'bloom', 'hue', 'pixel', 'tunnel'].some(key => fx[key] > .00001);
    const W = post ? this.work.width : this.direct.width, H = post ? this.work.height : this.direct.height, ctx = post ? this.ctx : this.dc;
    if (t < this.previousTime || Math.abs(t - this.previousTime) > .3) this.clearHistory();
    this.previousTime = t; ctx.fillStyle = '#171222'; ctx.fillRect(0, 0, W, H);
    drawVideo(ctx, W, H, scene?.video);
    for (const l of renderOrder(layers, scene)) {
      if (!l) { drawStoryboard(ctx, W, H, scene, t); continue; }
      if (!layerVisible(l, t, scene?.video)) continue;
      const im = l.renderImage || l.image, iw = im.naturalWidth, ih = im.naturalHeight, m = l.motion ? 1 : 0;
      const base = l.role === 'background' ? Math.max(W / iw, H / ih) : H * .93 / ih;
      const pulse = layerPulse(l, bands, master);
      const s = base * l.scale * (1 + fx.breathe * .025 * m) * pulse.scale;
      ctx.save(); ctx.globalAlpha = pulse.alpha; ctx.globalCompositeOperation = l.blend || 'source-over';
      ctx.translate(l.x / 100 * W + Math.sin(t * .42) * 18 * fx.parallax * l.depth * m * W / 1280,
        l.y / 100 * H + Math.cos(t * .33) * 5 * fx.parallax * l.depth * m * H / 720);
      if (l.role === 'vehicle') { drawVehicle(ctx, l, bands, t, master, playing, iw * base * l.scale, ih * base * l.scale); ctx.restore(); continue; }
      if (l.role !== 'background' && !l.sway) ctx.rotate((Math.sin(t * 1.4) * .006 + fx.breathe * .005) * m);
      ctx.scale(s, s); drawLayerArt(ctx, l, im, iw / 2, l.role === 'background' ? ih / 2 : ih, bands, t, master); ctx.restore();
    }
    // Layer-only animation can stay full resolution without a per-pixel shader pass.
    if (!post) { this.output.drawImage(this.direct, 0, 0); this.wasDirect = true; return; }
    if (this.wasDirect) { this.clearHistory(); this.wasDirect = false; }
    const src = ctx.getImageData(0, 0, W, H).data, dst = this.pixels.data;
    const safe = (x, y) => (Math.max(0, Math.min(H - 1, y | 0)) * W + Math.max(0, Math.min(W - 1, x | 0))) * 4;
    const angle = fx.hue * 2.7, co = Math.cos(angle), si = Math.sin(angle) / Math.sqrt(3), third = (1 - co) / 3;
    const echo = fx.echo * .72, sector = Math.PI / 3;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let u = x / W, v = y / H; const cx = u - .5, cy = v - .5;
      const radius = Math.hypot(cx * W / H, cy), len = Math.hypot(cx, cy) || .001;
      const tunnel = Math.sin(radius * 19 - t * 3) * .035 * fx.tunnel;
      const twist = Math.sin(radius * 8 - t * .7) * fx.tunnel * .06;
      const ripple = Math.sin(radius * 42 - t * 6) * .012 * fx.ripple;
      u += cx * tunnel - cy * twist + cx / len * ripple;
      v += cy * tunnel + cx * twist + cy / len * ripple;
      if (fx.liquid) { u += Math.sin(v * 16 + t * .8) * .012 * fx.liquid; v += Math.cos(u * 13 + t * .65) * .012 * fx.liquid; }
      if (fx.kaleido) {
        const a = Math.abs(((Math.atan2(v - .5, u - .5) + t * .03) % sector + sector) % sector - sector * .5), r = Math.hypot(u - .5, v - .5), k = fx.kaleido * .85;
        u = u * (1 - k) + (Math.cos(a) * r + .5) * k; v = v * (1 - k) + (Math.sin(a) * r + .5) * k;
      }
      if (fx.vhs) { const roll = Math.max(0, (Math.sin(v * 7 - t * 1.3) - .96) / .04); u += Math.sin(v * 260 + t * 19) * .004 * fx.vhs + roll * .035 * fx.vhs; }
      if (fx.pixel) { const grid = 640 / (1 + fx.pixel * 22); u = Math.floor(u * grid) / grid; v = Math.floor(v * grid * H / W) / (grid * H / W); }
      const px = u * W, py = v * H, offset = .010 * fx.rgb * W;
      const idx = safe(px, py), ir = safe(px + offset, py + fx.rgb * .002 * H), ib = safe(px - offset, py - fx.rgb * .002 * H);
      let r = src[ir], g = src[idx + 1], b = src[ib + 2];
      if (fx.bloom) {
        const n = [safe(px + 2, py + 2), safe(px - 2, py - 2), safe(px + 2, py - 2), safe(px - 2, py + 2)];
        r += Math.max(0, (src[n[0]] + src[n[1]] + src[n[2]] + src[n[3]]) / 4 - 140) * fx.bloom * .9;
        g += Math.max(0, (src[n[0]+1] + src[n[1]+1] + src[n[2]+1] + src[n[3]+1]) / 4 - 140) * fx.bloom * .9;
        b += Math.max(0, (src[n[0]+2] + src[n[1]+2] + src[n[2]+2] + src[n[3]+2]) / 4 - 140) * fx.bloom * .9;
      }
      if (fx.hue) { const rr = r, gg = g, bb = b, sum = (rr + gg + bb) * third; r = rr * co + (bb - gg) * si + sum; g = gg * co + (rr - bb) * si + sum; b = bb * co + (gg - rr) * si + sum; }
      const scan = 1 - fx.vhs * .1 * (.5 + .5 * Math.sin(y * Math.PI));
      const out = (y * W + x) * 4, old = safe(x + .002 * fx.echo * W, y);
      dst[out] = r * scan * (1 - echo) + this.history[old] * echo;
      dst[out + 1] = g * scan * (1 - echo) + this.history[old + 1] * echo;
      dst[out + 2] = b * scan * (1 - echo) + this.history[old + 2] * echo; dst[out + 3] = 255;
    }
    if (playing) this.history.set(dst);
    this.pc.putImageData(this.pixels, 0, 0); this.output.drawImage(this.processed, 0, 0, this.canvas.width, this.canvas.height);
  }
}
