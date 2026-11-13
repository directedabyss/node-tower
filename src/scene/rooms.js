// Room interiors and screen painting. Keep this file easy to tweak.
// Neon green only. Blocked / waiting-on-owner use alert red. No gold.
import * as THREE from 'three';

export const GREEN = 0x00ff41;
export const GREEN_DIM = 0x007a2f;
export const GREEN_LIT = 0xd8ffe2;
export const ALERT_RED = 0xff2a2a;

export const ROOM_STYLE = {
  intake:  { accent: 0x1a3a22, label: 'INTAKE',  floor: 0x3a3e3c },
  dev:     { accent: 0x1a2a32, label: 'DEV',     floor: 0x3a3c42 },
  content: { accent: 0x2a2a28, label: 'MARKETING', floor: 0x3e3a3e },
  ops:     { accent: 0x1a3228, label: 'OPS',     floor: 0x3a3e3c },
  sales:   { accent: 0x2a2a1a, label: 'SALES',   floor: 0x3e3e3a },
  research: { accent: 0x1a2230, label: 'RESEARCH', floor: 0x3a3c40 },
  support: { accent: 0x1a2c2a, label: 'SUPPORT', floor: 0x3a3e3e },
  review:  { accent: 0x2a2228, label: 'REVIEW',  floor: 0x3e3a3c },
  hq:      { accent: 0x1a2a20, label: 'HQ',     floor: 0x3c403e }
};

export const ROLE = {
  atlas: 'CEO',
  nova: 'ARCHITECT',
  echo: 'DATA',
  orion: '3D',
  lyra: 'DESIGN',
  quill: 'WRITER',
  pixel: 'SOCIAL',
  vega: 'OPS',
  juno: 'SUPPORT',
  titan: 'LEAD',
  sol: 'SALES',
  iris: 'LAB',
  sentry: 'REVIEWER'
};

const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 12);

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.28, flatShading: true, ...extra });
}

/** Pixel metal floor tile (concepts from the station ref; no copied pixels). */
export function makeTileTex() {
  // dark riveted metal plates with worn seams
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#23262a';
  g.fillRect(0, 0, 32, 32);
  for (let i = 0; i < 70; i++) {
    const v = (i * 37) % 32, w = (i * 53 + 11) % 32;
    g.fillStyle = i % 3 ? '#1c1f22' : '#2b2f33';
    g.fillRect(v, w, 1 + (i % 2), 1);
  }
  g.strokeStyle = '#0c0d0f';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 30, 30);
  g.strokeStyle = '#33373c';
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(2.5, 2.5); g.lineTo(29.5, 2.5); g.stroke();
  for (const x of [5, 16, 27]) for (const y of [5, 27]) {
    g.fillStyle = '#0e0f11'; g.fillRect(x, y + 1, 2, 1);
    g.fillStyle = '#4a4f55'; g.fillRect(x, y, 2, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeRoomFloorMat(tint, tileTex, repeatX = 6, repeatZ = 6) {
  const map = tileTex.clone();
  map.repeat.set(repeatX, repeatZ);
  map.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    map, color: tint, roughness: 0.42, metalness: 0.55, flatShading: true
  });
}

export function addServerRack(group, x, z, ctx, w = 0.7, h = 1.55, d = 0.48) {
  const metal = ctx.metal;
  meshBox(group, metal, x, h / 2, z, w, h, d);
  meshBox(group, mat(0x0a0c0e, { metalness: 0.4 }), x, h / 2, z + d * 0.52, w * 0.92, h * 0.9, 0.04);
  const cols = 3, rows = 6;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const col = (r + c) % 4 === 0 ? 0xff2a2a : GREEN;
      const led = meshBox(
        group,
        mat(col, { emissive: col, emissiveIntensity: 0.35, roughness: 0.4 }),
        x - w * 0.28 + c * 0.2,
        0.28 + r * (h * 0.8 / rows),
        z + d * 0.55,
        0.07, 0.07, 0.04
      );
      if (ctx.leds) ctx.leds.push(led);
    }
  }
}

