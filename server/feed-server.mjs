// Local feed server (sidecar). Tokens stay server-side; remote sources are read-only.
// GET  /api/snapshot -> current state JSON
// GET  /api/events   -> text/event-stream, one "data:" JSON event per change
// GET  /api/health   -> { ok, status, schemaVersion, synthetic, source, requested }
// POST /api/webhook  -> push tasks (only when FEED_SOURCE=webhook)
// FEED_SOURCE in server/.env: demo (default) | file | sheet | clickup | trello | notion | webhook
import http from 'node:http';
import { getEnv } from './env.mjs';
import { loadFeed, selectedSource } from './feed.mjs';
import { eventsFromDiff } from './normalize.mjs';
import { createFeed } from '../src/feed/mockFeed.js';
import { handleWebhook, defaultStore, MAX_BODY_BYTES } from './connectors/webhook.mjs';

const ENV = getEnv();
const PORT = Number(ENV.FEED_PORT || 8788);
const HOST = '127.0.0.1';
const INTERVAL = Number(ENV.FEED_INTERVAL_MS || 2000); // demo animation tick
const POLL = Math.max(2000, Number(ENV.FEED_POLL_MS || 10000)); // remote source refresh
const SOURCE = selectedSource(ENV) || 'demo';
const clients = new Set();

let current = { snapshot: null, source: 'demo', synthetic: true, reason: 'DEMO DATA' };
let demoEngine = null;
let health = { status: 'connecting', lastSuccessAt: null };
const snapshot = () => ({ ...current.snapshot, feedHealth: health });
const isLive = (c) => c.source !== 'demo';

// Only log a fallback reason when it changes, so a failing source does not spam the console.
let lastLog = '';
const log = (line) => { if (line !== lastLog) { lastLog = line; console.log(line); } };

function broadcast(ev) {
  if (!ev) return;
  const line = `id: ${ev.id}\nevent: feed\ndata: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(line);
}

function startDemo() {
  if (!demoEngine) demoEngine = createFeed({ seed: 42 });
  current = { ...current, snapshot: demoEngine.snapshot() };
}

function tickDemo() {
  if (!demoEngine || isLive(current)) return;
  const ev = demoEngine.next();
  current = { ...current, snapshot: demoEngine.snapshot() };
  broadcast(ev);
}

async function refresh() {
  const next = await loadFeed({ log });
  if (!isLive(next)) {
    if (isLive(current)) health = { ...health, status: 'stale' };
    else { health = { ...health, status: SOURCE === 'demo' ? 'demo' : 'unavailable' }; startDemo(); }
    return;
  }
  if (!isLive(current)) log(`feed: ${next.source} connected (${next.stats?.tasks ?? 0} tasks, ${next.stats?.unmatched ?? 0} with an owner not in the roster)`);
  const evs = isLive(current) && current.snapshot ? eventsFromDiff(current.snapshot, next.snapshot) : [];
  demoEngine = null;
  health = { status: 'live', lastSuccessAt: new Date().toISOString() };
  current = next;
  for (const ev of evs) broadcast(ev);
}

current = await loadFeed({ log });
if (isLive(current)) health = { status: 'live', lastSuccessAt: new Date().toISOString() };
else { health = { status: current.fallback ? 'unavailable' : 'demo', lastSuccessAt: null }; startDemo(); }

setInterval(tickDemo, INTERVAL);
if (SOURCE !== 'demo') {
  const poll = async () => {
    try { await refresh(); } catch { health = { ...health, status: 'stale' }; }
    setTimeout(poll, SOURCE === 'webhook' ? INTERVAL : POLL);
  };
  setTimeout(poll, SOURCE === 'webhook' ? INTERVAL : POLL);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/api/webhook') {
    if (SOURCE !== 'webhook') return json(404, { ok: false, error: 'webhook source is not enabled (set FEED_SOURCE=webhook)' });
    if (req.method !== 'POST') return json(405, { ok: false, error: 'use POST' });
    let body;
    try { body = await readBody(req); } catch (err) { return json(err.code === 413 ? 413 : 400, { ok: false, error: err.code === 413 ? 'payload too large' : 'bad request' }); }
    const out = handleWebhook({ env: ENV, headers: req.headers, contentType: req.headers['content-type'], body, store: defaultStore });
    if (out.code === 200) { try { await refresh(); } catch { /* next poll retries */ } }
    return json(out.code, out.body);
  }
  if (req.method !== 'GET') return json(405, { error: 'method not allowed' });
  if (url.pathname === '/api/health') {
    return json(200, {
      ok: health.status === 'live' || health.status === 'demo',
      ...health,
      schemaVersion: current.snapshot?.schemaVersion,
      synthetic: current.synthetic !== false,
      source: current.source,
      requested: SOURCE,
      reason: current.source === 'demo' ? 'DEMO DATA' : undefined
    });
  }
  if (url.pathname === '/api/snapshot') return json(200, snapshot());
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': '*' });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  json(404, { error: 'not found' });
}).listen(PORT, HOST, () => {
  const what = isLive(current) ? current.source : (SOURCE === 'demo' ? 'DEMO DATA' : `DEMO DATA, ${SOURCE} fallback`);
  console.log(`feed server on http://${HOST}:${PORT} (source: ${what})`);
});
