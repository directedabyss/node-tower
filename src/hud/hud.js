// Node Tower HUD. Plain ES module, no dependencies.
// Mount: import { mountHUD } from "./hud.js"; const hud = mountHUD({ floors, rooms, bots });
// 3D hooks (optional): window.BotArena.gotoFloor(id) / overview() are called when present.
// Scene -> HUD: "botarena-select" {detail:{botId}}, "botarena-floor" {detail:{floor}},
// and "botarena-bot-anchors" {botId, x, y, visible, footX, footY}. Room pills are gone (872946d);
// setRoomAnchors is kept as a no-op so leftover callers cannot redraw them.
// HUD -> scene: window events "hud-select-bot" {detail:{botId}} and "hud-floor" {detail:{floor}}.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STATUS = { working: "Working", blocked: "Blocked", idle: "Idle" };
const STCOL = { working: "var(--green)", blocked: "var(--red)", idle: "rgba(157,180,189,.6)" };
const ago = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  return s < 60 ? s + "s" : Math.round(s / 60) + "m";
};
const ICON = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M6 15l6-6 6 6"/></svg>',
  rain: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 3v5M6 11v3"/><path d="M12 4v6M12 13v4"/><path d="M18 3v6M18 12v3"/><path class="slash" d="M5 5l14 14"/></svg>'
};
const ring = (frac, color, r = 15) => {
  const C = 2 * Math.PI * r;
  return `<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="ring-bg" cx="18" cy="18" r="${r}" fill="none" stroke-width="3"/>
  <circle class="ring" cx="18" cy="18" r="${r}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"
   stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - Math.min(1, frac))}"/></svg>`;
};

import { addRain } from "./rain.js";
import { isRainOn, setRainPref, subscribeRainPref } from "./rainPref.js";
import { headBg, crispSize } from "./sprites.js";

