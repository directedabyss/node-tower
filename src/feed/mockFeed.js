// Synthetic feed. Emits one event every intervalMs (default 2000).
// Same snapshot shape the live feed server serves (server/normalize.mjs).
import { SCHEMA_VERSION, FLOORS, ROOMS, WALKWAYS, LIFTS, BOTS, TASK_TITLES, TOOLS, HANDOFF_CHAINS, CEO_BOT_ID } from './mockData.js';

const roomById = Object.fromEntries(ROOMS.map((r) => [r.id, r]));
const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];
export function rng(seed = 42) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Route between rooms: walks the room chain in order, each hop is a walkway (same floor) or the lift.
// via = 'walk' | 'lift' | 'mixed' | 'desk' (same room); path = hop ids in order for the scene to animate.
export function route(fromRoom, toRoom) {
  if (fromRoom === toRoom) return { via: 'desk', id: null, path: [] };
  const a = roomById[fromRoom].order, b = roomById[toRoom].order, dir = b > a ? 1 : -1;
  const path = [];
  for (let o = a; o !== b; o += dir) {
    const x = ROOMS.find((r) => r.order === o).id, y = ROOMS.find((r) => r.order === o + dir).id;
    const [f, t] = dir > 0 ? [x, y] : [y, x];
    const walk = WALKWAYS.find((k) => k.from === f && k.to === t);
    const lift = LIFTS.find((l) => l.fromRoom === f && l.toRoom === t);
    path.push(walk ? { via: 'walk', id: walk.id } : { via: 'lift', id: lift.id });
  }
  const kinds = new Set(path.map((h) => h.via));
  return { via: kinds.size === 1 ? path[0].via : 'mixed', id: path.length === 1 ? path[0].id : null, path: path.map((h) => h.id) };
}

