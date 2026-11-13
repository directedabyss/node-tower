// 2D plate scene: mockup art (people and text removed) as full-bleed backgrounds,
// pixel sprite agents from public/sprites/agents.png drawn on top. Same API and events as createArena.
import goalConfig from '../config/goal.json';
const BASE = (import.meta.env?.BASE_URL || '/');
const RED = '#ff2a2a';
const GREEN = '#00ff41';
const CELL_W = 72, CELL_H = 120;
const FRAME_X = { type: 0, stand: 72, walk0: 144, walk1: 216, hold: 288, ceo: 360 };
const WIDE_MIN = 900;

// Slot coordinates are in plate pixels. seat = foot point of the seated (type) cell,
// guard = foot point of a standing agent, rail = walk path [x0, x1, y] just behind the token rail.
const PLATES = {
  room: {
    src: 'plates/f2-room.png', w: 864, h: 1152, agentH: 236,
    seats: [[150, 598], [190, 1118], [712, 1124], [770, 645]],
    guards: [[470, 1128], [700, 640], [330, 640], [330, 1135]],
    rail: [120, 760, 676]
  },
  floor: {
    src: 'plates/f2-floor.png', w: 1280, h: 720, agentH: 132,
    seats: [[640, 254], [971, 622], [633, 666], [271, 641], [243, 400], [127, 285]],
    guards: [[375, 330], [700, 520], [850, 520], [1150, 452], [412, 545], [588, 300]],
    rail: [540, 1060, 364]
  },
  tower: {
    src: 'plates/tower.png', w: 720, h: 1280, agentH: 76,
    // per floor: table top y (agents stand just behind it), click band [y0, y1]
    levels: {
      5: { band: [60, 292], ceo: [288, 286] },
      4: { band: [292, 525], top: 459, x0: 185, x1: 425 },
      3: { band: [525, 756], top: 690, x0: 185, x1: 425 },
      2: { band: [756, 988], top: 921, x0: 185, x1: 425 },
      1: { band: [988, 1222], top: 1152, x0: 185, x1: 425 }
    },
    table: [160, 440, 44], // x0, x1, height of the table front strip redrawn over agent feet
    goal: [140, 80, 320, 86] // x, y, w, h of the CEO's big goal screen on the penthouse wall
  }
};

function loadImg(src) {
  const im = new Image();
  im.decoding = 'async';
  im.src = BASE + src;
  return im;
}