export function mountHUD(data, opts = {}) {
  const st = {
    floors: data.floors, rooms: data.rooms, bots: data.bots,
    floor: null, lastFloor: null, bot: null, focus: null, packets: [], inFlight: 0, delivered: data.delivered || 0, ceo: data.ceo || null, searchSel: 0,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches
  };
  const byId = (id) => st.bots.find((b) => b.id === id);
  const floorOf = (id) => st.floors.find((f) => f.id === id);
  const roomOf = (id) => st.rooms.find((r) => r.id === id);

  const root = document.createElement("div");
  root.className = "bah" + (st.reduced ? " rm" : "");
  root.innerHTML = `
    <div class="bah-sweep" aria-hidden="true"></div>
    <div class="bah-anchors" aria-hidden="true"></div>
    <div class="bah-tags" aria-hidden="true"></div>
    <header class="bah-top bah-glass" role="banner">
      <div class="bah-brand">
        <svg class="bah-mark" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="14" fill="none" stroke="rgba(0,255,65,.25)" stroke-width="1.5"/>
          <g class="spin"><path d="M16 2a14 14 0 0 1 14 14" fill="none" stroke="#00ff41" stroke-width="2" stroke-linecap="round"/>
          <path d="M16 30a14 14 0 0 1-14-14" fill="none" stroke="#00ff41" stroke-width="2" stroke-linecap="round" opacity=".5"/></g>
          <circle cx="16" cy="16" r="6.5" fill="none" stroke="#8cffb0" stroke-width="1.5"/><circle cx="16" cy="16" r="2.5" fill="#8cffb0"/>
        </svg>
        <div><b class="bah-title" id="bah-title">NODE TOWER</b>
          <div class="bah-live"><i></i><span class="txt">Live feed</span>${opts.synthetic !== false ? '<span class="bah-synth">SYNTHETIC</span>' : ""}</div></div>
      </div>
      <div class="bah-ceo-slot"></div>
      <div class="bah-kpis" role="group" aria-label="Team status"></div>
      <button type="button" class="bah-iconbtn bah-rain-btn" aria-label="Code rain" aria-pressed="${isRainOn()}">${ICON.rain}</button>
      <button class="bah-iconbtn bah-search-btn" aria-label="Search bots (press /)" aria-expanded="false">${ICON.search}</button>
    </header>
    <div class="bah-run" role="status" aria-label="Active tool" hidden></div>
    <button class="bah-wbadge" data-act="wait" aria-expanded="false" hidden></button>
    <nav class="bah-floors bah-glass" aria-label="Floors"></nav>
    <section class="bah-bots bah-glass" id="bah-bots" aria-label="Bots on this floor"><header><h2>Bots</h2><span class="cap num ncount"></span></header><ul></ul></section>
    <section class="bah-wait bah-glass" aria-label="Waiting on Owner"><header><h2>Waiting on Owner</h2><span class="cap num wcount"></span></header><ul></ul></section>
    <div class="bah-rooms bah-glass" role="list" aria-label="Rooms on this floor"></div>
    <button class="bah-task" hidden></button>
    <nav class="bah-tabs" aria-label="View">
      <button class="bah-tab" data-tab="tower" aria-pressed="true">Tower</button>
      <button class="bah-tab" data-tab="floor" aria-pressed="false">Floor</button>
      <button class="bah-tab" data-tab="bots" aria-pressed="false" aria-controls="bah-bots">Bots</button>
    </nav>
    <div class="bah-scrim"></div>
    <section class="bah-card bah-glass" role="dialog" aria-modal="false" aria-labelledby="bah-card-title" aria-hidden="true"></section>
    <section class="bah-trail bah-glass" aria-label="Packet trail">
      <header role="button" tabindex="0" aria-expanded="false">
        <h2>Packet trail</h2><span class="latest"></span>
        <span class="cap num inflight"></span>
      </header>
      <ol></ol>
      <div class="sr" aria-live="polite"></div>
    </section>
    <div class="bah-search bah-glass" role="dialog" aria-label="Search bots" aria-hidden="true">
      <input type="search" placeholder="Search bots, rooms or tasks" autocomplete="off" aria-controls="bah-results" />
      <ul class="bah-results" id="bah-results" role="listbox"></ul>
    </div>`;
  (opts.container || document.body).appendChild(root);
  const $ = (s) => root.querySelector(s);
  // Code rain inside panels (static sections only; the card re-adds its own on render).
  const rainOff = [];
  const rmFn = () => st.reduced || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const panelRain = (host, o = {}) => {
    const c = document.createElement("canvas"); c.className = "bah-rain"; c.setAttribute("aria-hidden", "true");
    host.prepend(c); return addRain(c, { fontSize: 11, fade: 0.1, speed: 0.4, reducedMotion: rmFn, ...o });
  };
  [".bah-top", ".bah-trail", ".bah-wait"].forEach((sel) => { const h = root.querySelector(sel); if (h) rainOff.push(panelRain(h)); });
  let cardRainOff = null;
  const el = {
    bots: $(".bah-bots ul"), ncount: $(".bah-bots .ncount"), tags: $(".bah-tags"), kpis: $(".bah-kpis"), floors: $(".bah-floors"), rooms: $(".bah-rooms"), card: $(".bah-card"), scrim: $(".bah-scrim"),
    trail: $(".bah-trail"), trailHead: $(".bah-trail header"), list: $(".bah-trail ol"), latest: $(".bah-trail .latest"),
    inflight: $(".bah-trail .inflight"), live: $(".bah-trail [aria-live]"), search: $(".bah-search"),
    input: $(".bah-search input"), results: $(".bah-results"), searchBtn: $(".bah-search-btn"),
    title: $(".bah-title"), run: $(".bah-run"), wbadge: $(".bah-wbadge"), task: $(".bah-task"), tabs: $(".bah-tabs"),
    rainBtn: $(".bah-rain-btn"),
    sweep: $(".bah-sweep"), anchors: $(".bah-anchors"), wait: $(".bah-wait"), waitList: $(".bah-wait ul"), wcount: $(".bah-wait .wcount")
  };

  // ---------- KPIs ----------
  function renderKpis() {
    const n = st.bots.length || 1;
    const c = (s) => st.bots.filter((b) => b.status === s).length;
    const wj = st.bots.filter((b) => b.waitingOnOwner).length;
    const items = [
      ["Working", c("working"), c("working") / n, "var(--green)", ""],
      ["Blocked", c("blocked"), c("blocked") / n, "var(--red)", "red"],
      ["On Owner", wj, wj / n, "var(--gold)", "gold"],
      ["In flight", st.inFlight, st.inFlight / 12, "var(--c)", ""],
      ["At HQ", st.delivered, Math.min(st.delivered / 20, 1), "var(--c2)", "hq"]
    ];
    el.kpis.innerHTML = items.map(([l, v, f, col, cls]) =>
      cls === "gold"
        ? `<button class="bah-kpi ${cls}" data-act="wait" aria-label="${l}: ${v}. Show list" aria-expanded="${el.wait?.classList.contains("open") || false}">${ring(f, col)}<div><strong class="num">${v}</strong><span>${l}</span></div></button>`
        : `<div class="bah-kpi ${cls}" aria-label="${l}: ${v}">${ring(f, col)}<div><strong class="num">${v}</strong><span>${l}</span></div></div>`).join("");
    renderWait(); renderCeo(); renderBadge();
  }
  function renderBadge() {
    const n = st.bots.filter((b) => b.waitingOnOwner).length;
    el.wbadge.hidden = !n;
    el.wbadge.innerHTML = `<span>WAITING ON</span><b>OWNER</b>${n > 1 ? `<em class="num">${n}</em>` : ""}`;
    el.wbadge.setAttribute("aria-label", `Waiting on Owner: ${n}. Show list`);
    el.wbadge.setAttribute("aria-expanded", String(el.wait.classList.contains("open")));
  }

  // ---------- title bar, focus bot, RUN timer, task card, tabs ----------
  const fmtRun = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s2 = t % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s2).padStart(2, "0"); };
  const runSeen = {};
  function runStart(b) {
    if (b.status !== "working") { delete runSeen[b.id]; return 0; }
    if (b.runStartedAt) return Date.parse(b.runStartedAt);
    return (runSeen[b.id] ||= Date.now()); // no feed field: count from when the HUD first saw it working
  }
  const PRI = { working: 3, blocked: 2, idle: 1 };
  function focusOf() { // only a bot the user actually selected; no auto-focus on floor open
    if (!st.floor || !st.focus) return null;
    return st.bots.find((b) => b.id === st.focus && b.floor === st.floor) || null;
  }
  function renderTitle() {
    const f = floorOf(st.floor);
    const t = "NODE TOWER - " + (f ? (f.label || f.name.toUpperCase()) : "TOWER");
    if (el.title.textContent !== t) el.title.textContent = t;
    document.title = t;
    root.classList.toggle("view-floor", !!st.floor); root.classList.toggle("view-tower", !st.floor);
    el.tabs.querySelectorAll(".bah-tab").forEach((b) => {
      const bo = root.classList.contains("bots-open");
      const on = b.dataset.tab === "bots" ? bo : !bo && b.dataset.tab === (st.floor ? "floor" : "tower");
      b.setAttribute("aria-pressed", String(on));
    });
    const fl = el.tabs.querySelector('[data-tab="floor"]');
    fl.textContent = f ? (f.code || "Floor") : "Floor";
    fl.setAttribute("aria-label", f ? `Floor: ${f.name}. Pick another floor` : "Floor view");
  }
  function renderFocus() {
    const b = focusOf();
    // RUN m:ss + tool chip readout (floor level)
    const working = b && b.status === "working";
    el.run.hidden = !working;
    if (working) {
      const sig = b.id + "|" + (b.tool || "");
      if (el.run.dataset.sig !== sig) {
        el.run.dataset.sig = sig;
        el.run.innerHTML = `<span class="rt">RUN <b class="num">0:00</b></span>${b.tool ? `<span class="tool"><i aria-hidden="true">&gt;</i> ${esc(String(b.tool).toUpperCase())}</span>` : ""}`;
        el.run.setAttribute("aria-label", `${label(b)} running ${b.tool || "a task"}`);
      }
      tickRun();
    } else el.run.dataset.sig = "";
    // task card
    el.task.hidden = !b;
    if (b) {
      const stTxt = b.waitingOnOwner ? "blocked - waiting on owner" : b.status === "blocked" ? "blocked" + (b.blocker ? " - " + b.blocker : "") : b.status;
      const head = label(b);
      const sig = [b.id, b.task, stTxt, b.department].join("|");
      if (el.task.dataset.sig !== sig) {
        el.task.dataset.sig = sig;
        el.task.className = "bah-task s-" + b.status;
        el.task.dataset.bot = b.id;
        el.task.innerHTML = `<span class="hrow">${avatarHTML(b, 32)}<b class="h">${esc(String(head).toUpperCase())}</b></span>
          <span class="l"><i>TASK:</i> ${esc(b.status === "idle" ? "standing by" : b.task)}</span>
          <span class="l"><i>STATUS:</i> <em>${esc(stTxt)}</em></span>`;
        el.task.setAttribute("aria-label", `${head}. Task: ${b.task}. Status: ${stTxt}. Open details`);
      }
    }
  }
  function tickRun() {
    const b = focusOf(); const r = el.run.querySelector(".rt b");
    if (!r || !b) return; const s0 = runStart(b); r.textContent = s0 ? fmtRun(Date.now() - s0) : "0:00";
  }
  const runTimer = setInterval(tickRun, 1000);
  function showBots(on) {
    on = on ?? !root.classList.contains("bots-open");
    root.classList.toggle("bots-open", on); root.classList.remove("pick-open");
    if (on) { closeBot(); requestAnimationFrame(() => el.bots.querySelector("button")?.focus({ preventScroll: true })); }
    renderTitle();
  }
  function focusBot(id, fly = false) { // pick whose RUN timer + task card show; fly = ask the scene to zoom to the bot
    const b = byId(id); if (!b) return;
    st.focus = id; setFloor(b.floor); renderFocus();
    window.dispatchEvent(new CustomEvent("hud-select-bot", { detail: { botId: id } }));
    if (fly) window.dispatchEvent(new CustomEvent("hud-fly-to-bot", { detail: { botId: id } }));
  }
  function renderCeo() {
    const slot = root.querySelector(".bah-ceo-slot"); const b = st.ceo && byId(st.ceo);
    if (!slot) return;
    slot.innerHTML = b ? `<button class="bah-ceo" data-bot="${esc(b.id)}" aria-label="CEO, ${esc(b.status)}. Open card">
      ${avatarHTML(b, 32)}<span class="nt"><b>&gt; CEO</b></span></button>` : "";
  }

  function renderWait() {
    if (!el.waitList) return;
    const w = st.bots.filter((b) => b.waitingOnOwner);
    el.wcount.textContent = w.length;
    el.waitList.innerHTML = w.length ? w.map((b) => `<li><button class="bah-witem" data-bot="${esc(b.id)}">
      ${avatarHTML(b, 32)}<span style="min-width:0"><span class="t">${esc(label(b))}</span><span class="p">${esc(b.blocker || b.task || "")}${b.business ? " - " + esc(b.business) : ""}</span></span>
      ${b.due ? `<span class="tm num">${esc(b.due)}</span>` : ""}</button></li>`).join("")
      : `<li class="bah-empty">Nothing is waiting on you.</li>`;
  }
  // Pixel head from public/sprites/agents.png (frames in agents.json). CEO uses the long-coat head.
  function avatarHTML(b, size) {
    const isCeo = b.role === "ceo";
    const box = crispSize(size);
    return `<span class="bah-mini${isCeo ? " ceo-av" : ""}" style="width:${box}px;height:${box}px" aria-hidden="true"><i class="hd" style="${headBg(isCeo ? "ceo" : "agent", box)}"></i></span>`;
  }
  const label = (b) => (b.role === "ceo" ? "> CEO" : b.name); // CEO is only ever shown as > CEO
  const nm = (b) => (b ? label(b) : undefined);



  // ---------- name labels under bots (positions come from the botarena-bot-anchors event) ----------
  // Tags stay hidden until a bot is selected (info card open), including the > CEO tag.
  // After measuring offsetWidth, the centre is clamped so the box stays in [4, viewportWidth-4].
  const boxes = [];
  const hit = (r) => boxes.some((q) => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y);
  function clampX(x, w) { // x = centre
    const leftMin = 4;
    const leftMax = Math.max(4, innerWidth - 4 - w);
    return Math.min(leftMax, Math.max(leftMin, x - w / 2)) + w / 2;
  }
  function place(node, x, y, w, h, dy) { // x = clamped centre, y = top
    const tries = [0];
    const slots = dy ? 6 : 0; // try more vertical slots (up and down) before hiding
    for (let i = 1; i <= slots; i++) { tries.push(i, -i); }
    for (const i of tries) {
      const r = { x: x - w / 2, y: y + i * dy, w, h };
      if (r.y < 4 || r.y + h > innerHeight - 4) continue;
      if (!hit(r)) { boxes.push(r); node.style.visibility = ""; return i * dy; }
    }
    node.style.visibility = "hidden"; return 0;
  }
  // Phone tower view: line each floor label up with that floor's agents (mean foot height), like tower.png.
  let alignT = 0;
  function alignFloors(vis) {
    const on = !st.floor && innerWidth < 760;
    el.floors.classList.toggle("aligned", on);
    if (!on || performance.now() - alignT < 250) return; alignT = performance.now();
    const ys = {};
    vis.forEach(({ a, b }) => { (ys[b.floor] ||= []).push(a.footY ?? a.y); });
    const top = el.floors.getBoundingClientRect().top; let prev = -99;
    [...el.floors.querySelectorAll(".bah-floor[data-floor]:not([data-floor=''])")].forEach((n) => {
      const v = ys[n.dataset.floor]; if (!v) { n.style.top = ""; return; }
      let y = Math.round(v.reduce((p, q) => p + q, 0) / v.length - top - 40);
      y = Math.max(y, prev + 46); prev = y; n.style.top = y + "px";
    });
  }
  const nameEls = new Map();
  function hideNameTags() {
    nameEls.forEach((n) => n.remove()); nameEls.clear();
  }
  function setBotAnchors(list) {
    boxes.length = 0;
    const vis = (list || []).map((a) => ({ a, b: byId(a.botId) })).filter((o) => o.b && o.a.visible !== false);
    const nseen = new Set();
    const picked = st.bot && el.card.classList.contains("on") ? vis.find((o) => o.b.id === st.bot) : null;
    if (picked) {
      const { a, b } = picked;
      nseen.add(b.id);
      let n = nameEls.get(b.id);
      if (!n) { n = document.createElement("div"); n.className = "bah-name"; el.tags.appendChild(n); nameEls.set(b.id, n); }
      const sig = (b.name || b.id) + "|" + b.status + "|" + (b.role || "");
      if (n.dataset.sig !== sig) { n.dataset.sig = sig; n.className = "bah-name s-" + (b.status || "idle") + (b.role === "ceo" ? " ceo" : "");
        const raw = String(b.name || b.id).toUpperCase();
        const tag = raw.length > 14 ? raw.slice(0, 14) + "..." : raw;
        n.innerHTML = b.role === "ceo" ? `<span class="in"><i class="pr" aria-hidden="true">&gt;</i>CEO<i class="cur" aria-hidden="true"></i></span>` : `<span class="in">${esc(tag)}</span>`;
      }
      const nw = n.firstChild.offsetWidth || n._w || 60;
      const nh = n.firstChild.offsetHeight || n._h || 14;
      n._w = nw; n._h = nh;
      const fx = clampX(Math.round(a.footX ?? a.x), nw);
      const fy = Math.round(a.footY ?? (a.y + 64));
      const card = el.card.getBoundingClientRect();
      // If the foot tag would sit under the open info card, lift it into the clear.
      let top = fy + 4;
      const overlapsCard = el.card.classList.contains("on")
        && (fx - (nw + 4) / 2) < card.right && (fx + (nw + 4) / 2) > card.left
        && top < card.bottom && (top + nh + 2) > card.top;
      if (overlapsCard) {
        top = Math.min(Math.round(a.y) - 8 - nh, card.top - 4 - nh);
        top = Math.max(4, top);
      }
      const off = place(n, fx, top, nw + 4, nh + 2, nh + 4);
      n.style.transform = `translate3d(${fx}px, ${top + off}px, 0)`;
    }
    alignFloors(vis);
    nameEls.forEach((n, id) => { if (!nseen.has(id)) { n.remove(); nameEls.delete(id); } });
  }
  const onAnchors = (e) => { const d = e.detail; setBotAnchors(Array.isArray(d) ? d : (d && (d.anchors || d.bots)) || []); };
  window.addEventListener("botarena-bot-anchors", onAnchors);
  if (window.BotArena?.getBotAnchors) { try { setBotAnchors(window.BotArena.getBotAnchors()); } catch (_) {} }

  // ---------- node list ----------
  function placeBots() { // stack the node list under the floor rail, whatever its height
    const box = el.bots?.parentElement; if (!box || innerWidth < 760 || !el.floors.offsetHeight || getComputedStyle(box).display === "none") return;
    const top = el.floors.offsetTop + el.floors.offsetHeight + 8; box.style.top = top + "px"; box.style.setProperty("--bots-top", top + "px");
  }
  window.addEventListener("resize", placeBots);
  function renderBots() {
    if (!el.bots) return;
    requestAnimationFrame(placeBots);
    const list = st.bots.filter((b) => !st.floor || b.floor === st.floor)
      .sort((a, b) => (a.role === "ceo" ? -1 : b.role === "ceo" ? 1 : 0) || a.name.localeCompare(b.name));
    el.ncount.textContent = `${list.filter((b) => b.status === "working").length}/${list.length} working`;
    el.bots.innerHTML = list.map((b) => `<li><button class="bah-node ${esc(b.status)}" data-bot="${esc(b.id)}" aria-label="${esc(label(b))}, ${esc(b.status)}${b.waitingOnOwner ? ", waiting on owner" : ""}">
      ${avatarHTML(b, 32)}<span class="nn"><span class="t">${esc(label(b))}</span><span class="bar"><i></i></span></span>
      <span class="st cap">${b.waitingOnOwner ? "you" : esc(b.status)}</span></button></li>`).join("") || `<li class="bah-empty">No bots here.</li>`;
  }

  // ---------- floors ----------
  function renderFloors() {
    alignT = 0;
    const all = `<button class="bah-floor" data-floor="" aria-pressed="${st.floor === null}"><span class="lvl">TWR</span><span class="nm">Tower</span></button>`;
    el.floors.innerHTML = all + st.floors.map((f) => {
      const bs = st.bots.filter((b) => b.floor === f.id);
      const dots = ["working", "blocked"].map((s) => bs.some((b) => b.status === s) ? `<i style="background:${STCOL[s]};box-shadow:0 0 6px ${STCOL[s]}"></i>` : "").join("");
      return `<button class="bah-floor" data-floor="${f.id}" aria-pressed="${st.floor === f.id}" aria-label="${esc(f.name)}, ${bs.length} bots">
        <span class="lvl">${esc(f.code || f.short)}</span><span class="nm"><span class="full">${esc(f.name)}</span><span class="tw">${esc(f.sub || f.name)}</span></span><span class="dots">${dots}</span></button>`;
    }).join("");
  }
  function setFloor(id, fromScene = false) {
    id = id || null;
    root.classList.remove("pick-open");
    if (st.floor === id) { renderTitle(); return; }
    st.floor = id; if (id) st.lastFloor = id;
    if (st.focus && byId(st.focus)?.floor !== id) st.focus = null;
    if (st.bot && byId(st.bot)?.floor !== id) closeBot();
    renderFloors(); renderRooms(); renderBots(); renderTitle(); renderFocus();
    if (!st.reduced) { el.sweep.classList.remove("go"); void el.sweep.offsetWidth; el.sweep.classList.add("go"); }
    if (!fromScene) {
      const A = window.BotArena;
      if (A) id ? A.gotoFloor?.(id) : A.overview?.();
      window.dispatchEvent(new CustomEvent("hud-floor", { detail: { floor: id } }));
    }
    const active = el.floors.querySelector('[aria-pressed="true"]');
    active?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: st.reduced ? "auto" : "smooth" });
  }

  // ---------- rooms ----------
  function renderRooms() {
    const f = st.floor;
    if (!f) {
      el.rooms.innerHTML = `<div class="bah-room" role="listitem"><span class="cap">Tap a floor to see its rooms</span></div>`;
      return;
    }
    el.rooms.innerHTML = st.rooms.filter((r) => r.floor === f).map((r) => {
      const n = st.bots.filter((b) => b.room === r.id).length;
      const hot = st.bots.some((b) => b.room === r.id && b.status === "working");
      return `<button class="bah-room${hot ? " hot" : ""}" role="listitem" data-room="${r.id}"><span class="bar"></span>${esc(r.name)}<em class="num">${n}</em></button>`;
    }).join("");
  }
  function setRoomAnchors(_list) {
    // Room pills removed in 872946d. Do not draw them if a leftover caller fires this.
    el.anchors.innerHTML = "";
  }

  // ---------- bot card ----------
  let scrimQuietUntil = 0;
  function openBot(id, fromScene = false) {
    const b = byId(id);
    if (!b) return;
    st.bot = id; st.focus = id; root.classList.remove("bots-open", "pick-open"); renderTitle(); renderFocus();
    if (fromScene) scrimQuietUntil = performance.now() + 400;
    const f = floorOf(b.floor), r = roomOf(b.room);
    const hist = st.packets.filter((p) => p.from === id || p.to === id).slice(0, 3);
    const C = 2 * Math.PI * 33;
    const wasOpen = el.card.classList.contains("on");
    queueMicrotask(() => { if (cardRainOff) cardRainOff(); cardRainOff = panelRain(el.card); });
    el.card.innerHTML = `
      <span class="grab" aria-hidden="true"></span>
      <button class="bah-iconbtn bah-close" aria-label="Close bot card">${ICON.close}</button>
      <div class="head">
        <div class="bah-av">
          <svg viewBox="0 0 72 72" aria-hidden="true">
            <circle cx="36" cy="36" r="33" fill="none" stroke="rgba(0,255,65,.18)" stroke-width="1.5"/>
            <g class="orbit"><circle cx="36" cy="36" r="33" fill="none" stroke="${STCOL[b.status]}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${C * 0.3} ${C * 0.7}"/></g>
          </svg>
          ${avatarHTML(b, 48)}
        </div>
        <div style="min-width:0">
          <h3 id="bah-card-title">${esc(label(b))}</h3>
          <div class="sub">${esc(f?.name)} - ${esc(r?.name)}${b.business ? ` - <span class="biz">${esc(b.business)}</span>` : ""}</div>
          <span class="bah-status st-${b.status}"><i></i>${STATUS[b.status] || esc(b.status)}</span>
        </div>
      </div>
      <div class="bah-rows">
        <div class="bah-row"><div class="cap">Current task</div><div class="v">${esc(b.task || "n/a")}</div></div>
        ${b.blocker ? `<div class="bah-row warn"><div class="cap">${b.waitingOnOwner ? "Waiting on Owner" : "Blocker"}</div><div class="v">${esc(b.blocker)}</div></div>` : ""}
        ${b.due ? `<div class="bah-row"><div class="cap">Deadline</div><div class="v num">${esc(b.due)}</div></div>` : ""}
        <div class="bah-row"><div class="cap">Recent handoffs</div>
          ${hist.length ? `<ul class="bah-hist">${hist.map((p) => `<li><span class="kind k-${esc(p.kind)}">${esc(p.kind || "handoff")}</span> ${esc(p.task)}: ${esc(nm(byId(p.from)) || p.from)} to ${esc(nm(byId(p.to)) || p.to || "")}</li>`).join("")}</ul>` : `<div class="v" style="color:var(--ink-2)">None yet</div>`}
        </div>
      </div>
      <div class="bah-actions">
        <button class="bah-btn primary" data-act="fly">Fly to desk</button>
        <button class="bah-btn" data-act="close">Close</button>
      </div>`;
    el.card.classList.add("on"); el.card.setAttribute("aria-hidden", "false");
    el.scrim.classList.add("on");
    if (!wasOpen) el.card.querySelector(".bah-close").focus({ preventScroll: true });
    if (!fromScene) window.dispatchEvent(new CustomEvent("hud-select-bot", { detail: { botId: id } }));
    if (window.BotArena?.getBotAnchors) { try { setBotAnchors(window.BotArena.getBotAnchors()); } catch (_) {} }
  }
  function closeBot() {
    if (!st.bot && !st.focus) return;
    st.bot = null;
    st.focus = null;
    el.card.classList.remove("on"); el.card.setAttribute("aria-hidden", "true");
    el.scrim.classList.remove("on");
    hideNameTags();
    renderFocus();
  }

  // ---------- packet trail ----------
  function pktHTML(p, isNew) {
    const a = byId(p.from), b = byId(p.to);
    const ra = roomOf(a?.room), rb = roomOf(b?.room);
    return `<li><button class="bah-pkt ${esc(p.status)}${isNew ? " new" : ""}" data-bot="${esc(p.to || p.from)}" aria-label="${esc(p.kind || "")} ${esc(p.task)} from ${esc(nm(a))} to ${esc(nm(b))}, ${esc(p.status)}">
      <span class="chip"><i></i></span>
      <span style="min-width:0"><span class="t"><span class="kind k-${esc(p.kind)}">${esc(p.kind || "handoff")}</span> ${esc(p.task)}</span>
        <span class="p" style="display:block"><b>${esc(nm(a) || p.from)}</b> ${esc(roomOf(p.fromRoom)?.name || ra?.name || "")}${p.to ? ` to <b>${esc(nm(b) || p.to)}</b> ${esc(roomOf(p.toRoom)?.name || rb?.name || "")}` : ""}</span></span>
      <span class="tm num mono" data-at="${esc(p.at)}">${ago(p.at)}</span></button></li>`;
  }
  let liveThrottle = 0;
  function ingest(ev) {
    if (!ev || ev.type !== "handoff") return;
    st.packets.unshift(ev);
    st.packets = st.packets.slice(0, 40);
    st.inFlight = typeof ev.inFlight === "number" ? ev.inFlight : st.packets.slice(0, 12).filter((p) => p.status === "moving").length;
    el.list.insertAdjacentHTML("afterbegin", pktHTML(ev, true));
    while (el.list.children.length > 40) el.list.lastElementChild.remove();
    const a = byId(ev.from), b = byId(ev.to);
    el.latest.textContent = `${ev.kind || "handoff"} - ${ev.task}: ${nm(a) || ev.from}${ev.to ? " to " + (nm(b) || ev.to) : ""}`;
    el.inflight.textContent = st.inFlight + " moving";
    if (Date.now() - liveThrottle > 15000) { liveThrottle = Date.now(); el.live.textContent = "New handoff: " + el.latest.textContent; }
    renderKpis();
  }
  setInterval(() => root.querySelectorAll("[data-at]").forEach((n) => (n.textContent = ago(n.dataset.at))), 5000);

  // ---------- search ----------
  function openSearch() {
    el.search.classList.add("on"); el.search.setAttribute("aria-hidden", "false");
    el.searchBtn.setAttribute("aria-expanded", "true");
    el.input.value = ""; renderResults(); setTimeout(() => el.input.focus(), 30);
  }
  function closeSearch() {
    el.search.classList.remove("on"); el.search.setAttribute("aria-hidden", "true");
    el.searchBtn.setAttribute("aria-expanded", "false");
  }
  let hits = [];
  function renderResults() {
    const q = el.input.value.trim().toLowerCase();
    hits = st.bots.filter((b) => !q || [b.name, label(b), b.task, floorOf(b.floor)?.name, roomOf(b.room)?.name].join(" ").toLowerCase().includes(q)).slice(0, 8);
    st.searchSel = 0;
    el.results.innerHTML = hits.length ? hits.map((b, i) => `<li><button class="bah-res" role="option" aria-selected="${i === 0}" data-bot="${b.id}">
      ${avatarHTML(b, 32)}<span><span>${esc(label(b))}</span><small>${esc(floorOf(b.floor)?.name)} - ${esc(b.task)}</small></span>
      <span class="bah-status st-${b.status}" style="margin:0 0 0 auto"><i></i>${STATUS[b.status]}</span></button></li>`).join("")
      : `<li class="bah-empty">No bots match that search.</li>`;
  }
  function pickBot(id) {
    const b = byId(id); if (!b) return;
    closeSearch(); setFloor(b.floor); openBot(id);
  }

  // ---------- events ----------
  root.addEventListener("click", (e) => {
    const t = e.target.closest("button, [data-floor], .bah-scrim");
    if (!t) return;
    if (t.matches(".bah-floor")) setFloor(t.dataset.floor);
    else if (t.matches(".bah-task")) openBot(t.dataset.bot);
    else if (t.matches(".bah-tab")) {
      const k = t.dataset.tab;
      if (k === "bots") return showBots();
      root.classList.remove("bots-open");
      if (k === "tower") setFloor(null);
      else if (!st.floor) setFloor(st.lastFloor || (st.bots.find((b) => b.status === "working" && b.role !== "ceo") || {}).floor || st.floors[st.floors.length - 1]?.id);
      else { root.classList.toggle("pick-open"); renderTitle(); }
    }
    else if (t.matches(".bah-pkt, .bah-res, .bah-witem, .bah-ceo, .bah-node")) pickBot(t.dataset.bot);
    else if (t.matches("[data-act=wait]")) { const o = el.wait.classList.toggle("open"); t.setAttribute("aria-expanded", String(o)); if (o) { closeBot(); root.classList.remove("bots-open"); } renderBadge(); }
    else if (t.matches(".bah-rain-btn")) setRainPref(isRainOn() ? "off" : "on");
    else if (t.matches(".bah-search-btn")) el.search.classList.contains("on") ? closeSearch() : openSearch();
    else if (t.matches(".bah-close, [data-act=close], .bah-scrim")) {
      if (t.matches(".bah-scrim") && performance.now() < scrimQuietUntil) return;
      closeBot();
    }
    else if (t.matches("[data-act=fly]")) { const b = byId(st.bot); if (b) { setFloor(b.floor); window.dispatchEvent(new CustomEvent("hud-fly-to-bot", { detail: { botId: b.id } })); } }
    else if (t.matches(".bah-room")) {
      const first = st.bots.find((b) => b.room === t.dataset.room); if (first) openBot(first.id);
    }
  });
  const toggleTrail = () => { const o = el.trail.classList.toggle("open"); el.trailHead.setAttribute("aria-expanded", String(o)); };
  el.trailHead.addEventListener("click", () => { if (innerWidth < 760) toggleTrail(); });
  el.trailHead.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && innerWidth < 760) { e.preventDefault(); toggleTrail(); } });
  el.input.addEventListener("input", renderResults);
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      st.searchSel = (st.searchSel + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % Math.max(1, hits.length);
      el.results.querySelectorAll(".bah-res").forEach((n, i) => n.setAttribute("aria-selected", String(i === st.searchSel)));
    } else if (e.key === "Enter" && hits[st.searchSel]) pickBot(hits[st.searchSel].id);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (el.search.classList.contains("on")) closeSearch(); else if (root.classList.contains("bots-open") || root.classList.contains("pick-open")) { root.classList.remove("bots-open", "pick-open"); renderTitle(); } else closeBot(); }
    else if (e.key === "/" && document.activeElement !== el.input) { e.preventDefault(); openSearch(); }
  });
  window.addEventListener("botarena-select", (e) => { const id = e.detail?.botId; if (id) openBot(id, true); else closeBot(); });
  window.addEventListener("botarena-floor", (e) => setFloor(e.detail?.floor, true));
  document.addEventListener("click", (e) => { if (e.target.closest?.("[data-act=back], .ba-back")) closeBot(); });
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", (m) => setReducedMotion(m.matches));
  function setReducedMotion(on) { st.reduced = !!on; root.classList.toggle("rm", st.reduced); }

  function syncRainBtn() {
    const on = isRainOn();
    el.rainBtn.setAttribute("aria-pressed", String(on));
    el.rainBtn.setAttribute("aria-label", on ? "Code rain, on" : "Code rain, off");
  }
  const unsubRain = subscribeRainPref(syncRainBtn);
  syncRainBtn();

  renderKpis(); renderFloors(); renderRooms(); renderBots(); renderTitle(); renderFocus();
  if (new URLSearchParams(location.search).has("rm")) setReducedMotion(true);

  const api = {
    load(d) {
      Object.assign(st, { floors: d.floors || st.floors, rooms: d.rooms || st.rooms, bots: d.bots || st.bots, delivered: d.delivered ?? st.delivered, ceo: d.ceo ?? st.ceo });
      renderKpis(); renderFloors(); renderRooms(); renderBots(); renderTitle(); renderFocus();
      if (st.bot && el.card.classList.contains("on")) openBot(st.bot, true);
    },
    destroy() { clearInterval(runTimer); unsubRain(); window.removeEventListener("botarena-bot-anchors", onAnchors); rainOff.forEach((f) => f()); if (cardRainOff) cardRainOff(); root.remove(); if (window.BotArenaHUD === api) delete window.BotArenaHUD; },
    ingest, openBot, closeBot, setFloor, focusBot, showBots, setRoomAnchors, setReducedMotion, openSearch, closeSearch,
    state: () => ({ floor: st.floor, bot: st.bot, focus: focusOf()?.id || null, packets: st.packets.length })
  };
  window.BotArenaHUD = api;
  return api;
}
