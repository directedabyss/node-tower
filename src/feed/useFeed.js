import { useEffect, useState } from 'react';
import { subscribe } from './mockFeed.js';

export function useFeed(intervalMs = 2000) {
  const [state, setState] = useState(null);
  const [lastEvent, setLastEvent] = useState(null);
  const [source, setSource] = useState('connecting');
  useEffect(() => {
    let cancelled = false, timer, mockStop = null, hasRealData = false;
    const es = new EventSource('/api/events');
    es.addEventListener('feed', m => { try { if (!cancelled) setLastEvent(JSON.parse(m.data)); } catch {} });
    async function poll() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch('/api/snapshot', { signal: controller.signal });
        if (!response.ok || response.status === 204) throw new Error('Feed unavailable');
        const snap = await response.json();
        if (!snap || !Array.isArray(snap.bots)) throw new Error('Invalid feed');
        if (cancelled) return;
        if (mockStop) { mockStop(); mockStop = null; }
        hasRealData = snap.synthetic === false;
        setState(snap); setSource('server');
      } catch {
        if (cancelled) return;
        setSource('unavailable');
        if (hasRealData) setState(s => ({ ...s, feedHealth: { ...s.feedHealth, status: 'stale' } }));
        else if (!mockStop) mockStop = subscribe({ intervalMs, onSnapshot: setState, onEvent: (ev, s) => { setState(s); setLastEvent(ev); } });
      } finally {
        clearTimeout(timeout);
        if (!cancelled) timer = setTimeout(poll, intervalMs);
      }
    }
    poll();
    return () => { cancelled = true; clearTimeout(timer); es.close(); if (mockStop) mockStop(); };
  }, [intervalMs]);
  return { state, lastEvent, source };
}
