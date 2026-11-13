// Shell: code rain backdrop, 3D scene above it, HUD on top.
import React, { useEffect, useLayoutEffect } from 'react';
import { useFeed } from './feed/useFeed.js';
import HUD from './hud/HUD.jsx';
import CodeRain from './hud/CodeRain.jsx';
import ArenaScene from './scene/ArenaScene.jsx';

const BANNER_GAP = 6;

function isFeedDown(source, state) {
  return source === 'unavailable' || ['stale', 'unavailable'].includes(state?.feedHealth?.status);
}

function visibleRect(el) {
  if (!el || el.hasAttribute('hidden')) return null;
  const s = getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return r;
}

export default function App() {
  const { state, lastEvent, source } = useFeed();
  const feedDown = isFeedDown(source, state);
  const staleSnapshot = state?.synthetic === false;

  // HUD hardcodes "Live feed" in the top bar; keep that label in sync with
  // feed-down state without editing hud.js. CSS already uppercases .bah-live .txt.
  useEffect(() => {
    const apply = () => {
      const label = document.querySelector('.bah-live .txt');
      if (!label) return false;
      if (feedDown) label.textContent = staleSnapshot ? 'Feed stale' : 'Demo data';
      else label.textContent = 'Live feed';
      return true;
    };
    if (apply()) return undefined;
    const id = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(id);
  }, [feedDown, staleSnapshot]);

  // Sit the banner below the lower bottom edge of the top bar and the RUN
  // chip (.bah-run), with a small gap. Recompute when either box changes,
  // the chip appears or disappears, or the viewport resizes.
  useLayoutEffect(() => {
    if (!feedDown) return undefined;
    const banner = document.querySelector('.nt-feed-banner');
    if (!banner) return undefined;

    const place = () => {
      const bar = visibleRect(document.querySelector('.bah-top'));
      const run = visibleRect(document.querySelector('.bah-run'));
      let bottom = 0;
      if (bar) bottom = Math.max(bottom, bar.bottom);
      if (run) bottom = Math.max(bottom, run.bottom);
      if (!bottom) return;
      banner.style.top = `${Math.round(bottom + BANNER_GAP)}px`;
    };

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    const watched = new Set();
    const watch = (el) => {
      if (!el || !ro || watched.has(el)) return;
      ro.observe(el);
      watched.add(el);
    };
    const hook = () => {
      watch(document.querySelector('.bah-top'));
      watch(document.querySelector('.bah-run'));
      watch(document.querySelector('.bah'));
      place();
    };

    hook();
    const mo = new MutationObserver(hook);
    const root = document.querySelector('.bah') || document.body;
    mo.observe(root, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true
    });
    window.addEventListener('resize', place);
    const raf = requestAnimationFrame(place);
    return () => {
      ro?.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', place);
      cancelAnimationFrame(raf);
    };
  }, [feedDown]);

  const bannerText = staleSnapshot
    ? 'FEED STALE - last snapshot'
    : 'FEED DOWN - demo data';

  return (
    <>
      <style>{`
        .nt-feed-banner {
          position: fixed;
          left: 50%;
          transform: translateX(-50%);
          top: calc(10px + env(safe-area-inset-top, 0px) + 56px + 6px);
          z-index: 20;
          box-sizing: border-box;
          max-width: min(640px, calc(100vw - 24px));
          padding: 3px 12px;
          border: 1px solid #ffbc66;
          border-radius: 8px;
          background: rgba(91, 34, 0, 0.92);
          color: #fff;
          font: 600 10px/1.2 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          pointer-events: none;
          backdrop-filter: blur(14px) saturate(140%);
          -webkit-backdrop-filter: blur(14px) saturate(140%);
        }
        @media (max-width: 759px) {
          .nt-feed-banner {
            top: calc(8px + env(safe-area-inset-top, 0px) + 48px + 6px);
          }
        }
      `}</style>
      {feedDown && (
        <div role="status" aria-live="polite" className="nt-feed-banner">
          {bannerText}
        </div>
      )}
      <CodeRain />
      <ArenaScene state={state} lastEvent={lastEvent} />
      <HUD state={state} lastEvent={lastEvent} />
    </>
  );
}
