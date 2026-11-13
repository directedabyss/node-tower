// Data-driven tower: 4 office floors + Penthouse HQ, transparent canvas over HUD rain.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GREEN, GREEN_DIM, GREEN_LIT, ALERT_RED, ROOM_STYLE, dressRoom, addServerRack, makeScreenTex, paintScreen, makeTileTex, makeRoomFloorMat, makeStoneTex } from './rooms.js';
import { createCodeRainTexture } from './codeRain.js';

const ROOM = 7.2;
const HALL = 2.6;
const SPAN = ROOM / 2 + HALL / 2; // 4.9
const WALL_H = 2.15;
const SLAB = 0.22;
const FLOOR_GAP = 6.4;
const CORE = 2.15;
const FIG_SCALE = 2; // desks vs room
const DESK_SCALE = 0.98; // small enough for 2 rows of 3-4 desks per room
const AGENT_H = 2.45; // billboard world height; CEO is 1.5x, kept to ~1/4 of the HQ room on screen
const CEO_H = AGENT_H * 1.25; // a head taller than the agents, like the mockup
const TOWER_BOT_SCALE = 1.4; // slightly larger agents in the tower overview
const PIXEL_SCALE = 3; // low-res RT is ~1/3, then nearest-upscaled
const SHAFT_W = 0.9; // slim visual shaft
const SHAFT_X = 9.15; // east side of the tower, as in tower-layout.jpg

function ease(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function makeLabel(text, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const g = c.getContext('2d');
  const hex = '#' + color.toString(16).padStart(6, '0');
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(4, 6, 248, 36);
  g.strokeStyle = hex;
  g.globalAlpha = 0.7;
  g.lineWidth = 2;
  g.strokeRect(4, 6, 248, 36);
  g.globalAlpha = 1;
  g.fillStyle = hex;
  g.font = 'bold 18px ui-monospace, Menlo, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 25);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.72, depthWrite: false }));
  spr.scale.set(1.55, 0.29, 1);
  return spr;
}

function fillet(pts, r = 0.7) {
  if (pts.length < 3) return pts;
  const out = [pts[0].clone()];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const d1 = b.distanceTo(a), d2 = b.distanceTo(c);
    const rad = Math.min(r, d1 * 0.45, d2 * 0.45);
    if (rad < 0.08) { out.push(b.clone()); continue; }
    const v1 = a.clone().sub(b).normalize().multiplyScalar(rad);
    const v2 = c.clone().sub(b).normalize().multiplyScalar(rad);
    const p1 = b.clone().add(v1);
    const p2 = b.clone().add(v2);
    out.push(p1);
    // mid arc point so the packet cuts the corner instead of pausing on the vertex
    out.push(p1.clone().add(p2).multiplyScalar(0.5).add(b).multiplyScalar(0.5).add(p1.clone().add(p2).multiplyScalar(0.25)));
    out.push(p2);
  }
  out.push(pts[pts.length - 1].clone());
  return out;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} data feed snapshot (floors, rooms, walkways, lifts, bots, packets)
 * @param {object} [options]
 */