export function createFeed({ seed = 42, now = () => Date.now() } = {}) {
  const rnd = rng(seed);
  let seq = 0;
  const iso = (offsetMs = 0) => new Date(now() + offsetMs).toISOString();
  const newTask = (business) => ({ id: `t-${++seq}`, title: pick(TASK_TITLES, rnd), business, deadline: iso((1 + Math.floor(rnd() * 7)) * 86400000) });

  const state = {
    schemaVersion: SCHEMA_VERSION, synthetic: true, generatedAt: iso(),
    floors: FLOORS, rooms: ROOMS, walkways: WALKWAYS, lifts: LIFTS,
    bots: BOTS.map((b) => ({ ...b, role: b.id === CEO_BOT_ID ? 'ceo' : 'agent', status: 'idle', currentTask: null, blockers: [], activity: null, startedAt: null })),
    packets: [], events: []
  };
  const bot = (id) => state.bots.find((b) => b.id === id);
  // packet id -> { chain, step }; kept out of the snapshot so the API only shows tasks and handoffs
  const chainOf = new Map();
  // working bots carry tool + startedAt (ISO) for the working_ tag and RUN timer; others null
  const work = (b, extra = {}) => Object.assign(b, { status: 'working', blockers: [], activity: pick(TOOLS, rnd), startedAt: iso(), ...extra });
  const rest = (b, extra = {}) => Object.assign(b, { activity: null, startedAt: null, ...extra });
  const inRoom = (roomId) => state.bots.filter((b) => b.room === roomId);

  function emit(ev) {
    const full = { id: `e-${++seq}`, at: iso(), synthetic: true, ...ev };
    state.events = [...state.events, full].slice(-100);
    state.generatedAt = full.at;
    return full;
  }

  function step() {
    const active = state.packets.filter((p) => p.status !== 'done');
    const r = rnd();
    // assign: the CEO bot creates a packet in INTAKE and gives it to a Dev bot, when few are active
    if (active.length < 4 || r < 0.15) {
      const wf = pick(HANDOFF_CHAINS, rnd);
      const st = wf.stages[1], to = bot(st.bot);
      const task = newTask(wf.business);
      const packet = { id: `p-${seq}`, task, room: st.room, holder: to.id, status: 'in_progress', trail: [wf.stages[0].room, st.room] };
      chainOf.set(packet.id, { wf, step: 1 });
      state.packets.push(packet);
      work(to, { currentTask: task });
      return emit({ type: 'assign', packetId: packet.id, fromBot: wf.stages[0].bot, toBot: to.id, fromRoom: wf.stages[0].room, toRoom: st.room, route: route(wf.stages[0].room, st.room), task });
    }
    const p = pick(active, rnd);
    const holder = bot(p.holder);
    // blocked packets either stay blocked or resume
    if (p.status === 'blocked') {
      if (rnd() < 0.5) return step2Resume(p, holder);
    }
    if (p.status === 'blocked') return null;
    if (r < 0.25 && p.room !== 'review') {
      p.status = 'blocked';
      const blocker = { id: `b-${seq + 1}`, text: 'Waiting on Owner', since: iso() };
      rest(holder, { status: 'blocked', blockers: [blocker] });
      return emit({ type: 'blocked', packetId: p.id, bot: holder.id, room: p.room, waitingOn: 'Owner', blocker, task: p.task });
    }
    const c = chainOf.get(p.id);
    const nextStage = c.wf.stages[c.step + 1];
    c.step += 1;
    const fromRoom = p.room;
    if (!nextStage.bot) {
      Object.assign(p, { status: 'done', room: nextStage.room, holder: null });
      chainOf.delete(p.id);
      p.trail.push(nextStage.room);
      rest(holder, { status: 'idle', currentTask: null, blockers: [] });
      return emit({ type: 'done', packetId: p.id, fromBot: holder.id, fromRoom, toRoom: nextStage.room, route: route(fromRoom, nextStage.room), task: p.task });
    }
    const to = bot(nextStage.bot);
    const type = roomById[nextStage.room].kind === 'review' ? 'review' : 'handoff';
    rest(holder, { status: 'idle', currentTask: null, blockers: [] });
    work(to, { currentTask: p.task });
    Object.assign(p, { room: nextStage.room, holder: to.id, status: type === 'review' ? 'in_review' : 'in_progress' });
    p.trail.push(nextStage.room);
    return emit({ type, packetId: p.id, fromBot: holder.id, toBot: to.id, fromRoom, toRoom: nextStage.room, route: route(fromRoom, nextStage.room), task: p.task });
  }
  function step2Resume(p, holder) {
    p.status = 'in_progress';
    work(holder);
    return null; // resume is silent; the next event moves it on
  }
  function next() {
    let ev = null;
    for (let i = 0; i < 5 && !ev; i++) ev = step();
    state.packets = state.packets.filter((p) => p.status !== 'done').concat(state.packets.filter((p) => p.status === 'done').slice(-10));
    return ev;
  }
  const snapshot = () => JSON.parse(JSON.stringify(state));

  // Lived-in opening: at least two typists on Intake/Dev and two on Research/Review
  // so floor-01 and floor-04 aren't an empty aisle at boot (seed 42 alone often has 0-1).
  function prime() {
    const seats = [
      { id: 'nova', room: 'dev' },
      { id: 'orion', room: 'dev' },
      { id: 'iris', room: 'research' },
      { id: 'sentry', room: 'review' }
    ];
    seats.forEach((seat, i) => {
      const b = bot(seat.id);
      if (!b) return;
      const wf = HANDOFF_CHAINS.find((w) => w.stages.some((st) => st.bot === seat.id)) || HANDOFF_CHAINS[0];
      const stageIdx = Math.max(0, wf.stages.findIndex((st) => st.bot === seat.id));
      const task = newTask(wf.business);
      const packet = {
        id: `p-prime-${i}`,
        task,
        room: seat.room,
        holder: b.id,
        status: 'in_progress',
        trail: wf.stages.slice(0, stageIdx + 1).map((st) => st.room)
      };
      chainOf.set(packet.id, { wf, step: stageIdx });
      state.packets.push(packet);
      work(b, { currentTask: task, room: seat.room });
    });
  }
  prime();

  return { next, snapshot };
}

// Subscribe: onSnapshot once, then onEvent(ev, snapshot) every intervalMs. Returns stop().
export function subscribe({ onSnapshot, onEvent, intervalMs = 2000, seed = 42 }) {
  const feed = createFeed({ seed });
  onSnapshot && onSnapshot(feed.snapshot());
  const timer = setInterval(() => { const ev = feed.next(); onEvent && onEvent(ev, feed.snapshot()); }, intervalMs);
  return () => clearInterval(timer);
}