function meshBox(parent, material, x, y, z, sx, sy, sz, rotY = 0) {
  const m = new THREE.Mesh(box, material);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.rotation.y = rotY;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

export function makePlacard(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  const hex = '#' + color.toString(16).padStart(6, '0');
  g.fillStyle = 'rgba(0,0,0,0.82)';
  g.strokeStyle = hex;
  g.lineWidth = 5;
  g.fillRect(8, 8, 240, 48);
  g.strokeRect(8, 8, 240, 48);
  g.fillStyle = hex;
  g.font = 'bold 28px Segoe UI, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  spr.scale.set(1.15, 0.28, 1);
  return spr;
}

export function addRolePlacard(parent, x, y, z, botId, accent) {
  const spr = makePlacard(ROLE[botId] || 'AGENT', accent);
  spr.position.set(x, y, z);
  parent.add(spr);
  return spr;
}

// Distinct prop sets so each room reads as a different workplace. Tweak here.
export function dressRoom(group, roomId, ctx) {
  const { metal, rainMat } = ctx;
  if (roomId === 'intake') {
    [0x1a221c, 0x161c18, 0x1c201c, 0x141816].forEach((col, i) => {
      const x = -2.2 + (i % 2) * 1.4;
      const z = -2.4 + Math.floor(i / 2) * 1.3;
      meshBox(group, mat(col, { metalness: 0.45 }), x, 0.28, z, 0.7, 0.5, 0.7);
      meshBox(group, metal, x, 0.54, z, 0.74, 0.06, 0.74);
    });
    meshBox(group, metal, 2.2, 0.12, -2.2, 2.2, 0.16, 0.7);
    addServerRack(group, 2.4, -2.4, ctx);
  } else if (roomId === 'content') {
    const cam = new THREE.Group();
    cam.position.set(-2.3, 0, 1.8);
    const stand = new THREE.Mesh(cyl, metal);
    stand.scale.set(0.05, 1.1, 0.05);
    stand.position.y = 0.55;
    cam.add(stand);
    meshBox(cam, mat(0x111418), 0, 1.2, 0, 0.45, 0.22, 0.28);
    const lens = new THREE.Mesh(cyl, mat(0x00ff41, { emissive: 0x00ff41, emissiveIntensity: 0.35, metalness: 0.7 }));
    lens.rotation.x = Math.PI / 2;
    lens.scale.set(0.08, 0.12, 0.08);
    lens.position.set(0, 1.2, 0.32);
    cam.add(lens);
    group.add(cam);
    addServerRack(group, 2.3, 2.0, ctx);
    for (const sx of [-1, 1]) {
      meshBox(group, metal, sx * 2.5, 0.7, -2.3, 0.06, 1.4, 0.06);
      meshBox(group, mat(0xd8ffe2, { emissive: 0x00ff41, emissiveIntensity: 0.45 }), sx * 2.5, 1.5, -2.3, 0.7, 0.5, 0.08);
    }
  } else if (roomId === 'ops') {
    for (let r = 0; r < 2; r++) {
      const x = -2.4 + r * 1.15;
      meshBox(group, mat(0x101418, { metalness: 0.45 }), x, 0.95, -2.1, 0.9, 1.9, 0.55);
      if (rainMat) {
        const face = new THREE.Mesh(box, rainMat);
        face.scale.set(0.82, 1.7, 0.02);
        face.position.set(x, 0.95, -2.1 + 0.29);
        group.add(face);
      }
    }
    addServerRack(group, 2.4, -2.2, ctx, 0.8, 1.7, 0.5);
  } else if (roomId === 'sales') {
    for (let i = 0; i < 3; i++) {
      const x = -1.6 + i * 1.15;
      meshBox(group, metal, x, 1.35, -3.35, 1.0, 0.7, 0.06);
      if (rainMat) {
        const scr = new THREE.Mesh(box, rainMat);
        scr.scale.set(0.9, 0.6, 0.02);
        scr.position.set(x, 1.35, -3.31);
        group.add(scr);
      }
    }
    meshBox(group, metal, 2.3, 0.82, 0.15, 0.28, 0.06, 0.18);
    addServerRack(group, 2.5, -2.2, ctx);
  } else if (roomId === 'research') {
    meshBox(group, mat(0x161c18, { metalness: 0.4 }), -2.2, 0.72, -2.0, 2.4, 0.08, 0.9);
    meshBox(group, metal, -2.2, 0.36, -2.0, 2.3, 0.64, 0.8);
    const flask = new THREE.Mesh(cyl, mat(0x00ff41, { transparent: true, opacity: 0.35, emissive: 0x00ff41, emissiveIntensity: 0.4, roughness: 0.1 }));
    flask.scale.set(0.12, 0.28, 0.12);
    flask.position.set(-1.6, 1.0, -2.0);
    group.add(flask);
    meshBox(group, mat(GREEN, { emissive: GREEN, emissiveIntensity: 0.4 }), -2.4, 0.88, -2.15, 0.28, 0.16, 0.22);
    addServerRack(group, 2.4, -2.2, ctx);
  } else if (roomId === 'review') {
    meshBox(group, mat(0x161c18, { metalness: 0.35 }), 0, 0.72, -1.8, 1.8, 0.08, 1.1);
    meshBox(group, metal, 0, 0.36, -1.8, 1.6, 0.64, 0.9);
    meshBox(group, mat(GREEN, { emissive: GREEN, emissiveIntensity: 0.55 }), -0.7, 1.25, -1.8, 0.08, 1.0, 0.08);
    meshBox(group, mat(GREEN, { emissive: GREEN, emissiveIntensity: 0.55 }), 0.7, 1.25, -1.8, 0.08, 1.0, 0.08);
    meshBox(group, mat(GREEN_LIT, { emissive: GREEN, emissiveIntensity: 0.8 }), 0, 1.78, -1.8, 1.56, 0.08, 0.08);
    const beam = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.12, depthWrite: false }));
    beam.scale.set(1.3, 0.9, 0.02);
    beam.position.set(0, 1.25, -1.8);
    group.add(beam);
    if (ctx.beams) ctx.beams.push(beam);
    addServerRack(group, -2.5, -2.2, ctx);
  } else if (roomId === 'hq') {
    // Penthouse + outbox dock (hq.outbox). Shipping crates and a wide executive desk area.
    [[1.7, 1.65], [2.55, 1.65], [1.7, 2.4]].forEach((p, i) => {
      meshBox(group, mat(i === 1 ? 0x007a2f : 0x00c235, { roughness: 0.7 }), p[0], 0.28, p[1], 0.7, 0.5, 0.55);
    });
    meshBox(group, metal, 2.2, 0.72, -2.0, 2.2, 0.08, 0.9);
    meshBox(group, metal, 2.2, 0.36, -2.0, 2.0, 0.64, 0.8);
    if (rainMat) {
      const wall = new THREE.Mesh(box, rainMat);
      wall.scale.set(3.4, 1.4, 0.04);
      wall.position.set(0, 1.4, -3.4);
      group.add(wall);
    }
    addServerRack(group, -2.6, 2.2, ctx);
  } else {
    addServerRack(group, -2.4, -2.3, ctx);
    addServerRack(group, 2.4, -2.3, ctx, 0.65, 1.4, 0.45);
  }
}