export function createArena(canvas, data, options = {}) {
  const host = canvas.parentElement;
  const g = canvas.getContext('2d');
  canvas.style.imageRendering = 'pixelated';
  const imgs = {
    room: loadImg(PLATES.room.src),
    floor: loadImg(PLATES.floor.src),
    tower: loadImg(PLATES.tower.src),
    sheet: loadImg('sprites/agents.png')
  };
  const ok = (im) => im.complete && im.naturalWidth > 0;

  let floors = (data.floors || []).slice().sort((a, b) => a.level - b.level);
  let rooms = data.rooms || [];
  let roomById = Object.fromEntries(rooms.map((r) => [r.id, r]));
  let floorById = Object.fromEntries(floors.map((f) => [f.id, f]));
  const ceoId = (data.bots || []).find((b) => b.role === 'ceo')?.id || 'atlas';

  const bots = new Map(); // id -> { id, room, status, x, y, flip, phase, selected }
  function hashId(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
  function normStatus(b) {
    const st = String((b && b.status) || 'idle').toLowerCase().replace(/[\s-]+/g, '_');
    if (st === 'busy' || st === 'typing') return 'working';
    if (st === 'working' || st === 'handing_off' || st === 'in_review' || st === 'blocked' || st === 'idle' || st === 'done') return st;
    if (b && (b.activity || b.currentTask || b.startedAt)) return 'working';
    return st || 'idle';
  }
  const isWorking = (st) => st === 'working' || st === 'handing_off' || st === 'in_review';
  function upsert(list) {
    (list || []).forEach((b) => {
      let bot = bots.get(b.id);
      if (!bot) {
        bot = { id: b.id, phase: (hashId(b.id) % 100) / 100, x: null, y: null, flip: 1 };
        bots.set(b.id, bot);
      }
      bot.room = b.room || bot.room;
      bot.status = normStatus(b);
      bot.isCeo = b.id === ceoId || b.role === 'ceo';
    });
  }
  upsert(data.bots);
  // Goal screen: target and progress. Default comes from src/config/goal.json (a manual value);
  // setGoal() or a snapshot 'goal' field can override it later.
  let goal = { target: 100000, current: 0, basis: '', source: 'manual' };
  function setGoal(gl) {
    if (!gl) return;
    const target = Number(gl.target) > 0 ? Number(gl.target) : goal.target;
    const current = Number.isFinite(Number(gl.current)) ? Math.max(0, Number(gl.current)) : goal.current;
    const basis = typeof gl.basis === 'string' ? gl.basis.trim() : goal.basis;
    const source = ['manual', 'example', 'live'].includes(gl.source) ? gl.source : goal.source;
    goal = { target, current, basis, source };
  }
  setGoal({ ...goalConfig, source: 'manual' });
  setGoal(data.goal);
  const floorOfBot = (bot) => roomById[bot.room]?.floor || null;

  function resolveFloorId(id) {
    if (id == null || id === '' || id === 'tower' || id === 'overview') return null;
    if (typeof id === 'number' || /^[1-4]$/.test(String(id))) {
      const n = +id;
      const f = floors.find((x) => x.level === n && !x.penthouse) || floors.find((x) => x.level === n);
      return f ? f.id : null;
    }
    const s = String(id).toLowerCase();
    if (s === 'hq' || s === 'penthouse' || s === 'f5') return 'hq';
    return floorById[id] ? id : id;
  }

  let currentFloor = null;
  let fade = 1; // 0..1 crossfade in after a view change
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || /[?&]rm\b/.test(location.search);

  let W = 1, H = 1, dpr = 1;
  function setSize() {
    const r = host?.getBoundingClientRect();
    W = Math.max(1, Math.floor(r?.width || canvas.clientWidth || innerWidth));
    H = Math.max(1, Math.floor(r?.height || canvas.clientHeight || innerHeight));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  setSize();

  function plateKey() {
    if (!currentFloor) return 'tower';
    return W >= WIDE_MIN ? 'floor' : 'room';
  }
  // Plate -> screen transform for the current view (CSS px).
  function layout(key) {
    const P = PLATES[key];
    if (key === 'tower') {
      const narrow = W < WIDE_MIN;
      const top = narrow ? 104 : 64, bot = narrow ? 140 : 70;
      const availH = Math.max(100, H - top - bot);
      const s = Math.min(availH / P.h, (narrow ? 0.74 : 0.5) * W / P.w);
      const cx = narrow ? W * 0.6 : W * 0.5;
      return { s, ox: cx - (P.w * s) / 2, oy: top + (availH - P.h * s) / 2 };
    }
    if (key === 'room') {
      // Fill from under the top bar down to above BACK + the task card, so the last
      // row of agents and their tags stay clear of both.
      const top = 60, bot = 264;
      const s = Math.max(W / P.w, (H - top - bot) / P.h);
      return { s, ox: (W - P.w * s) / 2, oy: top };
    }
    // Wide floor: contain the plate in the HUD-safe centre, clear of the side panels.
    const left = 256, right = 360, top = 78, bot = 80;
    const availW = Math.max(100, W - left - right);
    const availH = Math.max(100, H - top - bot);
    const s = Math.min(availW / P.w, availH / P.h);
    return { s, ox: left + (availW - P.w * s) / 2, oy: top + (availH - P.h * s) / 2 };
  }

  // ---- slot assignment for the current floor ----
  function floorBots(fid) {
    return [...bots.values()].filter((b) => floorOfBot(b) === fid).sort((a, b) => a.id.localeCompare(b.id));
  }
  function assign(key, t) {
    const P = PLATES[key];
    const out = new Map(); // id -> { x, y, pose, flip, phone }
    if (key === 'tower') {
      floors.forEach((f) => {
        const L = P.levels[f.level];
        if (!L) return;
        const list = floorBots(f.id);
        if (f.penthouse || L.ceo) {
          list.forEach((b, i) => {
            out.set(b.id, { x: L.ceo[0] + (b.isCeo ? 0 : (i % 2 ? 90 : -90)), y: L.ceo[1], pose: b.isCeo ? 'ceo' : 'stand', flip: 1, scale: b.isCeo ? 1.6 : 1 });
          });
          return;
        }
        const n = list.length;
        list.forEach((b, i) => {
          const x = n === 1 ? (L.x0 + L.x1) / 2 : L.x0 + (L.x1 - L.x0) * (i / (n - 1));
          out.set(b.id, { x, y: L.top + 8, pose: b.isCeo ? 'ceo' : (isWorking(b.status) ? 'hold' : 'stand'), flip: 1, scale: 1, behind: true });
        });
      });
      return out;
    }
    const list = floorBots(currentFloor);
    const working = list.filter((b) => isWorking(b.status) && !b.isCeo);
    const rest = list.filter((b) => !working.includes(b));
    let walker = rest.find((b) => !b.isCeo && b.status !== 'blocked');
    if (!walker && working.length > P.seats.length) walker = working[working.length - 1];
    if (!walker && list.length > 1) walker = working.length > 1 ? working[working.length - 1] : null;
    let si = 0, gi = 0;
    working.forEach((b) => {
      if (b === walker) return;
      if (si < P.seats.length) { const [x, y] = P.seats[si++]; out.set(b.id, { x, y, pose: 'type', flip: 1, scale: 1 }); }
      else { const [x, y] = P.guards[gi++ % P.guards.length]; out.set(b.id, { x, y, pose: 'stand', flip: 1, scale: 1 }); }
    });
    rest.forEach((b) => {
      if (b === walker) return;
      const [x, y] = P.guards[gi++ % P.guards.length];
      out.set(b.id, { x, y, pose: b.isCeo ? 'ceo' : 'stand', flip: (x > P.w / 2 ? -1 : 1), scale: b.isCeo ? 1.15 : 1 });
    });
    if (walker) {
      const [x0, x1, y] = P.rail;
      const per = 9; // seconds for one lap
      const u = reduced() ? 0.5 : ((t / per) % 1);
      const fwd = u < 0.5;
      const k = fwd ? u * 2 : (1 - u) * 2;
      const ease = k * k * (3 - 2 * k);
      out.set(walker.id, {
        x: x0 + (x1 - x0) * ease, y, pose: reduced() ? 'hold' : 'walk', flip: fwd ? 1 : -1, scale: 1, phone: true
      });
    }
    return out;
  }

  function drawFrame(frame, sx, sy, h, flip, t, phase) {
    const sheet = imgs.sheet;
    if (!ok(sheet)) return;
    const w = h * (CELL_W / CELL_H);
    let fx = FRAME_X[frame] ?? FRAME_X.stand;
    g.save();
    g.translate(Math.round(sx), Math.round(sy));
    if (flip < 0) g.scale(-1, 1);
    g.drawImage(sheet, fx, 0, CELL_W, CELL_H, Math.round(-w / 2), Math.round(-h), Math.round(w), Math.round(h));
    g.restore();
  }

  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const pctText = (p) => (Math.round(p * 1000) / 10).toString() + '%';
  function drawGoal(P, L, t) {
    const [gx, gy, gw, gh] = P.goal;
    const x = L.ox + gx * L.s, y = L.oy + gy * L.s, w = gw * L.s, h = gh * L.s, u = L.s;
    const pct = Math.max(0, Math.min(1, goal.current / goal.target));
    g.save();
    // bezel, screen and soft glow
    g.fillStyle = '#0a0d0b';
    g.fillRect(Math.round(x - 5 * u), Math.round(y - 5 * u), Math.round(w + 10 * u), Math.round(h + 10 * u));
    g.fillStyle = '#020a04';
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    g.strokeStyle = GREEN;
    g.globalAlpha = fade * (reduced() ? 0.8 : 0.65 + 0.2 * Math.sin(t * 1.4));
    g.lineWidth = Math.max(1, 2 * u);
    g.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
    g.globalAlpha = fade;
    // scanlines
    g.fillStyle = 'rgba(0,255,65,0.05)';
    for (let yy = 0; yy < h; yy += Math.max(2, 4 * u)) g.fillRect(Math.round(x), Math.round(y + yy), Math.round(w), 1);
    const pad = 12 * u;
    const mono = (px) => `bold ${Math.max(6, Math.round(px * u))}px ui-monospace, Menlo, monospace`;
    // shrink a font until the text fits maxW
    const fit = (txt, px, maxW) => { let f = px; g.font = mono(f); while (f > 8 && g.measureText(txt).width > maxW) { f -= 1; g.font = mono(f); } };
    // ellipsize text that still doesn't fit at the smallest font
    const clip = (txt, maxW) => { let t2 = txt; while (t2.length > 4 && g.measureText(t2).width > maxW) t2 = t2.slice(0, -2) + '.'; return t2; };
    g.textBaseline = 'alphabetic';
    // row 1: target on the left, data source (and basis) on the right
    const leftTxt = 'GOAL'; // the target is already in the main line, so leave room for the source and basis
    g.font = mono(13);
    g.textAlign = 'left';
    g.fillStyle = GREEN;
    g.fillText(leftTxt, x + pad, y + 20 * u);
    let right = goal.source === 'manual' ? 'MANUAL VALUE' : goal.source === 'example' ? 'EXAMPLE DATA' : '';
    if (right && goal.basis) right += ' - ' + goal.basis.toUpperCase();
    if (right) {
      const room = w - pad * 2 - g.measureText(leftTxt).width - 10 * u;
      fit(right, 13, room);
      right = clip(right, room);
      g.textAlign = 'right';
      g.fillStyle = goal.source === 'example' ? RED : GREEN;
      g.globalAlpha = fade * (goal.source === 'example' ? 1 : 0.75);
      g.fillText(right, x + w - pad, y + 20 * u);
      g.globalAlpha = fade;
      g.fillStyle = GREEN;
    }
    // row 2: $12,500 / $100,000 (12.5%)
    g.textAlign = 'center';
    const main = money(goal.current) + ' / ' + money(goal.target) + ' (' + pctText(pct) + ')';
    fit(main, 24, w - pad * 2);
    g.fillText(main, x + w / 2, y + 47 * u);
    // row 3: progress bar, capped at 100%
    const bx = x + pad, by = y + 56 * u, bw = w - pad * 2, bh = 16 * u;
    g.fillStyle = '#0c2a14';
    g.fillRect(Math.round(bx), Math.round(by), Math.round(bw), Math.round(bh));
    g.fillStyle = GREEN;
    g.fillRect(Math.round(bx), Math.round(by), Math.round(bw * pct), Math.round(bh));
    if (!reduced() && pct > 0 && pct < 1) {
      g.globalAlpha = fade * (0.4 + 0.4 * Math.abs(Math.sin(t * 3)));
      g.fillStyle = '#c8ffd6';
      g.fillRect(Math.round(bx + bw * pct - 2 * u), Math.round(by), Math.max(1, Math.round(2 * u)), Math.round(bh));
      g.globalAlpha = fade;
    }
    g.strokeStyle = GREEN;
    g.lineWidth = 1;
    g.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5, Math.round(bw) - 1, Math.round(bh) - 1);
    g.restore();
  }

  let lastAnchors = [];
  let lastLayout = null;
  let lastBands = [];
  let lastSlots = new Map();
  function render(t) {
    const key = plateKey();
    const P = PLATES[key];
    const L = layout(key);
    lastLayout = { key, ...L };
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;
    g.globalAlpha = fade;
    const im = imgs[key];
    const pw = P.w * L.s, ph = P.h * L.s;
    if (ok(im)) {
      g.drawImage(im, 0, 0, P.w, P.h, Math.round(L.ox), Math.round(L.oy), Math.round(pw), Math.round(ph));
      if (key === 'room') {
        // Continue the floor under the task card: mirror the bottom strip, dimmed.
        const below = H - (L.oy + ph);
        if (below > 0) {
          const strip = Math.min(P.h, below / L.s);
          g.save();
          g.translate(0, Math.round(L.oy + ph) * 2);
          g.scale(1, -1);
          g.drawImage(im, 0, P.h - strip, P.w, strip, Math.round(L.ox), Math.round(L.oy + ph - strip * L.s), Math.round(pw), Math.round(strip * L.s));
          g.restore();
          g.fillStyle = 'rgba(0,0,0,0.45)';
          g.fillRect(0, Math.round(L.oy + ph), W, below + 1);
        }
        if (L.oy > 0) { g.fillStyle = '#020403'; g.fillRect(0, 0, W, Math.ceil(L.oy)); }
      }
    }
    if (key === 'tower' && ok(im)) drawGoal(P, L, t);
    const slots = assign(key, t);
    lastSlots = slots;
    const order = [...slots.entries()].sort((a, b) => a[1].y - b[1].y);
    const anchors = [];
    for (const [id, sl] of order) {
      const bot = bots.get(id);
      if (!bot) continue;
      const tx = L.ox + sl.x * L.s, ty = L.oy + sl.y * L.s;
      // ease toward the slot so status changes glide instead of snapping
      if (bot.x == null || bot.key !== key || reduced()) { bot.x = tx; bot.y = ty; }
      else if (sl.pose === 'walk') { bot.x = tx; bot.y = ty; }
      else { bot.x += (tx - bot.x) * 0.18; bot.y += (ty - bot.y) * 0.18; }
      bot.key = key;
      const h = P.agentH * L.s * (sl.scale || 1);
      let frame = sl.pose;
      if (frame === 'walk') frame = Math.floor(t * 4 + bot.phase * 2) % 2 ? 'walk1' : 'walk0';
      const bounce = (sl.pose === 'type' && !reduced()) ? Math.round(Math.sin(t * 9 + bot.phase * 6) * 0.6) : 0;
      // floor marks under the feet: red pulse when blocked, green for the CEO or the selected bot
      if (bot.status === 'blocked' || bot.isCeo || bot.selected) {
        const pulse = reduced() ? 0.7 : 0.5 + Math.abs(Math.sin(t * (bot.status === 'blocked' ? 5 : 1.6))) * 0.5;
        g.save();
        g.globalAlpha = fade * (bot.status === 'blocked' ? 0.55 : 0.35) * pulse + 0.1;
        g.fillStyle = bot.status === 'blocked' ? RED : GREEN;
        g.beginPath();
        g.ellipse(bot.x, bot.y - h * 0.01, h * 0.24, h * 0.06, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      drawFrame(frame, bot.x, bot.y + bounce, h, sl.flip, t, bot.phase);
      if (sl.phone && sl.pose === 'walk') {
        // small green handset in the front hand
        const pxs = h / CELL_H;
        const hx = bot.x + sl.flip * 17 * pxs, hy = bot.y - 46 * pxs;
        g.fillStyle = '#0b2a12';
        g.fillRect(Math.round(hx - 4 * pxs), Math.round(hy - 7 * pxs), Math.round(9 * pxs), Math.round(14 * pxs));
        g.fillStyle = GREEN;
        g.fillRect(Math.round(hx - 3 * pxs), Math.round(hy - 6 * pxs), Math.round(7 * pxs), Math.round(10 * pxs));
      }
      // head anchor: top of the drawn cell (seated cell already includes the chair, so this sits above the head)
      const headY = bot.y - h * (sl.pose === 'type' ? 0.97 : 1.0);
      // Tower agents stand behind the desk front; put the foot anchor just below that strip so tags clear it.
      let footY = bot.y;
      if (key === 'tower' && sl.behind) {
        const th = P.table[2];
        footY = bot.y + (th - 8) * L.s + 2;
      }
      const visible = bot.x > -40 && bot.x < W + 40 && bot.y > -40 && bot.y < H + 40;
      anchors.push({ botId: id, x: bot.x, y: headY, footX: bot.x, footY, visible });
    }
    if (key === 'tower' && ok(im)) {
      // redraw the table fronts over the agents' feet so they stand behind the tables, as in the mockup
      const [x0, x1, th] = P.table;
      floors.forEach((f) => {
        const lv = P.levels[f.level];
        if (!lv || lv.top == null) return;
        g.drawImage(im, x0, lv.top, x1 - x0, th, Math.round(L.ox + x0 * L.s), Math.round(L.oy + lv.top * L.s), Math.round((x1 - x0) * L.s), Math.round(th * L.s));
      });
    }
    g.globalAlpha = 1;
    // bots not on this view still get an entry, hidden
    bots.forEach((b) => { if (!slots.has(b.id)) anchors.push({ botId: b.id, x: -999, y: -999, footX: -999, footY: -999, visible: false }); });
    lastAnchors = anchors;
    lastBands = [];
    if (key === 'tower') {
      lastBands = floors.map((f) => {
        const lv = P.levels[f.level];
        if (!lv) return null;
        return { floor: f.id, y0: L.oy + lv.band[0] * L.s, y1: L.oy + lv.band[1] * L.s };
      }).filter(Boolean);
    }
    const hud = window.BotArenaHUD;
    if (hud?.setRoomAnchors) hud.setRoomAnchors(rooms.map((r) => ({ roomId: r.id, x: -999, y: -999, visible: false })));
    window.dispatchEvent(new CustomEvent('botarena-bot-anchors', { detail: anchors }));
  }

  function applyView() {
    fade = reduced() ? 1 : 0.15;
    if (host) host.classList.toggle('is-floor', !!currentFloor);
    bots.forEach((b) => { b.x = null; });
  }
  function goOverview(fromHud) {
    currentFloor = null;
    applyView();
    if (!fromHud) window.dispatchEvent(new CustomEvent('botarena-floor', { detail: { floor: null } }));
  }
  function goFloor(id, fromHud) {
    const fid = resolveFloorId(id);
    if (!fid) return goOverview(fromHud);
    if (fid !== currentFloor) { currentFloor = fid; applyView(); }
    if (!fromHud) window.dispatchEvent(new CustomEvent('botarena-floor', { detail: { floor: fid } }));
  }
  function flyToBot(id) {
    const b = bots.get(id);
    if (!b) return;
    bots.forEach((x) => { x.selected = x.id === id; });
    const fid = floorOfBot(b);
    if (fid && fid !== currentFloor) { currentFloor = fid; applyView(); }
  }

  // ---- input ----
  let down = null;
  function onPtrDown(e) { down = { x: e.clientX, y: e.clientY }; }
  function onPtrUp(e) {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    down = null;
    if (dx * dx + dy * dy > 16) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    // bots first (front-most wins)
    let hit = null, hitY = -1;
    lastAnchors.forEach((a) => {
      if (!a.visible) return;
      const hw = Math.max(14, (a.footY - a.y) * 0.3);
      if (mx > a.footX - hw && mx < a.footX + hw && my > a.y && my < a.footY && a.footY > hitY) { hit = a; hitY = a.footY; }
    });
    if (hit) { window.dispatchEvent(new CustomEvent('botarena-select', { detail: { botId: hit.botId } })); return; }
    if (!currentFloor && lastLayout?.key === 'tower') {
      const P = PLATES.tower, L = lastLayout;
      const px = (mx - L.ox) / L.s, py = (my - L.oy) / L.s;
      if (px >= 0 && px <= P.w) {
        for (const f of floors) {
          const lv = P.levels[f.level];
          if (lv && py >= lv.band[0] && py < lv.band[1]) { goFloor(f.id, false); return; }
        }
      }
    }
    window.dispatchEvent(new CustomEvent('botarena-select', { detail: { botId: null } }));
  }
  canvas.addEventListener('pointerdown', onPtrDown);
  canvas.addEventListener('pointerup', onPtrUp);

  function onHudFloor(e) { goFloor(e.detail?.floor, true); }
  function onHudSelect(e) { const id = e.detail?.botId; bots.forEach((x) => { x.selected = x.id === id; }); }
  function onHudFly(e) { if (e.detail?.botId) flyToBot(e.detail.botId); }
  window.addEventListener('hud-floor', onHudFloor);
  window.addEventListener('hud-select-bot', onHudSelect);
  window.addEventListener('hud-fly-to-bot', onHudFly);
  const back = host?.querySelector('[data-act=back], .ba-back');
  function onBack(e) { e.preventDefault(); goOverview(false); }
  if (back) back.addEventListener('click', onBack);

  function sync(state) {
    if (!state) return;
    if (state.floors) { floors = state.floors.slice().sort((a, b) => a.level - b.level); floorById = Object.fromEntries(floors.map((f) => [f.id, f])); }
    if (state.rooms) { rooms = state.rooms; roomById = Object.fromEntries(rooms.map((r) => [r.id, r])); }
    if (state.bots) upsert(state.bots);
    if (state.goal) setGoal(state.goal);
  }
  function onResize() { setSize(); }
  window.addEventListener('resize', onResize);

  let running = true;
  let readyResolve;
  const ready = new Promise((res) => { readyResolve = res; });
  let readyFrames = 0;
  let fps = 60, fpsAcc = 0, fpsN = 0;
  const fpsSamples = [];
  const t0 = performance.now();
  let prev = t0;
  function tick(now) {
    if (!running) return;
    requestAnimationFrame(tick);
    now = now || performance.now();
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    if (fade < 1) fade = Math.min(1, fade + dt * 3);
    render((now - t0) / 1000);
    fpsN++; fpsAcc += dt;
    if (fpsAcc >= 0.25) {
      fps = fpsN / fpsAcc; fpsSamples.push(fps); if (fpsSamples.length > 20) fpsSamples.shift();
      fpsN = 0; fpsAcc = 0;
      if (options.onFps) options.onFps(fps);
    }
    if (readyFrames < 3 && ok(imgs.sheet) && ok(imgs[plateKey()]) && ++readyFrames === 3 && readyResolve) { readyResolve(); readyResolve = null; }
  }
  requestAnimationFrame(tick);

  function sampleLuma() {
    const w = 48, h = 48;
    const d = g.getImageData(Math.max(0, canvas.width / 2 - 24), Math.max(0, canvas.height / 2 - 24), w, h).data;
    let sum = 0, a = 0;
    for (let i = 0; i < d.length; i += 4) { sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; a += d[i + 3]; }
    return { luma: sum / (w * h), alpha: a / (w * h) };
  }
  function applyBotStatuses(map) {
    if (!map) return;
    Object.entries(map).forEach(([id, st]) => { const b = bots.get(id); if (b && st != null) b.status = normStatus({ status: st }); });
  }

  const api = {
    ready,
    sync,
    applySnapshot: (s) => sync(s),
    applyEvent: () => {},
    overview: () => goOverview(true),
    gotoFloor: (id) => goFloor(id, true),
    floor: (id) => goFloor(id, true),
    flyToBot,
    getFPS: () => fps,
    getAvgFPS: () => (fpsSamples.length ? fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length : fps),
    sampleLuma,
    currentFloor: () => currentFloor,
    getBotAnchors: () => lastAnchors,
    getFloorBands: () => lastBands,
    applyBotStatuses,
    setGoal,
    getGoal: () => ({ ...goal }),
    setSize,
    dispose() {
      running = false;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('hud-floor', onHudFloor);
      window.removeEventListener('hud-select-bot', onHudSelect);
      window.removeEventListener('hud-fly-to-bot', onHudFly);
      canvas.removeEventListener('pointerdown', onPtrDown);
      canvas.removeEventListener('pointerup', onPtrUp);
      if (back) back.removeEventListener('click', onBack);
      if (window.BotArena === publicApi) delete window.BotArena;
    }
  };
  const publicApi = {
    overview: () => api.overview(),
    gotoFloor: (id) => api.gotoFloor(id),
    floor: (id) => api.floor(id),
    flyToBot: (id) => api.flyToBot(id),
    getBotAnchors: () => api.getBotAnchors(),
    getFloorBands: () => api.getFloorBands(),
    applyBotStatuses,
    setGoal,
    getGoal: () => ({ ...goal })
  };
  window.BotArena = publicApi;
  return api;
}
