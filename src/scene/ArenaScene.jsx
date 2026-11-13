import { useEffect, useRef } from 'react';
import { createArena } from './createPlates.js'; // 2D plate scene (3D rooms in createArena.js are no longer used)
import './scene.css';

export default function ArenaScene({ state, lastEvent }) {
  const wrap = useRef(null);
  const api = useRef(null);
  const lastEv = useRef(null);
  const queued = useRef({ floor: undefined, overview: false, bot: null });

  useEffect(() => {
    // Expose the HUD contract immediately so Tower / Back / ?floor= never race the canvas.
    const q = queued.current;
    const stub = {
      overview() { if (api.current) api.current.overview(); else q.overview = true; },
      gotoFloor(id) { if (api.current) api.current.gotoFloor(id); else q.floor = id; },
      floor(id) { this.gotoFloor(id); },
      flyToBot(id) { if (api.current) api.current.flyToBot(id); else q.bot = id; },
      getBotAnchors() { return api.current?.getBotAnchors?.() || []; }
    };
    window.BotArena = stub;
    return () => {
      api.current?.dispose();
      api.current = null;
      if (window.BotArena === stub) delete window.BotArena;
    };
  }, []);

  useEffect(() => {
    if (!state || api.current || !wrap.current) return;
    const canvas = wrap.current.querySelector('canvas');
    api.current = createArena(canvas, state);
    const q = queued.current;
    if (q.overview) api.current.overview();
    else if (q.floor !== undefined && q.floor !== null) api.current.gotoFloor(q.floor);
    if (q.bot) api.current.flyToBot(q.bot);
    q.overview = false; q.floor = undefined; q.bot = null;
  }, [state]);

  useEffect(() => {
    if (!api.current || !state) return;
    api.current.sync(state, null);
  }, [state]);

  useEffect(() => {
    if (!api.current || !lastEvent || lastEvent === lastEv.current) return;
    lastEv.current = lastEvent;
    api.current.sync(state, lastEvent);
  }, [lastEvent, state]);

  return (
    <div className="ba-scene" ref={wrap}>
      <canvas />
      {state?.synthetic !== false && <div className="ba-demo">DEMO DATA</div>}
      <button type="button" className="ba-back" data-act="back">Back</button>
    </div>
  );
}
