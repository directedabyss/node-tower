// Code rain - one shared, throttled loop drawing into any number of canvases.
// Reduced motion: draws a single still frame. Pauses when the tab is hidden.
// Toggle (nodetower.rain) hides and stops every HUD rain canvas.
import { isRainOn, subscribeRainPref } from './rainPref.js';

const GLYPHS = '0123456789ABCDEF+-=<>/*'; // own ASCII set: hex + a few symbols
const layers = new Set();
let raf = 0, last = 0;

function applyRainEnabled(on) {
  layers.forEach((L) => {
    if (L.canvas) L.canvas.style.visibility = on ? '' : 'hidden';
  });
  if (on) {
    layers.forEach((L) => { if (L.rm()) still(L); });
    if (!raf) raf = requestAnimationFrame(tick);
  } else if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
}

subscribeRainPref((v) => applyRainEnabled(v === 'on'));

function pick() { return GLYPHS[(Math.random() * GLYPHS.length) | 0]; }

function size(L) {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = L.canvas.clientWidth, h = L.canvas.clientHeight;
  if (!w || !h) return false;
  if (L.w !== w || L.h !== h) {
    L.w = w; L.h = h;
    L.canvas.width = w * dpr; L.canvas.height = h * dpr;
    L.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cols = Math.ceil(w / L.fs);
    L.drops = Array.from({ length: cols }, () => Math.random() * -h / L.fs);
    L.ctx.fillStyle = '#000'; L.ctx.fillRect(0, 0, w, h);
  }
  return true;
}

function draw(L) {
  if (!size(L)) return;
  const { ctx, w, h, fs } = L;
  ctx.fillStyle = `rgba(0,0,0,${L.fade})`;
  ctx.fillRect(0, 0, w, h);
  ctx.font = `${fs}px ui-monospace, Menlo, Consolas, monospace`;
  for (let i = 0; i < L.drops.length; i++) {
    const y = L.drops[i] * fs;
    if (y > 0) {
      ctx.fillStyle = Math.random() < 0.08 ? '#d8ffe2' : '#00ff41';
      ctx.fillText(pick(), i * fs, y);
    }
    if (y > h && Math.random() > 0.975) L.drops[i] = 0;
    L.drops[i] += L.speed;
  }
}

function still(L) {
  if (!size(L)) return;
  for (let k = 0; k < 40; k++) draw(L);
}

function tick(t) {
  raf = requestAnimationFrame(tick);
  if (!isRainOn() || document.hidden || t - last < 50) return; // ~20fps is plenty for rain
  last = t;
  layers.forEach((L) => (L.rm() ? null : draw(L)));
}

export function addRain(canvas, opts = {}) {
  const L = {
    canvas, ctx: canvas.getContext('2d'), fs: opts.fontSize || 14,
    fade: opts.fade ?? 0.08, speed: opts.speed ?? 0.55, w: 0, h: 0, drops: [],
    rm: opts.reducedMotion || (() => matchMedia('(prefers-reduced-motion: reduce)').matches),
  };
  layers.add(L);
  const enabled = isRainOn();
  L.canvas.style.visibility = enabled ? '' : 'hidden';
  if (enabled && L.rm()) requestAnimationFrame(() => still(L));
  if (enabled && !raf) raf = requestAnimationFrame(tick);
  const onResize = () => { if (!isRainOn()) return; L.rm() ? still(L) : size(L); };
  window.addEventListener('resize', onResize);
  return () => {
    layers.delete(L); window.removeEventListener('resize', onResize);
    if (!layers.size) { cancelAnimationFrame(raf); raf = 0; }
  };
}
