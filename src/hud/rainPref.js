// Shared code-rain preference for HUD backdrop, panel rain, and in-world monitors.
const KEY = 'nodetower.rain';
const listeners = new Set();

export function readRainPref() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'on' || v === 'off') return v;
  } catch {}
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return 'off';
  } catch {}
  return 'on';
}

export function isRainOn() {
  return readRainPref() === 'on';
}

export function setRainPref(value) {
  const v = value === 'on' ? 'on' : 'off';
  try { localStorage.setItem(KEY, v); } catch {}
  listeners.forEach((fn) => { try { fn(v); } catch {} });
}

export function subscribeRainPref(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
