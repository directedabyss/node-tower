// React wrapper: mounts the vanilla HUD once and feeds it from useFeed() state and events.
import { useEffect, useRef } from 'react';
import { mountHUD } from './hud.js';
import './hud.css';

const fmtDue = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
};

// Feed snapshot -> HUD model
export function toHudModel(s, delivered = 0) {
  const roomFloor = Object.fromEntries(s.rooms.map((r) => [r.id, r.floor]));
  return {
    delivered, ceo: s.bots.find((b) => b.role === 'ceo')?.id || null,
    floors: [...s.floors].sort((a, b) => b.level - a.level).map((f) => ({
      id: f.id, name: f.name, short: f.penthouse ? 'HQ' : String(f.level).padStart(2, '0'),
      code: f.penthouse ? 'HQ' : 'F' + f.level,
      // title-bar / tower-label text, e.g. 'F2 CONTENT', 'HQ PENTHOUSE'
      label: f.penthouse ? 'HQ PENTHOUSE' : 'F' + f.level + ' ' + String(f.name).toUpperCase(),
      sub: f.penthouse ? 'PENTHOUSE' : String(f.name).toUpperCase()
    })),
    rooms: s.rooms.map((r) => ({ id: r.id, floor: r.floor, name: r.kind === 'department' || r.name.length <= 3 ? r.name : r.name.charAt(0) + r.name.slice(1).toLowerCase() })),
    bots: s.bots.map((b) => {
      const blk = b.blockers?.[0];
      return {
        id: b.id, name: b.name, role: b.role, department: b.department,
        // tool chip + RUN timer: feed sends activity (e.g. WEB_SEARCH) and startedAt for working bots
        tool: b.status === 'working' || b.status === 'handing_off' ? (b.activity || b.tool || '') : '',
        runStartedAt: b.status === 'working' || b.status === 'handing_off' ? (b.startedAt || b.runStartedAt || null) : null,
        floor: roomFloor[b.room], room: b.room, business: b.business,
        status: b.status === 'handing_off' ? 'working' : b.status,
        task: b.currentTask?.title || 'No active task',
        due: fmtDue(b.currentTask?.deadline),
        blocker: blk?.text || '',
        waitingOnOwner: b.status === 'blocked' && /owner/i.test(blk?.text || '')
      };
    })
  };
}

// Feed event -> HUD packet
export function toHudPacket(ev, s) {
  if (!ev) return null;
  const blocked = ev.type === 'blocked';
  return {
    type: 'handoff', kind: ev.type, id: ev.id, at: ev.at,
    from: blocked ? ev.bot : ev.fromBot, to: blocked ? '' : ev.toBot || '',
    fromRoom: blocked ? ev.room : ev.fromRoom, toRoom: blocked ? '' : ev.toRoom,
    task: ev.task?.title || 'Task', business: ev.task?.business,
    status: blocked ? 'blocked' : ev.type === 'done' ? 'delivered' : 'moving',
    inFlight: s ? s.packets.filter((p) => p.status !== 'done').length : undefined
  };
}

export default function HUD({ state, lastEvent }) {
  const hud = useRef(null);
  const delivered = useRef(null);
  useEffect(() => {
    if (!state || hud.current) return;
    delivered.current = (state.packets || []).filter((p) => p.status === 'done').length;
    hud.current = mountHUD(toHudModel(state, delivered.current), { synthetic: state.synthetic !== false });
    (state.events || []).slice(-8).forEach((ev) => hud.current.ingest(toHudPacket(ev, state)));
    // Demo/QA params: ?floor=f1 ?bot=sentry ?focus=quill (&zoom) ?trail ?wait ?bots ?rm
    const q = new URLSearchParams(location.search);
    if (q.get('floor')) hud.current.setFloor(q.get('floor'));
    if (q.get('bot')) hud.current.openBot(q.get('bot'));
    if (q.get('focus')) hud.current.focusBot(q.get('focus'), q.has('zoom'));
    if (q.has('bots')) hud.current.showBots(true);
    if (q.has('trail')) document.querySelector('.bah-trail')?.classList.add('open');
    if (q.has('wait')) document.querySelector('.bah-wait')?.classList.add('open');
    return undefined;
  }, [state]);
  useEffect(() => () => { hud.current?.destroy(); hud.current = null; }, []);
  useEffect(() => {
    if (!hud.current || !lastEvent) return;
    if (lastEvent.type === 'done') delivered.current += 1; // HQ counter: products delivered to the penthouse
    hud.current.ingest(toHudPacket(lastEvent, state));
  }, [lastEvent]);
  useEffect(() => { if (hud.current && state) hud.current.load(toHudModel(state, delivered.current)); }, [state, lastEvent]);
  return null;
}
