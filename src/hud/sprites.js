// Single source for HUD bot head icons. Uses the sprite sheet at /sprites/agents.png.
// Frame offsets come from public/sprites/agents.json (bottom row, 32x32 heads).
import layout from "../../public/sprites/agents.json";

function sheetSize(doc) {
  let w = 0, h = 0;
  for (const group of [doc.frames, doc.heads]) {
    for (const f of Object.values(group || {})) {
      w = Math.max(w, (f.x || 0) + (f.w || 0));
      h = Math.max(h, (f.y || 0) + (f.h || 0));
    }
  }
  return { w, h };
}

const dim = sheetSize(layout);
const SHEET = { url: "/sprites/agents.png", sheetW: dim.w, sheetH: dim.h };
// heads.stand = suited agent at x 0, y 120; heads.ceo = long coat at x 32, y 120
export const HEADS = {
  agent: { frame: layout.heads.stand },
  ceo: { frame: layout.heads.ceo }
};

// Snap a box size to a 0.5-step multiple of the 32px head so pixels stay crisp (1x, 1.5x, 2x, ...).
export function crispSize(size, frameW = 32) {
  const k = Math.max(1, Math.round((Number(size) || frameW) / frameW * 2) / 2);
  return Math.round(frameW * k);
}

// CSS background for a head at a given box size (px); crops the sheet with background-position.
export function headBg(kind, size) {
  const h = HEADS[kind] || HEADS.agent;
  const f = h.frame;
  const box = crispSize(size, f.w);
  const k = box / f.w;
  return `background-image:url(${SHEET.url});background-size:${SHEET.sheetW * k}px ${SHEET.sheetH * k}px;background-position:${-f.x * k}px ${-f.y * k}px;background-repeat:no-repeat;`;
}
