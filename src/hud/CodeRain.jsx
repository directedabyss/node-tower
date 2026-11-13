// Full-screen code rain backdrop. Put it behind the 3D scene (scene needs a transparent clear color to show it).
import React, { useEffect, useRef } from 'react';
import { addRain } from './rain.js';

export default function CodeRain({ opacity = 0.55 }) {
  const ref = useRef(null);
  useEffect(() => addRain(ref.current, { fontSize: 16, fade: 0.07 }), []);
  return <canvas ref={ref} aria-hidden="true"
    style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', opacity, background: '#000', zIndex: 0 }} />;
}
