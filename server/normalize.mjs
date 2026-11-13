// Shared normalizer. Every connector returns normalized tasks:
//   { id, owner, status: 'working' | 'blocked' | 'done', title, due: ISO string | null, blocker?: string }
// tasksToSnapshot() maps them onto the snapshot shape the app already consumes (schemaVersion 2).
import { SCHEMA_VERSION, FLOORS, ROOMS, WALKWAYS, LIFTS, BOTS, CEO_BOT_ID } from '../src/feed/mockData.js';
import { createFeed, route } from '../src/feed/mockFeed.js';

export const DONE_WORDS = ['done', 'closed', 'complete', 'completed', 'cancelled', 'canceled', 'archived', 'resolved', 'shipped'];
export const BLOCKED_WORDS = ['blocked', 'on hold', 'at risk', 'waiting', 'stuck', 'update required', 'needs input'];

export function normKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Free-text status -> working | blocked | done. Unknown or empty -> working.
export function normalizeStatus(raw) {
  const s = String(raw ?? '').toLowerCase().trim().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
  if (!s) return 'working';
  if (DONE_WORDS.includes(s) || DONE_WORDS.some((w) => s.split(' ').includes(w))) return 'done';
  if (BLOCKED_WORDS.includes(s) || BLOCKED_WORDS.some((w) => s.includes(w))) return 'blocked';
  return 'working';
}

// Accepts ISO strings, YYYY-MM-DD, or epoch milliseconds (number or digit string). Bad input -> null.
export function normalizeDue(raw) {
  if (raw == null || raw === '') return null;
  let ms;
  if (typeof raw === 'number' || /^\d{10,}$/.test(String(raw).trim())) ms = Number(raw);
  else ms = Date.parse(String(raw).trim());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function normalizeTask(raw, i = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title ?? raw.name ?? '').trim();
  if (!title) return null;
  const status = ['working', 'blocked', 'done'].includes(raw.status) ? raw.status : normalizeStatus(raw.status);
  const out = {
    id: String(raw.id ?? `task-${i + 1}`).slice(0, 200),
    owner: String(raw.owner ?? '').trim().slice(0, 200),
    status,
    title: title.slice(0, 300),
    due: normalizeDue(raw.due ?? raw.deadline ?? null)
  };
  if (raw.blocker) out.blocker = String(raw.blocker).slice(0, 300);
  return out;
}

export function normalizeTasks(list) {
  return (Array.isArray(list) ? list : []).map(normalizeTask).filter(Boolean);
}

const BOT_INDEX = new Map();
for (const b of BOTS) {
  BOT_INDEX.set(normKey(b.id), b);
  BOT_INDEX.set(normKey(b.name), b);
}

// Owner name or id -> roster bot (case and punctuation ignored), else null.
export function matchBot(owner) {
  if (!owner) return null;
  return BOT_INDEX.get(normKey(owner)) || null;
}

export function demoSnapshot(opts = {}) {
  return createFeed({ seed: opts.seed ?? 42, now: opts.now }).snapshot();
}

export function tasksToSnapshot(tasks, { now = () => Date.now() } = {}) {
  const generatedAt = new Date(now()).toISOString();
  const list = normalizeTasks(tasks);
  const bots = BOTS.map((b) => ({
    ...b,
    role: b.id === CEO_BOT_ID ? 'ceo' : 'agent',
    status: 'idle',
    currentTask: null,
    blockers: [],
    activity: null,
    startedAt: null
  }));
  const byId = Object.fromEntries(bots.map((b) => [b.id, b]));
  const packets = [];
  let unmatched = 0;

  for (const t of list) {
    if (t.status === 'done') continue;
    const owner = matchBot(t.owner);
    if (!owner) { unmatched++; continue; }
    const b = byId[owner.id];
    const task = { id: t.id, title: t.title, business: b.business || 'Internal', deadline: t.due };
    if (!b.currentTask) {
      if (t.status === 'blocked') {
        Object.assign(b, {
          status: 'blocked',
          currentTask: task,
          blockers: [{ id: `b-${t.id}`, text: t.blocker || 'Blocked', since: generatedAt }],
          activity: null,
          startedAt: null
        });
      } else {
        Object.assign(b, { status: 'working', currentTask: task, blockers: [], activity: 'FEED_READ', startedAt: generatedAt });
      }
    }
    packets.push({
      id: `p-${t.id}`,
      task,
      room: b.room,
      holder: b.id,
      status: t.status === 'blocked' ? 'blocked' : (b.room === 'review' ? 'in_review' : 'in_progress'),
      trail: [b.room]
    });
  }

  const snap = {
    schemaVersion: SCHEMA_VERSION,
    completedTaskIds: list.filter((t) => t.status === 'done').map((t) => t.id),
    synthetic: false,
    generatedAt,
    floors: FLOORS,
    rooms: ROOMS,
    walkways: WALKWAYS,
    lifts: LIFTS,
    bots,
    packets,
    events: []
  };
  Object.defineProperty(snap, 'stats', { value: { tasks: list.length, unmatched }, enumerable: false });
  return snap;
}

export function eventsFromDiff(prev, next, { now = () => Date.now() } = {}) {
  const evs = [];
  const prevP = new Map((prev && prev.packets || []).map((p) => [p.id, p]));
  const nextP = new Map((next && next.packets || []).map((p) => [p.id, p]));
  const at = new Date(now()).toISOString();
  let seq = 0;
  const wrap = (ev) => ({ id: `e-live-${next?.generatedAt || at}-${++seq}`, at, synthetic: false, ...ev });

  for (const [id, p] of nextP) {
    const o = prevP.get(id);
    if (!o) {
      evs.push(wrap({
        type: 'assign', packetId: id, fromBot: null, toBot: p.holder,
        fromRoom: p.room, toRoom: p.room, route: { via: 'desk', id: null, path: [] }, task: p.task
      }));
    } else if (o.holder !== p.holder) {
      evs.push(wrap({
        type: p.room === 'review' ? 'review' : 'handoff',
        packetId: id, fromBot: o.holder, toBot: p.holder,
        fromRoom: o.room, toRoom: p.room, route: route(o.room, p.room), task: p.task
      }));
    } else if (o.status !== 'blocked' && p.status === 'blocked') {
      const holder = (next.bots || []).find((b) => b.id === p.holder);
      evs.push(wrap({
        type: 'blocked', packetId: id, bot: p.holder, room: p.room,
        waitingOn: 'Owner', blocker: (holder && holder.blockers && holder.blockers[0]) || null, task: p.task
      }));
    }
  }
  for (const [id, p] of prevP) {
    if (!nextP.has(id) && (next.completedTaskIds || []).includes(String(p.task.id))) {
      evs.push(wrap({
        type: 'done', packetId: id, fromBot: p.holder, fromRoom: p.room, toRoom: 'hq',
        route: route(p.room || 'review', 'hq'), task: p.task
      }));
    }
  }
  return evs;
}
