// In-world code rain. One shared CanvasTexture, updated cheaply (~20fps).
// Used on monitors, wall panels and the lift shaft. Not a backdrop (HUD rain shows through the clear canvas).
import * as THREE from 'three';
import { isRainOn, subscribeRainPref } from '../hud/rainPref.js';

const GLYPHS = '0123456789ABCDEF+-=<>/*'; // own ASCII set: hex + a few symbols

export function createCodeRainTexture(w = 256, h = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const colW = 16;
  const cols = Math.floor(w / colW);
  const drops = Array.from({ length: cols }, () => Math.random() * h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  let acc = 0, cleared = false;
  function clear() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    tex.needsUpdate = true;
    cleared = true;
  }
  function update(dt) {
    if (!isRainOn()) {
      if (!cleared) clear();
      return;
    }
    cleared = false;
    acc += dt;
    if (acc < 0.05) return;
    acc = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = '13px ui-monospace, Menlo, monospace';
    for (let i = 0; i < cols; i++) {
      const x = i * colW;
      const y = drops[i];
      ctx.fillStyle = Math.random() < 0.1 ? '#d8ffe2' : '#00ff41';
      ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], x, y);
      drops[i] += 14;
      if (drops[i] > h) drops[i] = 0;
    }
    tex.needsUpdate = true;
  }
  subscribeRainPref((v) => { if (v !== 'on') clear(); });
  if (!isRainOn()) clear();
  return { tex, update, canvas };
}