export function makeScreenTex() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 80;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return { canvas: c, ctx, tex };
}

export function paintScreen(screen, mode, t) {
  const { ctx, canvas, tex } = screen;
  const w = canvas.width, h = canvas.height;
  if (mode === 'idle') {
    ctx.fillStyle = '#030805';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,255,65,0.28)';
    const scroll = (t * 10) % 16;
    for (let i = 0; i < 6; i++) {
      const y = ((i * 12 - scroll) % (h + 8));
      ctx.fillRect(8, y, 28 + ((i * 29) % 50), 2);
    }
    tex.needsUpdate = true;
    return;
  }
  if (mode === 'blocked') {
    const pulse = 0.3 + 0.4 * Math.abs(Math.sin(t * 5));
    ctx.fillStyle = `rgba(255,42,42,${pulse})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#100000';
    ctx.fillRect(10, 16, w - 20, 10);
    ctx.fillRect(10, 32, w - 36, 8);
    tex.needsUpdate = true;
    return;
  }
  ctx.fillStyle = '#020805';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#00ff41';
  const scroll = (t * 28) % 16;
  if (mode === 'bars') {
    for (let i = 0; i < 6; i++) {
      const bh = 8 + Math.abs(Math.sin(t * 3 + i)) * 28;
      ctx.fillRect(12 + i * 18, h - 8 - bh, 12, bh);
    }
  } else {
    for (let i = 0; i < 9; i++) {
      const y = ((i * 10 - scroll) % (h + 10));
      ctx.globalAlpha = 0.55 + (i % 3) * 0.15;
      ctx.fillRect(8, y, 40 + ((i * 37) % 70), 3);
    }
    ctx.globalAlpha = 1;
  }
  tex.needsUpdate = true;
}


// Dark stone blocks for the tower shell (running bond, chipped edges).
export function makeStoneTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#121416';
  g.fillRect(0, 0, 32, 32);
  const rows = 4, bh = 8;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? 8 : 0;
    for (let k = -1; k < 3; k++) {
      const x = k * 16 + off;
      const shade = ['#3a3d41', '#34373b', '#2f3236', '#383b3f'][(r + k + 4) % 4];
      g.fillStyle = shade;
      g.fillRect(x + 1, r * bh + 1, 14, bh - 2);
      g.fillStyle = '#4a4e53';
      g.fillRect(x + 1, r * bh + 1, 14, 1);
      g.fillStyle = '#26282b';
      g.fillRect(x + 1, r * bh + bh - 2, 14, 1);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