export function createArena(canvas, data, options = {}) {
  const isMobile = 'ontouchstart' in window || innerWidth < 600;
  const host = canvas.parentElement;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isMobile,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance'
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  renderer.toneMapping = THREE.NoToneMapping;

  const pixelRT = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false
  });
  pixelRT.texture.generateMipmaps = false;
  pixelRT.texture.colorSpace = THREE.SRGBColorSpace;
  pixelRT.texture.minFilter = THREE.NearestFilter;
  pixelRT.texture.magFilter = THREE.NearestFilter;
  const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const blitScene = new THREE.Scene();
  const blitMat = new THREE.MeshBasicMaterial({
    map: pixelRT.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false
  });
  blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat));
  canvas.style.imageRendering = 'pixelated';

  const scene = new THREE.Scene();
  // No scene.background and no sky sphere: HUD CodeRain shows through the clear canvas.

  // Flat side view: a narrow lens reads as no perspective, like the 2D mockups.
  const FLAT_FOV = 14, FLAT_K = Math.tan(THREE.MathUtils.degToRad(23)) / Math.tan(THREE.MathUtils.degToRad(FLAT_FOV / 2));
  const camera = new THREE.PerspectiveCamera(FLAT_FOV, 1, 0.5, 1600);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = !isMobile;
  controls.minDistance = 3 * FLAT_K;
  controls.maxDistance = 90 * FLAT_K;
  controls.minPolarAngle = Math.PI * 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;

  const hemi = new THREE.HemisphereLight(0xb8e0c4, 0x1a241c, 1.15);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0x6a8a72, 0.85);
  scene.add(amb);
  const sun = new THREE.DirectionalLight(0xe8ffe8, 1.15);
  sun.position.set(0, 22, 18); // from the south, with the floor camera
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xd8ffe2, 0.7);
  fill.position.set(0, 16, -10);
  scene.add(fill);

  const rain = createCodeRainTexture(256, 512);
  const rainMat = new THREE.MeshBasicMaterial({
    map: rain.tex, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false, color: 0xffffff
  });

  const flat = { flatShading: true };
  const matSuit = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.55, metalness: 0.2, ...flat });
  const matCoat = new THREE.MeshStandardMaterial({ color: 0x12161a, emissive: 0x0a2a14, emissiveIntensity: 0.22, roughness: 0.7, metalness: 0.12, ...flat });
  const matShirt = new THREE.MeshStandardMaterial({ color: 0xf5f5f2, roughness: 0.65, metalness: 0.05, ...flat });
  const matTie = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.5, metalness: 0.1, ...flat });
  const matShades = new THREE.MeshStandardMaterial({ color: 0x050508, roughness: 0.2, metalness: 0.6, ...flat });
  const matGraphite = new THREE.MeshStandardMaterial({ color: 0x0c100e, roughness: 0.72, metalness: 0.22, ...flat });
  const matSlab = new THREE.MeshStandardMaterial({ color: 0x0a0e0c, roughness: 0.8, metalness: 0.18, ...flat });
  const matMetal = new THREE.MeshStandardMaterial({ color: 0x1a221c, roughness: 0.32, metalness: 0.7, ...flat });
  const matWall = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.55, metalness: 0.45, ...flat });
  const matGlass = new THREE.MeshStandardMaterial({
    color: 0x0a2a14, roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.22,
    emissive: 0x003311, emissiveIntensity: 0.25, side: THREE.DoubleSide, depthWrite: false, ...flat
  });
  const matDesk = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.7, metalness: 0.05, ...flat }); // dark wood top
  const matChair = new THREE.MeshStandardMaterial({ color: 0x0c0e0d, roughness: 0.55, metalness: 0.2, ...flat });
  const matPlaza = new THREE.MeshStandardMaterial({ color: 0x060806, roughness: 0.9, metalness: 0.08, ...flat });
  const matAccent = new THREE.MeshStandardMaterial({ color: 0x1a3a22, emissive: 0x0a2a14, emissiveIntensity: 0.28, roughness: 0.4, metalness: 0.5, ...flat });
  const tileTex = makeTileTex();
  const matPacket = new THREE.MeshStandardMaterial({
    color: 0x1e8a44, emissive: 0x0a5a22, emissiveIntensity: 0.45, roughness: 0.35, metalness: 0.25
  });

  const geo = {
    box: new THREE.BoxGeometry(1, 1, 1),
    head: new THREE.SphereGeometry(0.22, 16, 12),
    body: new THREE.CapsuleGeometry(0.13, 0.28, 6, 10),
    leg: new THREE.CapsuleGeometry(0.045, 0.22, 4, 8),
    arm: new THREE.CapsuleGeometry(0.032, 0.16, 4, 8),
    hand: new THREE.SphereGeometry(0.04, 8, 6),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
    packet: new THREE.BoxGeometry(0.18, 0.18, 0.18)
  };

  // Modest plaza only - leave the sky open for the HUD rain.
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(16, 36), matPlaza);
  plaza.rotation.x = -Math.PI / 2;
  plaza.receiveShadow = true;
  scene.add(plaza);
  // Sparse distant towers, well outside the opening shot.
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + 0.4;
    const rad = 44 + (i % 3) * 8;
    const h = 6 + (i % 5) * 4;
    const b = new THREE.Mesh(geo.box, matGraphite);
    b.scale.set(2.2 + (i % 2), h, 2.2);
    b.position.set(Math.cos(ang) * rad, h / 2, Math.sin(ang) * rad);
    scene.add(b);
  }

  const floors = (data.floors || []).slice().sort((a, b) => a.level - b.level);
  const rooms = data.rooms || [];
  const walkwaysData = data.walkways || [];
  const liftsData = data.lifts || [];
  const roomById = Object.fromEntries(rooms.map((r) => [r.id, r]));
  const floorById = Object.fromEntries(floors.map((f) => [f.id, f]));

  const floorY = (level) => (level - 1) * FLOOR_GAP;
  const topLevel = floors.reduce((m, f) => Math.max(m, f.level || 1), 1);

  // Room placement: 2 rooms sit west/east of the core; a single office room sits east; HQ is a wide penthouse around the shaft.
  function roomOffset(room) {
    const fl = floorById[room.floor];
    if (fl?.penthouse || room.kind === 'hq' || room.id === 'hq') return new THREE.Vector3(0, 0, 0);
    const onFloor = rooms.filter((r) => r.floor === room.floor).sort((a, b) => (a.order || 0) - (b.order || 0));
    if (onFloor.length <= 1) return new THREE.Vector3(SPAN, 0, 0);
    const idx = Math.max(0, onFloor.findIndex((r) => r.id === room.id));
    const x = onFloor.length === 2 ? (idx === 0 ? -SPAN : SPAN) : (idx - (onFloor.length - 1) / 2) * (ROOM + 1.1);
    return new THREE.Vector3(x, 0, 0);
  }
  function roomWorld(room) {
    const f = floorById[room.floor];
    const y = floorY(f ? f.level : 1);
    const loc = roomOffset(room);
    return new THREE.Vector3(loc.x, y + SLAB, loc.z);
  }
  function roomSize(room) {
    const fl = floorById[room.floor];
    if (fl?.penthouse || room.kind === 'hq' || room.id === 'hq') return { w: 11.2, d: 9.2, h: 3.35 };
    return { w: ROOM, d: ROOM + 0.4, h: WALL_H };
  }

  const walkPaths = new Map();
  const liftPaths = new Map();
  const roomGroups = new Map();
  const roomCenters = new Map();
  const floorGroups = new Map();
  const floorBounds = new Map();
  const labels = [];
  const _labPos = new THREE.Vector3();
  function trackLabel(spr) {
    labels.push({ spr, bx: spr.scale.x, by: spr.scale.y });
    return spr;
  }
  function tickLabels() {
    // Keep world-space sprites from blowing up when the camera is close.
    const camPos = camera.position;
    for (let i = 0; i < labels.length; i++) {
      const L = labels[i];
      L.spr.getWorldPosition(_labPos);
      const k = THREE.MathUtils.clamp(_labPos.distanceTo(camPos) / 20, 0.4, 1);
      L.spr.scale.set(L.bx * k, L.by * k, 1);
    }
  }
  const leds = [];
  const beams = [];
  const wallScreens = [];
  let hqPad = new THREE.Vector3(2.4, floorY(topLevel) + SLAB + 0.4, -0.3);

  const roomWallMeshes = []; // hidden in the tower view so each floor reads as one wide room
  function addWalls(group, w, d, openings, accent) {
    const n0 = group.children.length;
    const h = WALL_H, t = 0.16, hx = w / 2, hz = d / 2, gap = 1.85;
    const accMat = new THREE.MeshStandardMaterial({
      color: accent, emissive: accent, emissiveIntensity: 0.16, roughness: 0.45, metalness: 0.55, flatShading: true
    });
    const side = (isZ, sign, open, lenFull) => {
      const make = (len, off) => {
        const wall = new THREE.Mesh(geo.box, matWall);
        if (isZ) { wall.scale.set(len, h, t); wall.position.set(off, h / 2, sign * hz); if (sign > 0) wall.userData.front = true; }
        else { wall.scale.set(t, h, len); wall.position.set(sign * hx, h / 2, off); }
        wall.castShadow = true;
        wall.receiveShadow = true;
        group.add(wall);
      };
      if (!open) make(lenFull, 0);
      else {
        const len = (lenFull - gap) / 2;
        const off = (gap + len) / 2;
        make(len, -off); make(len, off);
      }
    };
    side(true, -1, openings.n, w);
    side(true, 1, openings.s, w);
    side(false, 1, openings.e, d);
    side(false, -1, openings.w, d);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(geo.cyl, matMetal);
      post.scale.set(0.1, h, 0.1);
      post.position.set(sx * hx, h / 2, sz * hz);
      group.add(post);
      const cap = new THREE.Mesh(geo.cyl, accMat);
      cap.scale.set(0.12, 0.06, 0.12);
      cap.position.set(sx * hx, h, sz * hz);
      group.add(cap);
    }
    const edge = (x, z, sx, sz) => {
      const m = new THREE.Mesh(geo.box, accMat);
      m.position.set(x, h, z);
      m.scale.set(sx, 0.03, sz);
      group.add(m);
    };
    edge(0, -hz, w, 0.04); edge(0, hz, w, 0.04);
    edge(-hx, 0, 0.04, d); edge(hx, 0, 0.04, d);
    for (let k = n0; k < group.children.length; k++) roomWallMeshes.push(group.children[k]);
  }

  // Invisible walking path between two points; nothing is drawn. Packets are carried at hand height.
  function addWalkway(ax, az, bx, bz, yOff) {
    return {
      a: new THREE.Vector3(ax, yOff + 0.9, az),
      b: new THREE.Vector3(bx, yOff + 0.9, bz)
    };
  }

  function dockTowardCore(room, y) {
    const sz = roomSize(room);
    const wr = roomWorld(room);
    // Dock on the east side of the room, toward the side shaft.
    return new THREE.Vector3(wr.x + sz.w / 2 - 0.15, y, 0.25);
  }

  const screens = [];
  const deskScreens = [];
  const bots = [];
  const desksByBot = new Map();

  function addDesk(parent, x, z, rotY, monCount, botId, accent) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    const top = new THREE.Mesh(geo.box, matDesk);
    top.scale.set(1.55, 0.08, 0.72);
    top.position.set(0, 0.74, 0);
    top.castShadow = true;
    g.add(top);
    for (const sx of [-0.62, 0.62]) for (const sz of [-0.24, 0.24]) {
      const leg = new THREE.Mesh(geo.box, matMetal);
      leg.scale.set(0.08, 0.7, 0.08);
      leg.position.set(sx, 0.35, sz);
      g.add(leg);
    }
    const mons = [];
    const count = monCount || 1;
    const spread = count === 1 ? [0] : count === 2 ? [-0.28, 0.28] : [-0.42, 0, 0.42];
    spread.forEach((ox) => {
      const scr = makeScreenTex();
      const monMat = new THREE.MeshBasicMaterial({
        map: scr.tex, color: 0xffffff, toneMapped: false, side: THREE.DoubleSide
      });
      const mon = new THREE.Mesh(geo.box, monMat);
      mon.scale.set(count > 1 ? 0.48 : 0.68, 0.4, 0.04);
      mon.position.set(ox, 1.08, -0.26);
      g.add(mon);
      const bezel = new THREE.Mesh(geo.box, matMetal);
      bezel.scale.set((count > 1 ? 0.52 : 0.74), 0.46, 0.03);
      bezel.position.set(ox, 1.08, -0.29);
      g.add(bezel);
      // CRT tube housing behind the screen
      const tube = new THREE.Mesh(geo.box, matMetal);
      tube.scale.set((count > 1 ? 0.4 : 0.56), 0.36, 0.34);
      tube.position.set(ox, 1.07, -0.48);
      g.add(tube);
      const foot = new THREE.Mesh(geo.box, matMetal);
      foot.scale.set(0.22, 0.1, 0.2);
      foot.position.set(ox, 0.83, -0.4);
      g.add(foot);
      mons.push({ ...scr, mesh: mon, mat: monMat });
    });
    const chair = new THREE.Mesh(geo.box, matChair);
    chair.scale.set(0.4, 0.08, 0.4);
    chair.position.set(0, 0.42, 0.52);
    g.add(chair);
    const back = new THREE.Mesh(geo.box, matChair);
    back.scale.set(0.4, 0.38, 0.06);
    back.position.set(0, 0.64, 0.7);
    g.add(back);
    g.scale.setScalar(DESK_SCALE);
    parent.add(g);
    return { group: g, mons };
  }

  const SKINS = [0xe0b08a, 0xc49262, 0xa86e44, 0x8d5a38];
  const HAIRS = [0x3a2416, 0x3c2618, 0x382214, 0x3b2517]; // unsigned index; keep close to 0x3a2416
  function hashId(id) {
    let h = 0;
    const s = String(id || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function vox(mat, x, y, z, sx, sy, sz, parent) {
    const m = new THREE.Mesh(geo.box, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  const glyphMats = (() => {
    const bits = {
      '0': ['01110','10001','10001','10001','10001','10001','01110'],
      '1': ['00100','01100','00100','00100','00100','00100','01110'],
      '7': ['11111','00001','00010','00100','00100','01000','01000'],
      'Z': ['11111','00001','00010','00100','01000','10000','11111'],
      '#': ['01010','11111','01010','01010','11111','01010','01010'],
      'A': ['00100','01010','10001','11111','10001','10001','10001'],
      'E': ['11111','10000','10000','11110','10000','10000','11111'],
      'K': ['10001','10010','10100','11000','10100','10010','10001']
    };
    return Object.values(bits).map((rows) => {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 24;
      const g = c.getContext('2d');
      g.clearRect(0, 0, 16, 24);
      g.fillStyle = '#8cff9c';
      const s = 2; // 2px cells so glyphs read as 2-3px code
      const ox = 3, oy = 5;
      rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          if (row[x] === '1') g.fillRect(ox + x * s, oy + y * s, s, s);
        }
      });
      const tex = new THREE.CanvasTexture(c);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      return new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.95, depthWrite: false,
        toneMapped: false, side: THREE.DoubleSide
      });
    });
  })();

  const SPRITE_PX_W = 24;
  const SPRITE_PX_H = 32;
  // Agent art: 2D pixel sheet (public/sprites/agents.png, agents.json).
  const SHEET_W = 72, SHEET_H = 120;
  const SHEET_FRAMES = { type: 0, stand: 1, walk0: 2, walk1: 3, hold: 4, ceo: 5 };
  const POSE_CELLS = {
    stand: ['stand', 'stand'],
    walk: ['walk0', 'walk1', 'walk0'],
    type: ['type', 'type', 'type']
  };
  const sheetImg = new Image();
  const sheetWaiters = [];
  sheetImg.onload = () => { sheetWaiters.splice(0).forEach((fn) => fn()); };
  sheetImg.src = (import.meta.env?.BASE_URL || '/') + 'sprites/agents.png';
  function whenSheet(fn) { if (sheetImg.complete && sheetImg.naturalWidth) fn(); else sheetWaiters.push(fn); }

  function cssHex(n) {
    return '#' + (n >>> 0).toString(16).padStart(6, '0');
  }

  function px(g, x, y, w, h, c) {
    if (w <= 0 || h <= 0) return;
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  }

  function addGreenOutline(ctx, w, h) {
    const img = ctx.getImageData(0, 0, w, h);
    const src = new Uint8ClampedArray(img.data);
    const aAt = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : src[(y * w + x) * 4 + 3];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (src[i + 3] > 20) continue;
        const n = aAt(x - 1, y) + aAt(x + 1, y) + aAt(x, y - 1) + aAt(x, y + 1);
        if (n > 20) {
          img.data[i] = 0x55;
          img.data[i + 1] = 0xff;
          img.data[i + 2] = 0x88;
          img.data[i + 3] = 230;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function makeHaloTex() {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 40;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(16, 20, 3, 16, 20, 16);
    grd.addColorStop(0, 'rgba(90,255,140,0.5)');
    grd.addColorStop(0.4, 'rgba(40,220,90,0.22)');
    grd.addColorStop(1, 'rgba(0,40,20,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 40);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }
  const ceoHaloTex = makeHaloTex();

  // Front-facing pixel Agent / CEO. y=0 is the top of the canvas; feet sit on the last row.
  function drawAgentFrame(g, pose, frame, hair, skin, ceo) {
    const W = SPRITE_PX_W, H = SPRITE_PX_H;
    g.clearRect(0, 0, W, H);
    const SUIT = '#0a0a0c';
    const SUIT_HI = '#16161a';
    const COAT = '#0b0c0e';
    const COAT_HI = '#1e2126';
    const COAT_EDGE = '#3a3f46';
    const SHIRT = '#f3f3ee';
    const TIE = '#0b0b0b';
    const SHADE = '#050508';
    const SHADE_HI = '#3a3a44';
    const SHOE = '#050506';
    const EAR = '#2a2c2e';
    const LED = '#3cff7a';
    const HAIR_HI = '#4a3220';

    const walk = pose === 'walk';
    const type = pose === 'type';
    const stand = pose === 'stand';

    // Stride / bounce in pixels
    let legL = 0, legR = 0, armSwing = 0, bounce = 0;
    if (walk) {
      if (frame === 0) { legL = 2; legR = -1; armSwing = 1; }
      else if (frame === 1) { legL = 0; legR = 0; armSwing = 0; }
      else { legL = -1; legR = 2; armSwing = -1; }
      bounce = frame === 1 ? 0 : 1;
    } else if (type) {
      bounce = frame === 1 ? 1 : 0;
    } else if (stand && frame === 1) {
      bounce = 0;
    }

    // Typing is a seated pose: drop the body in the canvas (transparent top)
    // so the typist reads shorter than aisle standers, seat at the chair.
    const y0 = bounce + (type ? 11 : 0);
    // Head box
    const hx = 7, hw = 10; // face x=7..16
    const hairY = 2 + y0;
    const faceY = 4 + y0;

    // Thin slicked cap (2px), not a hair block
    px(g, hx, hairY, hw, 1, HAIR_HI);
    px(g, hx - 1, hairY + 1, hw + 2, 1, hair);
    // a little side sweep
    px(g, hx - 1, hairY + 2, 2, 1, hair);
    px(g, hx + hw - 1, hairY + 2, 2, 2, hair);

    // Face
    px(g, hx, faceY, hw, 7, skin);
    // Shades - wide black bar, 2px tall, slight highlight
    px(g, hx - 1, faceY + 2, hw + 2, 2, SHADE);
    px(g, hx, faceY + 2, 1, 1, SHADE_HI);
    px(g, hx + 5, faceY + 2, 1, 1, SHADE_HI);
    // Nose peek under shades
    px(g, hx + 4, faceY + 4, 2, 1, skin);
    // Mouth
    px(g, hx + 3, faceY + 6, 4, 1, '#6a4030');

    // Ears + earpiece on the viewer's right (agent's left if unflipped - still reads)
    px(g, hx - 1, faceY + 2, 1, 3, skin);
    px(g, hx + hw, faceY + 2, 1, 3, skin);
    px(g, hx + hw + 1, faceY + 2, 2, 2, EAR);
    px(g, hx + hw + 2, faceY + 2, 1, 1, LED);

    // Neck
    px(g, hx + 3, faceY + 7, 4, 2, skin);

    const torsoY = 13 + y0;
    const coatHem = ceo ? (type ? 27 + bounce : 28 + y0) : (type ? 24 + bounce : 22 + y0);

    if (ceo) {
      // Long dark-gray coat, flared, with a lighter lapel/edge and a tail split.
      px(g, 5, torsoY - 1, 14, 2, COAT_HI); // collar
      px(g, 4, torsoY + 1, 16, coatHem - (torsoY + 1) - 2, COAT);
      px(g, 3, coatHem - 6, 18, 4, COAT); // flare
      px(g, 2, coatHem - 3, 20, 3, COAT);
      // tail split down the hem
      g.clearRect(11, coatHem - 5, 2, 7);
      px(g, 10, coatHem - 5, 1, 6, COAT_EDGE);
      px(g, 13, coatHem - 5, 1, 6, COAT_EDGE);
      // outer hem + lapel highlight (lighter than the suit)
      px(g, 2, coatHem, 9, 1, COAT_EDGE);
      px(g, 13, coatHem, 9, 1, COAT_EDGE);
      px(g, 8, torsoY, 1, 7, COAT_EDGE);
      px(g, 15, torsoY, 1, 7, COAT_EDGE);
      px(g, 8, torsoY, 3, 4, COAT_HI);
      px(g, 13, torsoY, 3, 4, COAT_HI);
      // black shirt between the lapels, no tie
      px(g, 10, torsoY, 4, 8, '#050506');
      px(g, 11, torsoY, 2, 1, '#1c1e22');
    } else {
      // Suit jacket
      px(g, 6, torsoY - 1, 12, 1, SUIT_HI);
      px(g, 5, torsoY, 14, 10, SUIT);
      // White shirt V
      px(g, 10, torsoY, 4, 2, SHIRT);
      px(g, 11, torsoY + 2, 2, 1, SHIRT);
      px(g, 10, torsoY + 2, 1, 2, SHIRT);
      px(g, 13, torsoY + 2, 1, 2, SHIRT);
      // Black tie
      px(g, 11, torsoY + 1, 2, 8, TIE);
      // hips
      px(g, 6, torsoY + 9, 12, 2, SUIT);
    }

    // Arms
    if (type) {
      // Arms forward / typing: hands in front of the waist, bounce by frame
      const hy = torsoY + 7 + (frame % 3 === 0 ? 0 : frame % 3 === 1 ? 1 : 0);
      const hxL = 8 + (frame === 2 ? 1 : 0);
      const hxR = 14 - (frame === 0 ? 1 : 0);
      px(g, 6, torsoY + 1, 3, 6, ceo ? COAT : SUIT);
      px(g, 15, torsoY + 1, 3, 6, ceo ? COAT : SUIT);
      px(g, hxL, hy, 3, 2, skin);
      px(g, hxR, hy + (frame === 1 ? -1 : 0), 3, 2, skin);
    } else {
      const aL = 4 - (armSwing > 0 ? 0 : 0);
      const aR = 18;
      const aY = torsoY + (armSwing === 0 ? 0 : 0);
      const aLen = 8 + (walk ? Math.abs(armSwing) : 0);
      px(g, 4, aY + (armSwing < 0 ? 1 : 0), 2, aLen, ceo ? COAT : SUIT);
      px(g, 18, aY + (armSwing > 0 ? 1 : 0), 2, aLen, ceo ? COAT : SUIT);
      // hands
      px(g, 4, aY + aLen + (armSwing < 0 ? 1 : 0), 2, 2, skin);
      px(g, 18, aY + aLen + (armSwing > 0 ? 1 : 0), 2, 2, skin);
    }

    // Legs + shoes. Seated typists tuck short shins under the desk; stand/walk keep full legs.
    if (type) {
      const hipY = Math.min(26, torsoY + 9);
      px(g, 6, hipY, 12, 2, SUIT);           // thighs on the seat
      px(g, 7, hipY + 2, 4, 3, SUIT);        // short shins
      px(g, 13, hipY + 2, 4, 3, SUIT);
      px(g, 7, hipY + 5, 5, 2, SHOE);
      px(g, 13, hipY + 5, 5, 2, SHOE);
    } else {
      const legY = ceo ? coatHem + 1 : 23 + y0;
      const footBase = 30;
      const lTop = legY;
      const lH_L = Math.max(2, footBase + legL - lTop);
      const lH_R = Math.max(2, footBase + legR - lTop);
      px(g, 7, lTop, 4, lH_L, SUIT);
      px(g, 13, lTop, 4, lH_R, SUIT);
      px(g, 7, lTop + lH_L, 5, 2, SHOE);
      px(g, 13, lTop + lH_R, 5, 2, SHOE);
    }

    // Stand frame 1: slight weight shift already covered; add a 1px coat/suit crease
    if (stand && frame === 1) {
      px(g, 9, torsoY + 5, 1, 3, ceo ? COAT_HI : SUIT_HI);
    }
  }

  function makeAgentFrames(hairHex, skinHex, ceo) {
    const hair = cssHex(hairHex);
    const skin = cssHex(skinHex);
    const poses = { stand: 2, walk: 3, type: 3 };
    const out = {};
    Object.keys(poses).forEach((pose) => {
      out[pose] = [];
      for (let f = 0; f < poses[pose]; f++) {
        const c = document.createElement('canvas');
        c.width = SHEET_W;
        c.height = SHEET_H;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = false;
        const cell = SHEET_FRAMES[ceo ? 'ceo' : POSE_CELLS[pose][f % POSE_CELLS[pose].length]];
        const tex = new THREE.CanvasTexture(c);
        whenSheet(() => {
          g.clearRect(0, 0, SHEET_W, SHEET_H);
          g.drawImage(sheetImg, cell * SHEET_W, 0, SHEET_W, SHEET_H, 0, 0, SHEET_W, SHEET_H);
          tex.needsUpdate = true;
        });
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        out[pose].push(tex);
      }
    });
    return out;
  }

  function setBotSpriteFrame(bot, pose, t) {
    const frames = bot.frames[pose];
    if (!frames || !frames.length) return;
    bot.pose = pose;
    const rate = pose === 'walk' ? 7 : pose === 'type' ? 6 : 1.4;
    const i = Math.floor(t * rate + bot.phase * 3) % frames.length;
    const key = pose + i;
    if (bot.frameKey !== key) {
      bot.frameKey = key;
      bot.sprite.material.map = frames[i];
      bot.sprite.material.needsUpdate = true;
    }
    setBotFlip(bot, bot.flip || 1);
  }

  function setBotFlip(bot, flip) {
    const k = bot.viewScale || 1;
    // Seated typists are shorter so they read as sitting at the chair, not standing in the aisle.
    const sit = bot.pose === 'type' ? 0.84 : 1;
    const h = bot.spriteH * k * sit;
    const w = h * (SHEET_W / SHEET_H);
    bot.flip = flip;
    bot.sprite.scale.set((flip < 0 ? -1 : 1) * w, h, 1);
    bot.sprite.position.y = h / 2;
    if (bot.halo) {
      bot.halo.scale.set(Math.abs(w) * 1.6, h * 1.5, 1);
      bot.halo.position.y = h / 2;
    }
  }

  function makeBot(isCeo, botId) {
    const root = new THREE.Group();
    const hsh = hashId(botId);
    const skinCol = SKINS[hsh % SKINS.length];
    const hairCol = isCeo ? 0x0a0a0c : (HAIRS[(hsh >>> 3) % HAIRS.length] || 0x3a2416);
    const spriteH = isCeo ? CEO_H : AGENT_H;
    const frames = makeAgentFrames(hairCol, skinCol, isCeo);
    const mat = new THREE.SpriteMaterial({
      map: frames.stand[0],
      transparent: true,
      alphaTest: 0.15,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
      sizeAttenuation: true
    });
    const sprite = new THREE.Sprite(mat);
    const spriteW = spriteH * (SHEET_W / SHEET_H);
    sprite.scale.set(spriteW, spriteH, 1);
    sprite.position.set(0, spriteH / 2, 0);
    sprite.center.set(0.5, 0.5);
    root.add(sprite);
    let halo = null;
    if (isCeo) {
      halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: ceoHaloTex,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        opacity: 0.9
      }));
      halo.scale.set(spriteW * 1.6, spriteH * 1.5, 1);
      halo.position.set(0, spriteH / 2, 0);
      halo.renderOrder = 4;
      root.add(halo);
      sprite.renderOrder = 5;
    }

    // Anchor hooks: head at the sprite top, foot at the floor.
    const head = new THREE.Group();
    head.position.set(0, spriteH, 0);
    root.add(head);
    const armL = new THREE.Group();
    const armR = new THREE.Group();
    const legL = new THREE.Group();
    const legR = new THREE.Group();
    root.add(armL, armR, legL, legR);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(isCeo ? 0.38 : 0.28, isCeo ? 0.52 : 0.38, 16),
      new THREE.MeshBasicMaterial({
        color: isCeo ? GREEN : ALERT_RED,
        transparent: true,
        opacity: isCeo ? 0.32 : 0,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    root.add(ring);

    let glowLight = null;
    const glyphs = [];
    if (isCeo) {
      glowLight = new THREE.PointLight(GREEN, 1.4, 5.5, 2);
      glowLight.position.set(0, spriteH * 0.55, 0);
      root.add(glowLight);
      const rim = new THREE.PointLight(0x1aff6a, 0.7, 4, 2);
      rim.position.set(0, spriteH * 0.55, -0.5);
      root.add(rim);
      // Glowing green platform under the CEO: dark base disk, lit top and a bright rim.
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(1.45, 1.55, 0.14, 32),
        new THREE.MeshStandardMaterial({ color: 0x0c1a12, emissive: GREEN, emissiveIntensity: 0.18, roughness: 0.6, metalness: 0.4 })
      );
      pad.position.y = 0.07;
      root.add(pad);
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(1.3, 32),
        new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.145;
      root.add(glow);
      const rimRing = new THREE.Mesh(
        new THREE.RingGeometry(1.36, 1.5, 32),
        new THREE.MeshBasicMaterial({ color: GREEN_LIT, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
      );
      rimRing.rotation.x = -Math.PI / 2;
      rimRing.position.y = 0.15;
      root.add(rimRing);
      const geoGlyph = new THREE.PlaneGeometry(0.24, 0.36);
      for (let i = 0; i < 40; i++) {
        const gmat = glyphMats[i % glyphMats.length].clone();
        const gm = new THREE.Mesh(geoGlyph, gmat);
        gm.userData = {
          phase: Math.random(),
          r: 1.55 + (i % 6) * 0.17, // outside the sprite so the code rain shows around him
          speed: 0.4 + (i % 7) * 0.1,
          spin: (i % 2 === 0 ? 1 : -1) * (0.35 + (i % 4) * 0.12)
        };
        root.add(gm);
        glyphs.push(gm);
      }
    }
    return {
      root, head, armL, armR, handR: armR, legL, legR,
      ring, glowLight, glyphs, halo, isCeo, sprite, frames, spriteH, frameKey: 'stand0', flip: 1, viewScale: 1
    };
  }

  const tower = new THREE.Group();
  scene.add(tower);

  const shaftH = floorY(topLevel) + 4.2;
  const shaftParts = [];
  const shaftRainMat = rainMat.clone();
  shaftRainMat.opacity = 0.32;
  const shaftGlassMat = matGlass.clone();
  shaftGlassMat.opacity = 0.1;
  const shaftGroup = new THREE.Group();
  shaftGroup.position.x = SHAFT_X;
  tower.add(shaftGroup);
  function addShaftPart(mesh) {
    shaftGroup.add(mesh);
    shaftParts.push({ mesh, h0: mesh.scale.y, x0: mesh.scale.x, z0: mesh.scale.z, px: mesh.position.x, pz: mesh.position.z });
  }
  function setShaftTop(topY) {
    const h = Math.max(0.5, Math.min(shaftH, topY));
    const k = h / shaftH;
    shaftParts.forEach((p) => {
      p.mesh.scale.y = p.h0 * k;
      p.mesh.position.y = h / 2;
    });
  }
  function setShaftFloorMode(on) {
    shaftRainMat.opacity = on ? 0.16 : 0.32;
    shaftGlassMat.opacity = on ? 0.05 : 0.1;
  }
  // Slim rain well, tucked as a narrow column rather than a room-sized box.
  const hw = SHAFT_W / 2;
  for (const [x, z, sx, sz] of [
    [0, -hw + 0.02, SHAFT_W - 0.08, 0.04],
    [0, hw - 0.02, SHAFT_W - 0.08, 0.04],
    [-hw + 0.02, 0, 0.04, SHAFT_W - 0.08],
    [hw - 0.02, 0, 0.04, SHAFT_W - 0.08]
  ]) {
    const pan = new THREE.Mesh(geo.box, shaftRainMat);
    pan.scale.set(sx, shaftH, sz);
    pan.position.set(x, shaftH / 2, z);
    addShaftPart(pan);
  }
  const shaftGlass = new THREE.Mesh(new THREE.BoxGeometry(SHAFT_W + 0.06, shaftH, SHAFT_W + 0.06), shaftGlassMat);
  shaftGlass.position.y = shaftH / 2;
  addShaftPart(shaftGlass);
  for (const sx of [-hw, hw]) {
    const rail = new THREE.Mesh(geo.box, matAccent);
    rail.scale.set(0.04, shaftH, 0.04);
    rail.position.set(sx, shaftH / 2, hw);
    addShaftPart(rail);
  }
  const liftCar = new THREE.Mesh(geo.box, matMetal);
  liftCar.scale.set(SHAFT_W * 0.7, 0.08, SHAFT_W * 0.7);
  liftCar.position.y = floorY(1) + 0.5;
  shaftGroup.add(liftCar);

  const deskRot = Math.PI;

  function addFloorPlate(g, w, d, hole, holeX = 0, holeZ = 0) {
    const add = (x, z, sw, sd) => {
      if (sw < 0.05 || sd < 0.05) return;
      const sl = new THREE.Mesh(geo.box, matSlab);
      sl.scale.set(sw, SLAB, sd);
      sl.position.set(x, SLAB / 2, z);
      sl.receiveShadow = true;
      sl.castShadow = true;
      g.add(sl);
    };
    if (!hole) {
      add(0, 0, w, d);
      return;
    }
    const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
    const hx0 = holeX - hole / 2, hx1 = holeX + hole / 2;
    const hz0 = holeZ - hole / 2, hz1 = holeZ + hole / 2;
    add(0, (hz1 + z1) / 2, w, z1 - hz1); // north
    add(0, (z0 + hz0) / 2, w, hz0 - z0); // south
    add((x0 + hx0) / 2, (hz0 + hz1) / 2, hx0 - x0, hole); // west
    add((hx1 + x1) / 2, (hz0 + hz1) / 2, x1 - hx1, hole); // east
  }

  for (const fl of floors) {
    const y = floorY(fl.level);
    const g = new THREE.Group();
    g.position.y = y;
    g.userData.level = fl.level;
    g.userData.floorId = fl.id;
    const floorRooms = rooms.filter((r) => r.floor === fl.id).sort((a, b) => (a.order || 0) - (b.order || 0));
    const isPent = !!fl.penthouse;
    const baseW = isPent ? 12.4 : (floorRooms.length <= 1 ? SPAN + ROOM + 1.4 : SPAN * 2 + ROOM + 0.8);
    const plateW = Math.max(baseW, (SHAFT_X + SHAFT_W / 2 + 0.6) * 2);
    const plateD = isPent ? 10.2 : ROOM + 1.6;
    addFloorPlate(g, plateW, plateD, SHAFT_W + 0.25, SHAFT_X, 0);
    const content = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    if (floorRooms.length) {
      floorRooms.forEach((room) => {
        const loc = roomOffset(room);
        const sz = roomSize(room);
        content.minX = Math.min(content.minX, loc.x - sz.w / 2);
        content.maxX = Math.max(content.maxX, loc.x + sz.w / 2);
        content.minZ = Math.min(content.minZ, loc.z - sz.d / 2);
        content.maxZ = Math.max(content.maxZ, loc.z + sz.d / 2);
      });
    } else {
      content.minX = -4; content.maxX = 4; content.minZ = -4; content.maxZ = 4;
    }
    const pad = 0.5;
    content.minX -= pad; content.maxX += pad;
    content.minZ -= pad; content.maxZ += pad;
    content.cx = (content.minX + content.maxX) / 2;
    content.cz = (content.minZ + content.maxZ) / 2;
    floorBounds.set(fl.id, { w: plateW, d: plateD, y, level: fl.level, penthouse: isPent, content });
    const veil = new THREE.Mesh(
      geo.box,
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.62, depthWrite: false })
    );
    veil.scale.set(plateW + 0.25, WALL_H + 1.4, plateD + 0.25);
    veil.position.y = (WALL_H + 1.4) / 2;
    veil.visible = false;
    veil.renderOrder = 2;
    g.add(veil);
    g.userData.veil = veil;
    for (const [x, z, sx, sz] of [[0, -plateD / 2, plateW, 0.05], [0, plateD / 2, plateW, 0.05], [-plateW / 2, 0, 0.05, plateD], [plateW / 2, 0, 0.05, plateD]]) {
      const e = new THREE.Mesh(geo.box, matAccent);
      e.position.set(x, SLAB + 0.02, z);
      e.scale.set(sx, 0.03, sz);
      g.add(e);
    }
    const lamp = new THREE.PointLight(isPent ? 0xe0e4e0 : 0xc8ccc8, isPent ? 5.2 : 4.0, 22, 1.4);
    lamp.position.set(0, 2.8, 0);
    g.add(lamp);
    const flLab = makeLabel((isPent ? 'PENTHOUSE HQ' : fl.name).toUpperCase(), GREEN_DIM);
    flLab.scale.set(2.15, 0.4, 1);
    flLab.position.set(0, 2.45, -plateD / 2 - 0.45);
    flLab.visible = false; // HUD owns floor and room labels now
    g.add(flLab);
    trackLabel(flLab);
    tower.add(g);
    floorGroups.set(fl.id, g);

    floorRooms.forEach((room) => {
      const loc = roomOffset(room);
      const sz = roomSize(room);
      const style = ROOM_STYLE[room.id] || ROOM_STYLE[room.kind] || { accent: GREEN, label: (room.name || room.id).toUpperCase() };
      const rg = new THREE.Group();
      rg.position.set(loc.x, SLAB, loc.z);
      const floorTint = style.floor || 0x1a1c1e;
      const tileMat = makeRoomFloorMat(floorTint, tileTex, Math.max(3, Math.round(sz.w)), Math.max(3, Math.round(sz.d)));
      const tile = new THREE.Mesh(geo.box, tileMat);
      tile.scale.set(sz.w - 0.12, 0.04, sz.d - 0.12);
      tile.position.y = 0.02;
      tile.receiveShadow = true;
      rg.add(tile);
      const openings = { n: false, s: true, e: true, w: loc.x > 0 && !isPent };
      if (isPent) { openings.e = true; openings.w = false; openings.s = true; }
      addWalls(rg, sz.w, sz.d, openings, style.accent);
      // HUD draws room name pills via setRoomAnchors. No 3D room tags.
      dressRoom(rg, room.id, { metal: matMetal, graphite: matGraphite, rainMat, leds, beams, wallScreens });
      g.add(rg);
      roomGroups.set(room.id, rg);
      // Place the HUD pill at the near-left (south) edge so it does not sit on aisle agents / the CEO.
      roomCenters.set(room.id, new THREE.Vector3(loc.x - sz.w * 0.28, y + 0.95, loc.z + sz.d * 0.38));
    });

    // Same-floor walkways, routed south of the core so packets clear the shaft.
    floorRooms.forEach((room, idx) => {
      const next = floorRooms[idx + 1];
      if (!next) return;
      const ww = walkwaysData.find((b) => (b.from === room.id && b.to === next.id) || (b.from === next.id && b.to === room.id));
      if (!ww) return;
      const a = roomOffset(room), b = roomOffset(next);
      const aw = roomSize(room).w / 2, bw = roomSize(next).w / 2;
      const zWalk = Math.max(roomSize(room).d, roomSize(next).d) * 0.18;
      const ax = a.x + Math.sign(b.x - a.x) * (aw - 0.05);
      const bx = b.x + Math.sign(a.x - b.x) * (bw - 0.05);
      const path = addWalkway(ax, zWalk, bx, zWalk, SLAB + 0.1);
      const wa = path.a.clone(); wa.y += y;
      const wb = path.b.clone(); wb.y += y;
      walkPaths.set(ww.id, { a: wa, b: wb, from: ww.from, to: ww.to });
    });
  }

  // Per-lift waypoints: desk-side dock -> shaft -> vertical -> dest dock.
  liftsData.forEach((lift) => {
    const aRoom = roomById[lift.fromRoom], bRoom = roomById[lift.toRoom];
    if (!aRoom || !bRoom) return;
    const fa = floorById[aRoom.floor], fb = floorById[bRoom.floor];
    const y1 = floorY(fa ? fa.level : 1) + SLAB + 0.32;
    const y2 = floorY(fb ? fb.level : 2) + SLAB + 0.32;
    const d1 = dockTowardCore(aRoom, y1);
    const d2 = dockTowardCore(bRoom, y2);
    const c1 = new THREE.Vector3(SHAFT_X, y1, 0);
    const c2 = new THREE.Vector3(SHAFT_X, y2, 0);
    const mid1 = d1.clone().lerp(c1, 0.65);
    const mid2 = d2.clone().lerp(c2, 0.65);
    liftPaths.set(lift.id, [d1, mid1, c1, c2, mid2, d2]);
  });

  const hqRoom = rooms.find((r) => r.kind === 'hq' || r.id === 'hq');
  if (hqRoom) {
    const wr = roomWorld(hqRoom);
    hqPad.set(2.35, wr.y + 0.42, -0.35);
  }

  const botsByRoom = {};
  (data.bots || []).forEach((bd) => { (botsByRoom[bd.room] || (botsByRoom[bd.room] = [])).push(bd); });

  function chairWorld(deskGroup) {
    const p = new THREE.Vector3(0, 0, 0.50);
    deskGroup.updateWorldMatrix(true, false);
    deskGroup.localToWorld(p);
    return p;
  }

  const railTiles = [];
  const railByRoom = new Map();
  function furnishRoom(room) {
    const roomId = room.id;
    const rg = roomGroups.get(roomId);
    if (!rg) return;
    const style = ROOM_STYLE[roomId] || ROOM_STYLE[room.kind] || { accent: GREEN };
    const sz = roomSize(room);
    const isHQ = roomId === 'hq' || room.kind === 'hq';
    const isIntake = roomId === 'intake';
    const cols = isIntake ? 2 : 4;
    const deskW = 1.55 * DESK_SCALE;
    const gap = isHQ ? 0.45 : 0.2;
    const total = cols * deskW + (cols - 1) * gap;
    const x0 = -total / 2 + deskW / 2;
    const xs = Array.from({ length: cols }, (_, i) => x0 + i * (deskW + gap));
    const rowZs = isHQ ? [-2.15, 2.15] : (isIntake ? [-1.45, 1.45] : [-1.7, 1.7]);
    const zWalk = 0;
    const monCount = roomId === 'dev' ? 3 : roomId === 'content' ? 2 : 1;
    const slots = [];
    rowZs.forEach((z, ri) => {
      const rot = ri === 0 ? 0 : Math.PI;
      xs.forEach((x) => {
        const rec = addDesk(rg, x, z, rot, monCount, null, style.accent);
        deskScreens.push(rec.mons);
        slots.push({ desk: rec.group, mons: rec.mons, chair: chairWorld(rec.group), rot: rot + Math.PI });
      });
    });
    // server consoles behind the back row of desks
    if (!isIntake) {
      const cz = rowZs[0] - 0.95;
      xs.forEach((x) => addServerRack(rg, x, cz, { metal: matMetal, graphite: matGraphite, rainMat, leds, beams, wallScreens }, 0.62, 1.05, 0.34));
    }
    const half = Math.min(sz.w * 0.44, Math.max(1.2, total / 2 + 0.35));
        const aisleA = new THREE.Vector3(-half * 0.85, 0, zWalk);
    const aisleB = new THREE.Vector3(half * 0.85, 0, zWalk);
    rg.updateWorldMatrix(true, false);
    rg.localToWorld(aisleA);
    rg.localToWorld(aisleB);
    // Handoff rail down the center aisle: dark track, green light strip, sliding task tiles.
    if (!isHQ) {
      const len = total * 0.92;
      const rail = new THREE.Group();
      rail.position.set(0, 0, sz.d / 2 - 0.45); // front edge so the flat side view shows it
      const base = new THREE.Mesh(geo.box, matMetal);
      base.scale.set(len, 0.16, 0.42);
      base.position.y = 0.08;
      rail.add(base);
      const strip = new THREE.Mesh(geo.box, new THREE.MeshBasicMaterial({ color: 0x1f8a42, toneMapped: false }));
      strip.scale.set(len, 0.05, 0.04);
      strip.position.set(0, 0.1, 0.22);
      rail.add(strip);
      const tileMatR = new THREE.MeshBasicMaterial({ color: 0x3cff7a, toneMapped: false });
      const n = Math.max(3, Math.round(len / 0.9));
      for (let k = 0; k < n; k++) {
        const tile = new THREE.Mesh(geo.box, tileMatR);
        tile.scale.set(0.42, 0.14, 0.3);
        tile.position.y = 0.23;
        rail.add(tile);
        railTiles.push({ mesh: tile, len, off: k / n });
      }
      rg.add(rail);
      const ra = new THREE.Vector3(-len / 2 + 0.2, 0.42, zWalk);
      const rb = new THREE.Vector3(len / 2 - 0.2, 0.42, zWalk);
      rg.updateWorldMatrix(true, false);
      rg.localToWorld(ra); rg.localToWorld(rb);
      railByRoom.set(roomId, { a: ra, b: rb });
    }
    const list = botsByRoom[roomId] || [];
    list.forEach((bd, i) => {
      const isCeo = bd.role === 'ceo' || bd.id === 'atlas';
      const bot = makeBot(isCeo, bd.id);
      bot.id = bd.id;
      bot.data = bd;
      bot.room = roomId;
      bot.status = bd.status || 'idle';
      bot.phase = i * 1.3;
      if (isCeo) {
        const home = new THREE.Vector3(0, 0, 0);
        rg.localToWorld(home);
        bot.home = home;
        bot.aisle = home.clone();
        bot.walk = null;
        bot.root.position.copy(home);
      } else {
        const slot = slots[i % slots.length];
        bot.home = slot.chair.clone();
        bot.aisle = aisleA.clone().lerp(aisleB, (i + 0.5) / Math.max(1, list.length));
        bot.walk = null; // idle agents do not pace; they stand guard
        // Guard post along the side walls in the center aisle, alternating west/east.
        const gx = (i % 2 === 0 ? -1 : 1) * (sz.w / 2 - 0.55 - Math.floor(i / 2) * 1.3); // spread along x so the flat side view never stacks two agents
        const gz = zWalk + 0.7; // in front of the rail
        const guard = new THREE.Vector3(gx, 0, gz);
        rg.localToWorld(guard);
        bot.guard = guard;
        bot.root.position.copy(guard); // start at the post; working agents snap to their chair in the tick
        bot.root.position.copy(bot.home);
        screens.push({ botId: bd.id, mons: slot.mons });
        desksByBot.set(bd.id, { desk: slot.desk, world: bot.home.clone(), roomId, rot: slot.rot });
      }
      scene.add(bot.root);
      bots.push(bot);
    });
  }

  // Tower shell: one solid stone building, each floor a single wide room, lift on the right.
  const shell = new THREE.Group();
  tower.add(shell);
  let shellHalfW = 8.5, shellD = 10;
  floorBounds.forEach((b) => { shellHalfW = Math.max(shellHalfW, (b.w || 0) / 2); shellD = Math.max(shellD, b.d || 0); });
  const SHELL_XL = -shellHalfW - 0.3;
  const SHELL_XR = SHAFT_X + SHAFT_W / 2 + 2.0; // wide enough for a readable lift bay
  const SHELL_W = SHELL_XR - SHELL_XL;
  const SHELL_CX = (SHELL_XL + SHELL_XR) / 2;
  const SHELL_ZB = -shellD / 2 - 0.15;
  const SHELL_ZF = shellD / 2;
  const stoneTex = makeStoneTex();
  const stoneMat = (rx, ry) => {
    const t = stoneTex.clone();
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, color: 0xb8bcc0, roughness: 0.85, metalness: 0.1, ...flat });
  };
  const shellBox = (mat, x, y, z, sx, sy, sz) => {
    const m = new THREE.Mesh(geo.box, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    shell.add(m);
    return m;
  };
  const matBackStone = stoneMat(SHELL_W / 1.2, FLOOR_GAP / 1.2);
  const matSideStone = stoneMat(shellD / 1.2, FLOOR_GAP / 1.2);
  const matBandStone = stoneMat(SHELL_W / 1.2, 0.6);
  const matPillar = stoneMat(1, FLOOR_GAP / 1.2);
  const matLamp = new THREE.MeshBasicMaterial({ color: 0xe6ffe8, toneMapped: false });
  const matFill = new THREE.MeshStandardMaterial({ map: (() => { const t = tileTex.clone(); t.repeat.set(SHELL_W, shellD); t.needsUpdate = true; return t; })(), color: 0x2a2e30, roughness: 0.5, metalness: 0.5, ...flat });
  const shellLamps = [];
  const matLiftGlow = new THREE.MeshBasicMaterial({ color: 0x2c8c4a, toneMapped: false });
  const matLiftRail = new THREE.MeshBasicMaterial({ color: 0x3cff7a, toneMapped: false });
  floors.forEach((fl) => {
    const y = floorY(fl.level);
    const top = fl.level >= topLevel ? y + WALL_H + 1.9 : y + FLOOR_GAP - SLAB;
    const h = top - y;
    shellBox(matFill, SHELL_CX, y + SLAB - 0.03, (SHELL_ZB + SHELL_ZF) / 2, SHELL_W, 0.02, SHELL_ZF - SHELL_ZB); // full-width floor
    shellBox(matBackStone, SHELL_CX, y + h / 2, SHELL_ZB, SHELL_W, h, 0.3);
    shellBox(matSideStone, SHELL_XL, y + h / 2, (SHELL_ZB + SHELL_ZF) / 2, 0.45, h, SHELL_ZF - SHELL_ZB);
    shellBox(matSideStone, SHELL_XR, y + h / 2, (SHELL_ZB + SHELL_ZF) / 2, 0.45, h, SHELL_ZF - SHELL_ZB);
    // lift bay divider so the shaft reads as its own column on the right
    const xD = SHAFT_X - SHAFT_W / 2 - 0.35;
    shellBox(matSideStone, xD, y + h / 2, (SHELL_ZB + SHELL_ZF) / 2, 0.3, h, SHELL_ZF - SHELL_ZB);
    // lit lift car per floor, like the mockup's green cabs on the right
    const bayL = xD + 0.15, bayR = SHELL_XR - 0.23, bayW = bayR - bayL, bayCx = (bayL + bayR) / 2;
    shellBox(matLiftGlow, bayCx, y + SLAB + (WALL_H + 0.5) / 2, SHELL_ZB + 0.2, bayW - 0.1, WALL_H + 0.5, 0.05);
    for (const ex of [bayL + 0.06, bayR - 0.06]) shellBox(matLiftRail, ex, y + h / 2, SHELL_ZB + 0.3, 0.05, h, 0.05);
    shellBox(matLiftRail, bayCx, y + SLAB + WALL_H + 0.62, SHELL_ZB + 0.3, bayW - 0.1, 0.05, 0.05);
    shellBox(matLamp, bayCx, top - 0.12, (SHELL_ZB + SHELL_ZF) / 2, bayW * 0.6, 0.06, 0.18);
    for (const x of [SHELL_XL, SHELL_XR]) shellBox(matPillar, x, y + h / 2, SHELL_ZF, 0.6, h, 0.6);
    // slab band between floors
    shellBox(matBandStone, SHELL_CX, top + SLAB / 2, SHELL_ZF, SHELL_W + 0.6, SLAB + 0.3, 0.5);
    // ceiling lamps
    for (let k = 0; k < 3; k++) {
      const lx = SHELL_XL + (SHELL_W - 1.6) * ((k + 0.5) / 3);
      const lampBar = shellBox(matLamp, lx, top - 0.12, (SHELL_ZB + SHELL_ZF) / 2 - 0.6, 1.6, 0.06, 0.18);
      shellLamps.push(lampBar);
    }
    const pl = new THREE.PointLight(0xe8ffe8, 5.5, 18, 1.2);
    pl.position.set(SHELL_CX, top - 0.5, 0.5);
    shell.add(pl);
  });
  // roof cap and parapet
  const roofY = floorY(topLevel) + WALL_H + 1.9;
  shellBox(matBandStone, SHELL_CX, roofY + 0.35, (SHELL_ZB + SHELL_ZF) / 2, SHELL_W + 0.7, 0.4, SHELL_ZF - SHELL_ZB + 0.5);
  // plinth the building stands on
  shellBox(matBandStone, SHELL_CX, -0.35, (SHELL_ZB + SHELL_ZF) / 2, SHELL_W + 1.2, 0.7, SHELL_ZF - SHELL_ZB + 1.2);

  rooms.forEach((room) => furnishRoom(room));

  const packetPool = [];
  function makePacketMesh() {
    const m = new THREE.Mesh(geo.packet, matPacket.clone());
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x3cff7a, transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false })
    );
    m.add(halo);
    m.visible = false;
    scene.add(m);
    return m;
  }
  function getPacketMesh() {
    const m = packetPool.find((p) => !p.userData.live) || makePacketMesh();
    if (!packetPool.includes(m)) packetPool.push(m);
    m.userData.live = true;
    m.visible = true;
    return m;
  }

  const movers = [];
  const deliveredStacks = [];

  function hopPoints(hopId) {
    if (walkPaths.has(hopId)) {
      const b = walkPaths.get(hopId);
      return [b.a.clone(), b.b.clone()];
    }
    if (liftPaths.has(hopId)) return liftPaths.get(hopId).map((p) => p.clone());
    return [];
  }

  function deskPos(botId) {
    const d = desksByBot.get(botId);
    if (!d) return null;
    const p = new THREE.Vector3(0, 0.88, 0.02);
    d.desk.updateWorldMatrix(true, false);
    d.desk.localToWorld(p);
    return p;
  }

  function pointsForRoute(ev) {
    const pts = [];
    const fromDesk = ev.fromBot ? deskPos(ev.fromBot) : null;
    if (fromDesk) pts.push(fromDesk);
    const railOf = (botId) => railByRoom.get(desksByBot.get(botId)?.roomId);
    const onRail = (r, x) => new THREE.Vector3(THREE.MathUtils.clamp(x, Math.min(r.a.x, r.b.x), Math.max(r.a.x, r.b.x)), r.a.y, r.a.z);
    const r0 = ev.fromBot ? railOf(ev.fromBot) : null;
    const r1 = ev.toBot ? railOf(ev.toBot) : null;
    if (fromDesk && r0) {
      pts.push(onRail(r0, fromDesk.x));
      if (r0 === r1) {
        const td = deskPos(ev.toBot);
        if (td) pts.push(onRail(r0, td.x));
      } else {
        pts.push(onRail(r0, r0.b.x));
      }
    }
    const hops = ev.route?.path || (ev.route?.id ? [ev.route.id] : []);
    hops.forEach((id) => {
      const hp = hopPoints(id);
      if (!hp.length) return;
      if (pts.length) {
        const last = pts[pts.length - 1];
        if (last.distanceToSquared(hp[hp.length - 1]) < last.distanceToSquared(hp[0])) hp.reverse();
      }
      hp.forEach((p, j) => {
        if (j === 0 && pts.length && pts[pts.length - 1].distanceTo(p) < 0.2) return;
        pts.push(p);
      });
    });
    const toDesk = ev.toBot ? deskPos(ev.toBot) : null;
    if (toDesk && r1 && r1 !== r0) {
      pts.push(onRail(r1, r1.a.x));
      pts.push(onRail(r1, toDesk.x));
    }
    const dest = toDesk || (ev.toRoom === 'hq' || ev.type === 'done' ? hqPad.clone() : null);
    if (dest) pts.push(dest.clone());
    if (pts.length < 2 && ev.fromRoom && ev.toRoom && ev.fromRoom !== ev.toRoom) {
      const a = roomWorld(roomById[ev.fromRoom] || { floor: 'f1', id: ev.fromRoom });
      const b = roomWorld(roomById[ev.toRoom] || { floor: 'hq', id: ev.toRoom });
      a.y += 0.9; b.y += 0.9;
      pts.push(a, b);
    }
    return fillet(pts, 0.75);
  }

  function startMove(ev) {
    if (!ev) return;
    if (!['assign', 'handoff', 'review', 'done'].includes(ev.type)) return;
    movers.forEach((m) => { if (m.id === ev.packetId) m.done = true; });
    const mesh = getPacketMesh();
    mesh.userData.packetId = ev.packetId;
    mesh.material.color.set(GREEN);
    mesh.material.emissive.set(GREEN);
    const points = pointsForRoute(ev);
    if (points.length < 2) {
      mesh.position.copy(points[0] || hqPad);
      mesh.userData.live = ev.type === 'done';
      if (ev.type !== 'done') mesh.visible = false;
      if (ev.type === 'done') deliveredStacks.push(mesh);
      return;
    }
    let len = 0;
    for (let i = 1; i < points.length; i++) len += points[i].distanceTo(points[i - 1]);
    movers.push({
      id: ev.packetId, mesh, points, t: 0, len: Math.max(0.2, len),
      speed: 3.4, blocked: false, holdBot: ev.toBot || null, deliver: ev.type === 'done'
    });
  }

  function holdAtBot(packetId, botId, blocked) {
    let mv = movers.find((m) => m.id === packetId && !m.done);
    const p = deskPos(botId) || hqPad.clone();
    if (!mv) {
      const mesh = getPacketMesh();
      mesh.userData.packetId = packetId;
      mesh.position.copy(p);
      mv = { id: packetId, mesh, points: [p, p], t: 1, len: 1, speed: 1, blocked: !!blocked, holdBot: botId, deliver: false };
      movers.push(mv);
    }
    mv.holdBot = botId;
    mv.blocked = !!blocked;
    mv.t = 1;
    mv.mesh.position.copy(p);
    if (blocked) {
      mv.mesh.material.color.set(ALERT_RED);
      mv.mesh.material.emissive.set(ALERT_RED);
    } else {
      mv.mesh.material.color.set(GREEN);
      mv.mesh.material.emissive.set(GREEN);
    }
  }

  function parkDelivered(mesh) {
    const n = deliveredStacks.length;
    const row = n % 4, col = Math.floor(n / 4);
    mesh.position.set(hqPad.x + 0.35 + row * 0.28, hqPad.y + col * 0.22, hqPad.z - 0.15);
    mesh.userData.live = true;
    mesh.visible = true;
    deliveredStacks.push(mesh);
  }

  function tickMovers(dt, t) {
    for (let i = movers.length - 1; i >= 0; i--) {
      const mv = movers[i];
      if (mv.done) {
        if (!mv.deliver) { mv.mesh.visible = false; mv.mesh.userData.live = false; }
        movers.splice(i, 1);
        continue;
      }
      if (mv.holdBot && mv.t >= 1 && !mv.deliver) {
        const p = deskPos(mv.holdBot);
        if (p) mv.mesh.position.copy(p);
      } else if (mv.t < 1) {
        mv.t = Math.min(1, mv.t + (dt * mv.speed) / mv.len);
        // Ease only the first/last 12% of the whole path so corners stay continuous.
        let u = mv.t;
        if (u < 0.12) u = ease(u / 0.12) * 0.12;
        else if (u > 0.88) u = 0.88 + ease((u - 0.88) / 0.12) * 0.12;
        const dist = u * mv.len;
        let acc = 0;
        let pos = mv.points[0];
        for (let k = 1; k < mv.points.length; k++) {
          const seg = mv.points[k].distanceTo(mv.points[k - 1]);
          if (acc + seg >= dist || k === mv.points.length - 1) {
            const f = seg < 1e-5 ? 1 : (dist - acc) / seg;
            pos = mv.points[k - 1].clone().lerp(mv.points[k], THREE.MathUtils.clamp(f, 0, 1));
            break;
          }
          acc += seg;
        }
        mv.mesh.position.copy(pos);
        // Ride the lift car if this packet is in the shaft.
        if (Math.abs(pos.x - SHAFT_X) < 1.15 && Math.abs(pos.z) < 1.15) liftCar.position.y = pos.y - 0.15;
        if (mv.t >= 1 && mv.deliver) {
          parkDelivered(mv.mesh);
          mv.done = true;
        }
      }
      const pulse = 0.15 + 0.2 * Math.abs(Math.sin(t * 5));
      if (mv.blocked) {
        mv.mesh.material.emissive.set(ALERT_RED);
        mv.mesh.material.emissiveIntensity = 0.45 + pulse;
        mv.mesh.children[0].material.color.set(ALERT_RED);
        mv.mesh.children[0].material.opacity = 0.16 + pulse * 0.18;
      } else {
        mv.mesh.material.emissive.set(0x0a5a22);
        mv.mesh.material.emissiveIntensity = 0.5;
        mv.mesh.children[0].material.opacity = 0.18;
        mv.mesh.rotation.y += dt * 1.6;
      }
    }
  }

  function resolveFloorId(id) {
    if (id == null || id === '' || id === 'tower' || id === 'overview') return null;
    if (typeof id === 'number' || (typeof id === 'string' && /^[1-4]$/.test(String(id)))) {
      const n = +id;
      const f = floors.find((x) => x.level === n && !x.penthouse) || floors.find((x) => x.level === n);
      return f ? f.id : null;
    }
    const s = String(id).toLowerCase();
    if (s === 'hq' || s === 'penthouse' || s === 'f5') return 'hq';
    if (floorById[id]) return id;
    return id;
  }

  const _fitNdc = new THREE.Vector3();
  const _fitDir = new THREE.Vector3(1, 0.95, 1.15).normalize();
  const _fitCam = new THREE.PerspectiveCamera(FLAT_FOV, 1, 0.5, 1600);

  function measureCorners(tmp, corners) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, cy = 0;
    for (let c = 0; c < corners.length; c++) {
      _fitNdc.copy(corners[c]).project(tmp);
      minX = Math.min(minX, _fitNdc.x);
      maxX = Math.max(maxX, _fitNdc.x);
      minY = Math.min(minY, _fitNdc.y);
      maxY = Math.max(maxY, _fitNdc.y);
      cy += _fitNdc.y;
    }
    return { minX, maxX, minY, maxY, cy: cy / corners.length, spanX: Math.max(1e-4, maxX - minX), spanY: Math.max(1e-4, maxY - minY) };
  }

  function viewSize() {
    const w = Math.max(1, canvas.clientWidth || (isMobile ? 390 : 1440));
    const h = Math.max(1, canvas.clientHeight || (isMobile ? 844 : 900));
    return { w, h };
  }
  function safeInsets(portrait) {
    // CSS-pixel HUD chrome. 390 header ~170 and bottom rail ~230 (unchanged).
    if (portrait) return { left: 12, right: 12, top: 170, bottom: 230 };
    // Desktop 1440: merged HUD left panel right edge is 242, .bah-trail left edge is 1090
    // (right inset 350). Keep a few px of air so east walls/desks don't kiss the panel.
    return { left: 248, right: 358, top: 60, bottom: 80 };
  }
  function insetNdc(ins, w, h) {
    return {
      x0: (ins.left / w) * 2 - 1,
      x1: 1 - (ins.right / w) * 2,
      y0: -1 + (ins.bottom / h) * 2,
      y1: 1 - (ins.top / h) * 2
    };
  }
  const _fitRight = new THREE.Vector3();
  const _fitUp = new THREE.Vector3();
  function measureCornersSafe(tmp, corners) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, behind = 0, n = 0;
    for (let c = 0; c < corners.length; c++) {
      _fitNdc.copy(corners[c]).project(tmp);
      if (!Number.isFinite(_fitNdc.x) || !Number.isFinite(_fitNdc.y) || _fitNdc.z > 1) {
        behind += 1;
        continue;
      }
      minX = Math.min(minX, _fitNdc.x);
      maxX = Math.max(maxX, _fitNdc.x);
      minY = Math.min(minY, _fitNdc.y);
      maxY = Math.max(maxY, _fitNdc.y);
      n += 1;
    }
    if (!n) return { minX: -2, maxX: 2, minY: -2, maxY: 2, spanX: 4, spanY: 4, behind, n: 0 };
    return { minX, maxX, minY, maxY, spanX: Math.max(1e-4, maxX - minX), spanY: Math.max(1e-4, maxY - minY), behind, n };
  }
  function setupFitCam(tmp, tgt, forward, dist, aspect) {
    tmp.fov = camera.fov;
    tmp.aspect = aspect;
    tmp.near = 0.1;
    tmp.far = 400;
    tmp.position.copy(tgt).addScaledVector(forward, dist);
    tmp.up.set(0, 1, 0);
    tmp.lookAt(tgt);
    tmp.updateMatrixWorld(true);
    tmp.updateProjectionMatrix();
  }
  function fitInSafeView(target, corners, dir, aspect, insNdc, distMin, distMax) {
    const tmp = _fitCam;
    const wantW = Math.max(0.2, insNdc.x1 - insNdc.x0);
    const wantH = Math.max(0.2, insNdc.y1 - insNdc.y0);
    const midX = (insNdc.x0 + insNdc.x1) / 2;
    const midY = (insNdc.y0 + insNdc.y1) / 2;
    const forward = dir.clone().normalize();
    _fitRight.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    _fitUp.crossVectors(_fitRight, forward).normalize();
    const lo = (distMin || 4) * FLAT_K, hi = (distMax || 80) * FLAT_K;
    let dist = THREE.MathUtils.clamp(Math.max(lo, 28 * FLAT_K), lo, hi);
    const origin = target.clone();
    const tgt = target.clone();
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    // Distance first, from the content origin, so corners stay in front of the camera.
    for (let i = 0; i < 10; i++) {
      setupFitCam(tmp, origin, forward, dist, aspect);
      const m = measureCornersSafe(tmp, corners);
      const scale = (m.behind || !m.n) ? 1.35 : Math.max(m.spanX / wantW, m.spanY / wantH, 0.25);
      dist = THREE.MathUtils.clamp(dist * scale, lo, hi);
    }
    // Then pan (damped, clamped) so the fitted box sits in the HUD-safe well.
    for (let i = 0; i < 8; i++) {
      setupFitCam(tmp, tgt, forward, dist, aspect);
      const m = measureCornersSafe(tmp, corners);
      if (m.n) {
        const scale = Math.max(m.spanX / wantW, m.spanY / wantH, 0.25);
        dist = THREE.MathUtils.clamp(dist * (0.65 + 0.35 * scale), lo, hi);
        const cx = (m.minX + m.maxX) / 2;
        const cy = (m.minY + m.maxY) / 2;
        const halfH = Math.tan(vFov / 2) * dist;
        const halfW = halfH * aspect;
        // _fitRight is camera-left (forward x worldUp). Moving along it by (mid-cur) is
        // equivalent to moving camera-right by (cur-desired), which shifts content toward midX.
        tgt.addScaledVector(_fitRight, (midX - cx) * halfW * 0.55);
        // _fitUp is camera-up; moving the camera up sends content down, so invert Y.
        tgt.addScaledVector(_fitUp, (cy - midY) * halfH * 0.55);
        if (tgt.distanceTo(origin) > 10) {
          tgt.sub(origin).setLength(10).add(origin);
        }
      }
    }
    return { pos: tgt.clone().addScaledVector(forward, dist), target: tgt, dist };
  }
  function fitFloorDistance(target, corners, aspect, portrait) {
    // kept as a fallback; floorPose uses fitInSafeView.
    const { w, h } = viewSize();
    const ndc = insetNdc(safeInsets(portrait), w, h);
    return fitInSafeView(target, corners, _fitDir, aspect, ndc, 4, 48).dist;
  }

  function overviewPose() {
    // Side cutaway: nearly front-on, a little from above, so floors stack like the mockup.
    const aspect = Math.max(0.4, camera.aspect || (isMobile ? 390 / 844 : 16 / 10));
    const portrait = aspect < 0.85;
    const { w, h } = viewSize();
    let maxW = 12, maxD = 10;
    floorBounds.forEach((b) => {
      maxW = Math.max(maxW, b.w || 0);
      maxD = Math.max(maxD, b.d || 0);
    });
    const xEast = SHELL_XR + 0.4;
    const xWest = SHELL_XL - 0.4;
    const zN = SHELL_ZB;
    const zS = SHELL_ZF;
    const yBot = floorY(1) - 0.7;
    const yTop = floorY(topLevel) + WALL_H + 2.6;
    const corners = [];
    for (const x of [xWest, xEast]) for (const z of [zN, zS]) for (const y of [yBot, yTop]) corners.push(new THREE.Vector3(x, y, z));
    const target = new THREE.Vector3((xWest + xEast) / 2, (yBot + yTop) / 2, 0);
    _fitDir.set(0, 0.06, 1).normalize();
    const ins = portrait ? { left: 8, right: 8, top: 150, bottom: 205 } : { left: 250, right: 360, top: 70, bottom: 70 };
    const fitted = fitInSafeView(target, corners, _fitDir, aspect, insetNdc(ins, w, h), 10, 140);
    return { pos: fitted.pos, target: fitted.target };
  }
  function floorPose(id) {
    const fid = resolveFloorId(id);
    const fl = floorById[fid] || floors[0];
    const y = floorY(fl.level);
    const b = floorBounds.get(fl.id) || { w: 16, d: 10, penthouse: !!fl.penthouse };
    // Center on the rooms/content, not the widened floor slab (the east shaft landing
    // made a lone Content room sit under the Packet Trail / off the 390 edge).
    const c = b.content;
    const cx = c ? c.cx : 0;
    const cz = c ? c.cz : 0;
    const minX = c ? c.minX : -b.w * 0.5;
    const maxX = c ? c.maxX : b.w * 0.5;
    const minZ = c ? c.minZ : -b.d * 0.5;
    const maxZ = c ? c.maxZ : b.d * 0.5;
    const target = new THREE.Vector3(cx, y + 0.2, cz);
    const top = y + WALL_H + 0.2;
    const corners = [];
    for (const x of [minX, maxX]) for (const z of [minZ, maxZ]) {
      corners.push(new THREE.Vector3(x, y, z));
      corners.push(new THREE.Vector3(x, top, z));
    }
    if (fl.penthouse) {
      const ceoTop = y + CEO_H + 0.35;
      corners.push(new THREE.Vector3(0, ceoTop, 0));
      corners.push(new THREE.Vector3(0, y, 0));
    }
    const aspect = Math.max(0.4, camera.aspect || (isMobile ? 390 / 844 : 16 / 10));
    const portrait = aspect < 0.85;
    if (portrait && !fl.penthouse) {
      // Phone: close-up of the busiest room on this floor.
      const fr = rooms.filter((r) => r.floor === fl.id);
      if (fr.length > 1) {
        const best = fr.slice().sort((a, b2) => (botsByRoom[b2.id] || []).length - (botsByRoom[a.id] || []).length)[0];
        const loc = roomOffset(best);
        const sz = roomSize(best);
        corners.length = 0;
        for (const x of [loc.x - sz.w * 0.46, loc.x + sz.w * 0.46]) for (const z of [loc.z - sz.d / 2, loc.z + sz.d / 2]) { // crop side walls: room fills the phone down to the card
          corners.push(new THREE.Vector3(x, y, z));
          corners.push(new THREE.Vector3(x, top, z));
        }
        target.set(loc.x, y + 0.2, loc.z);
      }
    }
    const tilt = THREE.MathUtils.degToRad(portrait ? 26 : 16);
    _fitDir.set(0, Math.tan(tilt), 1).normalize();
    const { w, h } = viewSize();
    const fitted = fitInSafeView(target, corners, _fitDir, aspect, insetNdc(safeInsets(portrait), w, h), 4, 56);
    return { pos: fitted.pos, target: fitted.target };
  }
  function botPose(botId) {
    const d = desksByBot.get(botId);
    if (!d) return overviewPose();
    const p = d.world;
    const s = FIG_SCALE;
    return { pos: new THREE.Vector3(p.x, p.y + 1.2 * FLAT_K, p.z + 5.6 * FLAT_K), target: new THREE.Vector3(p.x, p.y + 0.6, p.z) };
  }

  const camTween = { active: false, t: 0, dur: 1.2, fromP: new THREE.Vector3(), fromT: new THREE.Vector3(), toP: new THREE.Vector3(), toT: new THREE.Vector3() };
  let currentFloor = null;

  let allowOrbitUpdate = true;
  controls.addEventListener('start', () => { allowOrbitUpdate = true; });

  function startTween(pose, dur) {
    camTween.active = true;
    camTween.start = performance.now();
    camTween.dur = (dur || 1.2) * 1000;
    camTween.fromP.copy(camera.position);
    camTween.fromT.copy(controls.target);
    camTween.toP.copy(pose.pos);
    camTween.toT.copy(pose.target);
    allowOrbitUpdate = false;
    controls.enabled = false;
  }
  function applyTween() {
    if (!camTween.active) return;
    // Wall-clock progress so a throttled rAF (headless/screenshots) cannot stall the fly-in.
    const k = Math.min(1, ease((performance.now() - camTween.start) / camTween.dur));
    camera.position.lerpVectors(camTween.fromP, camTween.toP, k);
    controls.target.lerpVectors(camTween.fromT, camTween.toT, k);
    camera.lookAt(controls.target);
    if (k >= 1) {
      camTween.active = false;
      camera.position.copy(camTween.toP);
      controls.target.copy(camTween.toT);
      camera.lookAt(controls.target);
      controls.enabled = true;
      controls.update();
      controls.saveState();
      // Hold the programmatic pose until the user orbits; otherwise OrbitControls
      // can ease the camera back toward the previous tower view.
      allowOrbitUpdate = !currentFloor;
    }
  }

  function applyCutaway() {
    const fl = currentFloor ? floorById[currentFloor] : null;
    const selLv = fl ? fl.level : null;
    floorGroups.forEach((g, id) => {
      const lv = floorById[id]?.level || 0;
      if (!fl) {
        g.visible = true;
        if (g.userData.veil) g.userData.veil.visible = false;
      } else if (lv > selLv) {
        g.visible = false;
        if (g.userData.veil) g.userData.veil.visible = false;
      } else {
        g.visible = true;
        if (g.userData.veil) g.userData.veil.visible = lv < selLv;
        if (lv < selLv) { g.visible = false; if (g.userData.veil) g.userData.veil.visible = false; } // flat side view: one floor at a time
      }
    });
    bots.forEach((b) => {
      const room = roomById[b.room];
      const lv = floorById[room?.floor]?.level || 1;
      b.root.visible = !fl || lv === selLv;
      // Floor views: draw current-floor sprites over desks so the suit/shades/tie
      // still read. Other floors (and the tower) keep depth test so agents don't
      // punch through the floor plate.
      if (b.sprite) {
        const onSel = !!(fl && room?.floor === currentFloor);
        const inTower = !fl;
        b.sprite.material.depthTest = !(onSel || inTower);
        b.sprite.renderOrder = (onSel || inTower) ? 5 : 2;
        if (b.halo) {
          b.halo.material.depthTest = b.sprite.material.depthTest;
          b.halo.renderOrder = b.sprite.renderOrder - 1;
        }
        b.viewScale = inTower ? TOWER_BOT_SCALE : 1;
        setBotFlip(b, b.flip || 1);
      }
    });
    shell.visible = !fl;
    plaza.visible = !!fl && selLv <= 1; // only under the ground floor in the flat view
    roomWallMeshes.forEach((m) => { m.visible = !!fl && !m.userData.front; });
    if (!fl) setShaftTop(shaftH);
    else if (fl.level >= topLevel) setShaftTop(floorY(fl.level) + 1.15); // keep the well short so it doesn't cover desks
    else setShaftTop(floorY(fl.level) + 1.15);
    setShaftFloorMode(!!fl);
    const hq = !!(fl && fl.penthouse);
    hemi.intensity = fl ? (hq ? 1.95 : 1.75) : 2.0;
    amb.intensity = fl ? (hq ? 1.5 : 1.35) : 1.5;
    sun.intensity = fl ? (hq ? 2.0 : 1.8) : 1.9;
    fill.intensity = fl ? 0.7 : 1.25;
    if (host) host.classList.toggle('is-floor', !!currentFloor);
  }

  function goOverview(fromHud) {
    currentFloor = null;
    applyCutaway();
    startTween(overviewPose(), 1.3);
    if (!fromHud) window.dispatchEvent(new CustomEvent('botarena-floor', { detail: { floor: null } }));
  }
  function goFloor(id, fromHud) {
    const fid = resolveFloorId(id);
    if (!fid) return goOverview(fromHud);
    currentFloor = fid;
    applyCutaway();
    startTween(floorPose(fid), 1.15);
    if (!fromHud) window.dispatchEvent(new CustomEvent('botarena-floor', { detail: { floor: fid } }));
  }
  function flyToBot(id) {
    const b = bots.find((x) => x.id === id);
    if (b) {
      currentFloor = roomById[b.room]?.floor || currentFloor;
      applyCutaway();
    }
    startTween(botPose(id), 1.1);
  }

  applyCutaway(); // tower view at load: shell on, room walls and plaza off
  const ov = overviewPose();
  camera.position.copy(ov.pos);
  controls.target.copy(ov.target);
  controls.update();

  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let down = null;
  function onPtrDown(e) { down = { x: e.clientX, y: e.clientY }; }
  function onPtrUp(e) {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    down = null;
    if (dx * dx + dy * dy > 16) return;
    const rect = canvas.getBoundingClientRect();
    ptr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ptr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(bots.filter((b) => b.root.visible).map((b) => b.root), true);
    if (hits.length) {
      let obj = hits[0].object;
      while (obj && !bots.find((b) => b.root === obj)) obj = obj.parent;
      const bot = bots.find((b) => b.root === obj);
      if (bot) window.dispatchEvent(new CustomEvent('botarena-select', { detail: { botId: bot.id } }));
      return;
    }
    if (!currentFloor) {
      const slabs = [];
      floorGroups.forEach((g) => slabs.push(g));
      const flHits = ray.intersectObjects(slabs, true);
      if (flHits.length) {
        let obj = flHits[0].object;
        while (obj && !obj.userData.floorId) obj = obj.parent;
        if (obj?.userData.floorId) goFloor(obj.userData.floorId, false);
      }
    }
  }
  canvas.addEventListener('pointerdown', onPtrDown);
  canvas.addEventListener('pointerup', onPtrUp);

  function onHudFloor(e) { goFloor(e.detail?.floor, true); }
  function onHudSelect(e) {
    const id = e.detail?.botId;
    bots.forEach((x) => { x.selected = x.id === id; });
  }
  function onHudFly(e) { if (e.detail?.botId) flyToBot(e.detail.botId); }
  window.addEventListener('hud-floor', onHudFloor);
  window.addEventListener('hud-select-bot', onHudSelect);
  window.addEventListener('hud-fly-to-bot', onHudFly);

  if (host) {
    const back = host.querySelector('[data-act=back], .ba-back');
    if (back) back.addEventListener('click', (e) => { e.preventDefault(); goOverview(false); });
  }

  const statusByBot = new Map();
  const activityByBot = new Map();
  function normStatus(b) {
    const st = String((b && b.status) || 'idle').toLowerCase().replace(/[\s-]+/g, '_');
    if (st === 'working' || st === 'handing_off' || st === 'in_review' || st === 'busy' || st === 'typing') return st === 'busy' || st === 'typing' ? 'working' : st;
    // a786bda feed: working bots also carry activity / currentTask / startedAt.
    if (b && st !== 'blocked' && st !== 'idle' && st !== 'done') return st;
    if (b && st !== 'blocked' && (b.activity || b.currentTask || b.startedAt)) return 'working';
    return st || 'idle';
  }
  function isWorkingStatus(st) {
    return st === 'working' || st === 'handing_off' || st === 'in_review';
  }
  (data.bots || []).forEach((b) => {
    statusByBot.set(b.id, normStatus(b));
    activityByBot.set(b.id, b);
  });

  function sync(state, lastEvent) {
    if (state?.bots) {
      state.bots.forEach((b) => {
        statusByBot.set(b.id, normStatus(b));
        activityByBot.set(b.id, b);
        const bot = bots.find((x) => x.id === b.id);
        if (bot && b.room && b.room !== bot.room) {
          const d = desksByBot.get(b.id);
          const room = roomById[b.room];
          if (room) {
            bot.room = b.room;
            const dest = d && d.roomId === b.room ? d.world.clone() : roomWorld(room);
            dest.y += d && d.roomId === b.room ? 0 : 0.2;
            bot.home.copy(d && d.roomId === b.room ? d.world : dest);
          }
        }
      });
    }
    if (lastEvent) {
      if (lastEvent.type === 'blocked') holdAtBot(lastEvent.packetId, lastEvent.bot, true);
      else startMove(lastEvent);
    } else if (state?.packets) {
      state.packets.forEach((p) => {
        if (movers.find((m) => m.id === p.id && !m.done)) return;
        if (p.status === 'done') {
          if (!deliveredStacks.find((m) => m.userData.packetId === p.id)) {
            const mesh = getPacketMesh();
            mesh.userData.packetId = p.id;
            parkDelivered(mesh);
          }
        } else if (p.holder) holdAtBot(p.id, p.holder, p.status === 'blocked');
      });
    }
  }
  sync(data, null);

  const _proj = new THREE.Vector3();
  const _head = new THREE.Vector3();
  const _foot = new THREE.Vector3();
  function toScreen(v, w, h) {
    _proj.copy(v).project(camera);
    return {
      x: (_proj.x * 0.5 + 0.5) * w,
      y: (-_proj.y * 0.5 + 0.5) * h,
      z: _proj.z
    };
  }
  let lastBotAnchors = [];
  function publishAnchors() {
    const hud = window.BotArenaHUD;
    // CSS pixels (canvas client box), not device pixels.
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    if (hud?.setRoomAnchors) {
      const list = [];
      roomCenters.forEach((c, id) => {
        const p = toScreen(c, w, h);
        const room = roomById[id];
        const onFloor = !currentFloor || (room && room.floor === currentFloor);
        const visible = false; // room pills removed: HUD floor list and bot names label the scene
        list.push({ roomId: id, x: p.x, y: p.y, visible });
      });
      hud.setRoomAnchors(list);
    }
    // The HUD draws pixel name tags. x,y = above the head; footX,footY = just below the feet.
    const botsList = [];
    bots.forEach((bot) => {
      bot.root.updateWorldMatrix(true, false);
      const hgt = bot.spriteH || AGENT_H;
      const ax = bot.sprite ? bot.sprite.position.x : 0; // follows the tower-view shift
      _head.set(ax, hgt, 0);
      bot.root.localToWorld(_head);
      _foot.set(ax, 0, 0);
      bot.root.localToWorld(_foot);
      const head = toScreen(_head, w, h);
      const foot = toScreen(_foot, w, h);
      const room = roomById[bot.room];
      const onFloor = !currentFloor || (room && room.floor === currentFloor);
      const visible = onFloor && head.z < 1 && foot.z < 1
        && foot.x > -40 && foot.x < w + 40 && foot.y > -40 && foot.y < h + 40;
      botsList.push({ botId: bot.id, x: head.x, y: head.y, footX: foot.x, footY: foot.y, visible });
    });
    lastBotAnchors = botsList;
    window.dispatchEvent(new CustomEvent('botarena-bot-anchors', { detail: botsList }));
  }

  function setSize(w, h) {
    if (!w || !h) {
      const r = canvas.parentElement?.getBoundingClientRect();
      w = Math.max(1, Math.floor(r?.width || canvas.clientWidth || innerWidth));
      h = Math.max(1, Math.floor(r?.height || canvas.clientHeight || innerHeight));
    }
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    const ps = w / h < 0.85 ? 2 : PIXEL_SCALE; // phones: finer pixels so faces and desks read
    const pw = Math.max(1, Math.round(w / ps));
    const ph = Math.max(1, Math.round(h / ps));
    pixelRT.setSize(pw, ph);
    const pose = currentFloor ? floorPose(currentFloor) : overviewPose();
    if (camTween.active) {
      camTween.toP.copy(pose.pos);
      camTween.toT.copy(pose.target);
    } else {
      camera.position.copy(pose.pos);
      controls.target.copy(pose.target);
      camera.lookAt(controls.target);
    }
  }
  setSize();

  const clock = new THREE.Clock();
  let running = true;
  let readyResolve;
  const ready = new Promise((res) => { readyResolve = res; });
  let readyFrames = 0;
  let fps = 60, fpsAcc = 0, fpsN = 0, fpsSamples = [];

  function towerShiftX(x) {
    const L = SHELL_XL + SHELL_W * 0.24;
    const R = SHAFT_X - SHAFT_W / 2 - 0.35;
    if (x >= R) return 0;
    return L + (x - SHELL_XL) * (R - L) / (R - SHELL_XL) - x;
  }
  function tickBots(t, dt) {
    for (const r of railTiles) r.mesh.position.x = (((r.off + t * 0.06) % 1) - 0.5) * (r.len - 0.3);
    bots.forEach((bot) => {
      const st = statusByBot.get(bot.id) || 'idle';
      const working = isWorkingStatus(st);
      if (working && bot.home) {
        // Snap to the chair so typists don't linger in the aisle, then type facing the monitor.
        bot.root.position.x = bot.home.x;
        bot.root.position.z = bot.home.z;
        bot.root.position.y = bot.home.y + Math.sin(t * 2.2 + bot.phase) * 0.01;
        setBotSpriteFrame(bot, 'type', t);
        setBotFlip(bot, 1);
      } else if (bot.walk && st === 'idle') {
        bot.walk.ang += dt * 0.7;
        const u = Math.sin(bot.walk.ang) * 0.5 + 0.5;
        const tx = bot.walk.x0 + (bot.walk.x1 - bot.walk.x0) * u;
        const tz = bot.walk.z;
        const vx = tx - bot.root.position.x;
        bot.root.position.x = THREE.MathUtils.damp(bot.root.position.x, tx, 3, dt);
        bot.root.position.z = THREE.MathUtils.damp(bot.root.position.z, tz, 3, dt);
        bot.root.position.y = bot.home.y + Math.sin(t * 8 + bot.phase) * 0.03;
        if (Math.abs(vx) > 0.02) bot.flip = vx > 0 ? 1 : -1;
        setBotSpriteFrame(bot, 'walk', t);
        setBotFlip(bot, bot.flip);
      } else {
        const stand = bot.guard || bot.aisle || bot.home;
        bot.root.position.x = THREE.MathUtils.damp(bot.root.position.x, stand.x, 4, dt);
        bot.root.position.z = THREE.MathUtils.damp(bot.root.position.z, stand.z, 4, dt);
        bot.root.position.y = stand.y;
        setBotSpriteFrame(bot, 'stand', t);
        setBotFlip(bot, 1);
      }
      // Tower view: squeeze agents right of the HUD floor labels on the left of the shell.
      const tOff = (!currentFloor && !bot.isCeo) ? towerShiftX(bot.root.position.x) : 0;
      bot.root.children.forEach((c) => { c.position.x = tOff; });
      if (st === 'blocked') {
        bot.ring.material.color.set(ALERT_RED);
        bot.ring.material.opacity = 0.4 + Math.abs(Math.sin(t * 5)) * 0.55;
        bot.ring.scale.setScalar(1 + Math.abs(Math.sin(t * 5)) * 0.25);
      } else if (bot.isCeo) {
        bot.ring.material.color.set(GREEN);
        bot.ring.material.opacity = 0.35 + Math.abs(Math.sin(t * 1.6)) * 0.2;
        bot.ring.scale.setScalar(1.05 + Math.abs(Math.sin(t * 1.6)) * 0.12);
        if (bot.glowLight) bot.glowLight.intensity = 1.0 + Math.abs(Math.sin(t * 1.6)) * 0.35;
        if (bot.glyphs) {
          bot.glyphs.forEach((g) => {
            const u = ((t * g.userData.speed + g.userData.phase) % 1 + 1) % 1;
            const a = g.userData.phase * Math.PI * 2 + t * g.userData.spin;
            g.position.set(
              Math.cos(a) * g.userData.r,
              0.2 + (1 - u) * (bot.spriteH + 0.8), // falls from above the head to the platform
              Math.sin(a) * g.userData.r
            );
            g.material.opacity = 0.95 * (1 - u) * Math.sin(u * Math.PI);
            g.quaternion.copy(camera.quaternion);
          });
        }
      } else {
        bot.ring.material.opacity = bot.selected ? 0.4 : 0;
        bot.ring.material.color.set(bot.selected ? GREEN : ALERT_RED);
      }
    });
    deskScreens.forEach((mons, i) => {
      mons.forEach((m, k) => paintScreen(m, (i + k) % 3 === 1 ? 'bars' : 'code', t + i * 0.3 + k));
    });
    screens.forEach((s, i) => {
      const st = statusByBot.get(s.botId) || 'idle';
      const mode = st === 'blocked' ? 'blocked' : (st === 'working' || st === 'handing_off') ? (i % 3 === 1 ? 'bars' : 'code') : 'code';
      s.mons.forEach((m, k) => {
        paintScreen(m, k === 0 ? mode : 'code', t + k);
      });
    });
    beams.forEach((b, i) => { b.material.opacity = 0.08 + Math.abs(Math.sin(t * 3 + i)) * 0.14; });
  }

  function onResize() { setSize(); }
  window.addEventListener('resize', onResize);

  function tick() {
    if (!running) return;
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    applyTween();
    if (!camTween.active && allowOrbitUpdate) controls.update();
    tickLabels();
    rain.update(dt);
    tickBots(t, dt);
    tickMovers(dt, t);
    leds.forEach((led, i) => {
      const on = Math.sin(t * 9 + i * 1.7) > 0.15;
      if (led.material && led.material.emissiveIntensity !== undefined) {
        led.material.emissiveIntensity = on ? 1.35 : 0.08;
      }
    });
    renderer.setRenderTarget(pixelRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(blitScene, blitCam);
    publishAnchors();
    fpsN++; fpsAcc += dt;
    if (fpsAcc >= 0.25) {
      fps = fpsN / fpsAcc;
      fpsSamples.push(fps);
      if (fpsSamples.length > 20) fpsSamples.shift();
      fpsN = 0; fpsAcc = 0;
      if (options.onFps) options.onFps(fps);
    }
    if (readyFrames < 3) {
      readyFrames++;
      if (readyFrames === 3 && readyResolve) { readyResolve(); readyResolve = null; }
    }
  }
  tick();

  function sampleLuma() {
    const gl = renderer.getContext();
    const w = 48, h = 48;
    const x = Math.max(0, Math.floor(gl.drawingBufferWidth / 2 - w / 2));
    const y = Math.max(0, Math.floor(gl.drawingBufferHeight / 2 - h / 2));
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let sum = 0, a = 0;
    for (let i = 0; i < buf.length; i += 4) {
      sum += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
      a += buf[i + 3];
    }
    return { luma: sum / (w * h), alpha: a / (w * h) };
  }

  const api = {
    ready,
    sync,
    applySnapshot: (s) => sync(s, null),
    applyEvent: (ev) => sync(null, ev),
    overview: () => goOverview(true),
    gotoFloor: (id) => goFloor(id, true),
    floor: (id) => goFloor(id, true),
    flyToBot,
    getFPS: () => fps,
    getAvgFPS: () => (fpsSamples.length ? fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length : fps),
    sampleLuma,
    currentFloor: () => currentFloor,
    getBotAnchors: () => lastBotAnchors,
    setSize,
    dispose() {
      running = false;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('hud-floor', onHudFloor);
      window.removeEventListener('hud-select-bot', onHudSelect);
      window.removeEventListener('hud-fly-to-bot', onHudFly);
      canvas.removeEventListener('pointerdown', onPtrDown);
      canvas.removeEventListener('pointerup', onPtrUp);
      if (window.BotArena === api || window.BotArena === publicApi) delete window.BotArena;
      controls.dispose();
      pixelRT.dispose();
      blitMat.dispose();
      renderer.dispose();
    }
  };

  // HUD 81f02ce calls overview() and gotoFloor(id). Also expose floor(1-4|'hq').
  function applyBotStatuses(map) {
    if (!map) return;
    Object.entries(map).forEach(([id, st]) => {
      if (!id || st == null) return;
      statusByBot.set(id, normStatus({ id, status: st }));
    });
  }
  api.applyBotStatuses = applyBotStatuses;

  const publicApi = {
    overview: () => api.overview(),
    gotoFloor: (id) => api.gotoFloor(id),
    floor: (id) => api.floor(id),
    flyToBot: (id) => api.flyToBot(id),
    getBotAnchors: () => api.getBotAnchors(),
    applyBotStatuses
  };
  window.BotArena = publicApi;

  return api;
}
