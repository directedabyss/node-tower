// Offline checks for every feed source. No network: remote sources use a mocked fetch with fixtures.
// Each remote source is checked three ways: fixture OK, missing config, failing token -> demo fallback.
import { loadFeed } from '../server/feed.mjs';
import { normalizeStatus, normalizeDue, tasksToSnapshot } from '../server/normalize.mjs';
import { parseCsv } from '../server/csv.mjs';
import { createWebhookStore, handleWebhook } from '../server/connectors/webhook.mjs';
import { createFeed } from '../src/feed/mockFeed.js';
import { EVENT_TYPES, ROOMS, BOTS } from '../src/feed/mockData.js';

let checks = 0;
function ok(cond, msg) {
  if (!cond) throw new Error(msg);
  checks++;
}
const logs = [];
const capture = (line) => logs.push(line);
// fileEnv: {} so a developer's real server/.env never leaks into the checks.
const run = (env, extra = {}) => loadFeed({ env, fileEnv: {}, log: capture, timeoutMs: 2000, ...extra });
const FAKE = 'fake-token-DO-NOT-USE-1234567890';

// Mock fetch: no network. Routes by URL; any request carrying FAKE gets a 401.
function mockFetch(routes, seen = []) {
  return async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {} });
    const auth = JSON.stringify(init.headers || {});
    if (auth.includes(FAKE) || String(url).includes(FAKE)) return resp(401, { err: 'unauthorized' });
    for (const [re, body] of routes) if (re.test(String(url))) return resp(200, body);
    return resp(404, { err: 'not found' });
  };
}
function resp(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}
const offline = async () => { throw new Error('network disabled in feed:check'); };

function botOf(snap, id) { return snap.bots.find((b) => b.id === id); }

function noLeak(value, label) {
  const text = JSON.stringify(value) + '\n' + logs.join('\n');
  ok(!text.includes(FAKE), `${label}: fake token was echoed`);
}

async function expectFallback(label, env, extra) {
  const r = await run(env, extra);
  ok(r.source === 'demo' && r.synthetic === true && r.fallback === true && r.reason === 'DEMO DATA', `${label}: did not fall back to demo`);
  ok(Array.isArray(r.snapshot.bots) && r.snapshot.bots.length === BOTS.length, `${label}: fallback snapshot invalid`);
  noLeak(r, label);
  return r;
}

async function checkDemo() {
  const r = await run({ FEED_SOURCE: '' });
  ok(r.source === 'demo' && r.synthetic && !r.fallback, 'demo: default source should be demo');
  const r2 = await run({ FEED_SOURCE: 'demo' });
  ok(r2.source === 'demo' && !r2.fallback, 'demo: explicit demo failed');
  await expectFallback('demo: unknown source', { FEED_SOURCE: 'nope' });
  console.log('  demo: default, explicit and unknown FEED_SOURCE -> DEMO DATA');
}

async function checkFile() {
  const j = await run({ FEED_SOURCE: 'file', FEED_FILE: 'examples/tasks.example.json' });
  ok(j.source === 'file' && j.synthetic === false, 'file json: did not load');
  ok(botOf(j.snapshot, 'nova').status === 'working', 'file json: Nova should be working');
  ok(botOf(j.snapshot, 'titan').status === 'blocked' && /owner/i.test(botOf(j.snapshot, 'titan').blockers[0].text), 'file json: Titan should be blocked, waiting on owner');
  ok(j.snapshot.completedTaskIds.includes('ex-5') && j.snapshot.completedTaskIds.includes('ex-6'), 'file json: done/cancelled should be done');
  ok(botOf(j.snapshot, 'nova').currentTask.deadline === '2026-12-01T00:00:00.000Z', 'file json: due not ISO');
  const c = await run({ FEED_SOURCE: 'file', FEED_FILE: 'examples/tasks.example.csv' });
  ok(c.source === 'file', 'file csv: did not load');
  ok(botOf(c.snapshot, 'pixel').status === 'blocked', 'file csv: on hold should be blocked');
  ok(botOf(c.snapshot, 'pixel').currentTask.title === 'Design sample banner, large size', 'file csv: quoted comma');
  ok(botOf(c.snapshot, 'lyra').currentTask.title === 'Polish the "Settings" demo screen', 'file csv: escaped quotes');
  ok(c.snapshot.completedTaskIds.includes('csv-4'), 'file csv: complete should be done');
  ok(botOf(c.snapshot, 'juno').currentTask.deadline === null, 'file csv: empty due should be null');
  await expectFallback('file: missing FEED_FILE', { FEED_SOURCE: 'file' });
  await expectFallback('file: missing file', { FEED_SOURCE: 'file', FEED_FILE: 'examples/does-not-exist.json' });
  console.log('  file: JSON and CSV examples load; missing config / missing file -> DEMO DATA');
}

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/TEST/pub?output=csv';
const SHEET_CSV = 'Task,Assignee,State,Due Date\nShip demo build,Orion,In Progress,2026-12-10\nWait for sample assets,Echo,Blocked,\nOld demo,Quill,Closed,\n';

async function checkSheet() {
  const seen = [];
  const r = await run({ FEED_SOURCE: 'sheet', SHEET_CSV_URL: SHEET_URL }, { fetchImpl: mockFetch([[/docs\.google\.com/, SHEET_CSV]], seen) });
  ok(r.source === 'sheet', 'sheet: did not load fixture');
  ok(botOf(r.snapshot, 'orion').status === 'working' && botOf(r.snapshot, 'echo').status === 'blocked', 'sheet: status mapping');
  ok(r.snapshot.completedTaskIds.length === 1, 'sheet: closed should be done');
  ok(seen.every((s) => s.method === 'GET'), 'sheet: must only GET');
  await expectFallback('sheet: missing config', { FEED_SOURCE: 'sheet' }, { fetchImpl: offline });
  await expectFallback('sheet: http url refused', { FEED_SOURCE: 'sheet', SHEET_CSV_URL: 'http://example.com/x.csv' }, { fetchImpl: offline });
  await expectFallback('sheet: fetch failure', { FEED_SOURCE: 'sheet', SHEET_CSV_URL: SHEET_URL + '&k=' + FAKE }, { fetchImpl: mockFetch([]) });
  await expectFallback('sheet: HTML page', { FEED_SOURCE: 'sheet', SHEET_CSV_URL: SHEET_URL }, { fetchImpl: mockFetch([[/docs/, '<!DOCTYPE html><html></html>']]) });
  console.log('  sheet: fixture CSV loads (GET only); missing config / failure / HTML -> DEMO DATA');
}

const CLICKUP_FIXTURE = {
  last_page: true,
  tasks: [
    { id: 'cu1', name: 'Map sample fields - owner: Nova', status: { status: 'in progress', type: 'custom' }, tags: [], assignees: [], due_date: '1764547200000' },
    { id: 'cu2', name: 'Review demo copy', status: { status: 'on hold', type: 'custom' }, tags: [{ name: 'Sentry' }], assignees: [] },
    { id: 'cu3', name: 'Build test page', status: { status: 'open', type: 'open' }, tags: [], assignees: [{ username: 'Lyra' }] },
    { id: 'cu4', name: 'Old demo task', status: { status: 'shipped', type: 'closed' }, tags: [{ name: 'Echo' }] },
    { id: 'cu5', name: 'Dropped demo task', status: { status: 'cancelled', type: 'custom' }, tags: [{ name: 'Vega' }] },
    { id: 'cu6', name: 'Needs sign-off', status: { status: 'update required', type: 'custom' }, tags: [{ name: 'Titan' }] }
  ]
};

async function checkClickUp() {
  const seen = [];
  const env = { FEED_SOURCE: 'clickup', CLICKUP_TOKEN: 'test-token-ok', CLICKUP_LIST_ID: '123' };
  const r = await run(env, { fetchImpl: mockFetch([[/api\.clickup\.com\/api\/v2\/list\/123\/task/, CLICKUP_FIXTURE]], seen) });
  ok(r.source === 'clickup', 'clickup: did not load fixture');
  ok(botOf(r.snapshot, 'nova').status === 'working' && botOf(r.snapshot, 'nova').currentTask.title === 'Map sample fields', 'clickup: owner in title');
  ok(botOf(r.snapshot, 'nova').currentTask.deadline === new Date(1764547200000).toISOString(), 'clickup: due ms -> ISO');
  ok(botOf(r.snapshot, 'sentry').status === 'blocked', 'clickup: owner from tag, on hold -> blocked');
  ok(botOf(r.snapshot, 'lyra').status === 'working', 'clickup: owner from assignee');
  ok(botOf(r.snapshot, 'titan').blockers[0].text === 'Waiting on Owner', 'clickup: update required -> Waiting on Owner');
  ok(['cu4', 'cu5'].every((id) => r.snapshot.completedTaskIds.includes(id)), 'clickup: closed/cancelled -> done');
  ok(seen.length > 0 && seen.every((s) => s.method === 'GET'), 'clickup: must only GET');
  await expectFallback('clickup: missing config', { FEED_SOURCE: 'clickup' }, { fetchImpl: offline });
  await expectFallback('clickup: bad list id', { ...env, CLICKUP_LIST_ID: '../x' }, { fetchImpl: offline });
  await expectFallback('clickup: fake token', { ...env, CLICKUP_TOKEN: FAKE }, { fetchImpl: mockFetch([[/clickup/, CLICKUP_FIXTURE]]) });
  console.log('  clickup: fixture loads (GET only); missing config / bad list / fake token -> DEMO DATA');
}

const TRELLO = {
  lists: [{ id: 'L1', name: 'Doing' }, { id: 'L2', name: 'Done' }, { id: 'L3', name: 'Waiting' }],
  members: [{ id: 'M1', fullName: 'Juno', username: 'juno1' }, { id: 'M2', fullName: 'Some Person', username: 'person' }],
  cards: [
    { id: 'tc1', name: 'Reply to demo ticket', idList: 'L1', idMembers: ['M1'], labels: [], closed: false, due: '2026-12-08T12:00:00.000Z' },
    { id: 'tc2', name: 'Plan sample campaign', idList: 'L1', idMembers: ['M2'], labels: [{ name: 'Quill' }], closed: false, due: null },
    { id: 'tc3', name: 'Finished demo card', idList: 'L2', idMembers: ['M1'], labels: [], closed: false },
    { id: 'tc4', name: 'Archived demo card', idList: 'L1', idMembers: [], labels: [{ name: 'Sol' }], closed: true },
    { id: 'tc5', name: 'Sample contract', idList: 'L3', idMembers: [], labels: [{ name: 'Titan' }], closed: false }
  ]
};

async function checkTrello() {
  const seen = [];
  const env = { FEED_SOURCE: 'trello', TRELLO_KEY: 'test-key-ok', TRELLO_TOKEN: 'test-token-ok', TRELLO_BOARD_ID: 'abc123' };
  const fx = mockFetch([[/\/boards\/abc123\/cards/, TRELLO.cards], [/\/boards\/abc123\/lists/, TRELLO.lists], [/\/boards\/abc123\/members/, TRELLO.members]], seen);
  const r = await run(env, { fetchImpl: fx });
  ok(r.source === 'trello', 'trello: did not load fixture');
  ok(botOf(r.snapshot, 'juno').status === 'working' && botOf(r.snapshot, 'juno').currentTask.title === 'Reply to demo ticket', 'trello: owner from member');
  ok(botOf(r.snapshot, 'quill').status === 'working', 'trello: owner from label');
  ok(botOf(r.snapshot, 'titan').status === 'blocked', 'trello: Waiting list -> blocked');
  ok(['tc3', 'tc4'].every((id) => r.snapshot.completedTaskIds.includes(id)), 'trello: Done list / archived -> done');
  ok(seen.every((s) => s.method === 'GET' && !s.url.includes('test-token-ok')), 'trello: GET only, token not in URL');
  await expectFallback('trello: missing config', { FEED_SOURCE: 'trello', TRELLO_KEY: 'k' }, { fetchImpl: offline });
  await expectFallback('trello: fake token', { ...env, TRELLO_TOKEN: FAKE }, { fetchImpl: fx });
  console.log('  trello: fixture loads (GET only, token in header); missing config / fake token -> DEMO DATA');
}

const NOTION_DB = '0123456789abcdef0123456789abcdef';
const page = (id, title, owner, status, due, statusType = 'status') => ({
  id, archived: false,
  properties: {
    Name: { type: 'title', title: [{ plain_text: title }] },
    Owner: { type: 'people', people: owner ? [{ name: owner }] : [] },
    Status: statusType === 'status' ? { type: 'status', status: { name: status } } : { type: 'select', select: { name: status } },
    Due: { type: 'date', date: due ? { start: due } : null }
  }
});
const NOTION_P1 = { results: [page('n1', 'Outline demo report', 'Iris', 'In progress', '2026-12-09'), page('n2', 'Collect sample quotes', 'Sol', 'Blocked', null, 'select')], has_more: true, next_cursor: 'c2' };
const NOTION_P2 = { results: [page('n3', 'Old demo page', 'Vega', 'Done', null), page('n4', 'Canceled idea', 'Echo', 'Canceled', null)], has_more: false, next_cursor: null };

async function checkNotion() {
  const seen = [];
  let call = 0;
  const fx = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method, body: init.body, headers: init.headers });
    if (JSON.stringify(init.headers || {}).includes(FAKE)) return resp(401, { object: 'error' });
    if (!/api\.notion\.com\/v1\/databases\/0123456789abcdef0123456789abcdef\/query$/.test(String(url))) return resp(404, {});
    return resp(200, call++ === 0 ? NOTION_P1 : NOTION_P2);
  };
  const env = { FEED_SOURCE: 'notion', NOTION_TOKEN: 'test-notion-ok', NOTION_DATABASE_ID: '01234567-89ab-cdef-0123-456789abcdef' };
  const r = await run(env, { fetchImpl: fx });
  ok(r.source === 'notion', 'notion: did not load fixture');
  ok(botOf(r.snapshot, 'iris').status === 'working' && botOf(r.snapshot, 'iris').currentTask.title === 'Outline demo report', 'notion: title/owner/status');
  ok(botOf(r.snapshot, 'sol').status === 'blocked', 'notion: select Blocked -> blocked');
  ok(['n3', 'n4'].every((id) => r.snapshot.completedTaskIds.includes(id)), 'notion: done/canceled -> done');
  ok(seen.length === 2 && seen.every((s) => s.method === 'POST' && /\/query$/.test(s.url)), 'notion: only database query calls, paginated');
  ok(JSON.parse(seen[1].body).start_cursor === 'c2', 'notion: pagination cursor');
  // Custom property names
  const custom = async () => resp(200, { results: [{ id: 'n9', properties: { Task: { type: 'title', title: [{ plain_text: 'Custom props task' }] }, Who: { type: 'rich_text', rich_text: [{ plain_text: 'Nova' }] }, Stage: { type: 'select', select: { name: 'Doing' } }, When: { type: 'date', date: { start: '2026-12-12' } } } }], has_more: false });
  const r2 = await run({ ...env, NOTION_OWNER_PROP: 'Who', NOTION_STATUS_PROP: 'Stage', NOTION_TITLE_PROP: 'Task', NOTION_DUE_PROP: 'When' }, { fetchImpl: custom });
  ok(r2.source === 'notion' && botOf(r2.snapshot, 'nova').currentTask?.title === 'Custom props task', 'notion: custom property names');
  await expectFallback('notion: missing config', { FEED_SOURCE: 'notion' }, { fetchImpl: offline });
  await expectFallback('notion: fake token', { ...env, NOTION_TOKEN: FAKE }, { fetchImpl: fx });
  console.log('  notion: fixture loads (read-only query, paginated, custom props); missing config / fake token -> DEMO DATA');
}

async function checkWebhook() {
  const store = createWebhookStore();
  const task = { id: 'w1', owner: 'Echo', status: 'in progress', title: 'Webhook demo task', due: '2026-12-15' };
  const json = 'application/json';
  // Empty store -> demo fallback
  await expectFallback('webhook: empty store', { FEED_SOURCE: 'webhook' }, { webhookStore: store });
  // No secret configured: accepted
  let out = handleWebhook({ env: {}, headers: {}, contentType: json, body: JSON.stringify(task), store });
  ok(out.code === 200 && out.body.accepted === 1, 'webhook: post without secret (none configured) should be accepted');
  out = handleWebhook({ env: {}, headers: {}, contentType: 'text/plain', body: JSON.stringify(task), store });
  ok(out.code === 415, 'webhook: non-JSON content-type should be refused');
  // Secret configured
  const env = { WEBHOOK_SECRET: 'test-secret-ok' };
  out = handleWebhook({ env, headers: {}, contentType: json, body: JSON.stringify({ ...task, id: 'w2' }), store });
  ok(out.code === 401, 'webhook: missing secret should be 401');
  out = handleWebhook({ env, headers: { 'x-node-tower-secret': 'wrong' }, contentType: json, body: JSON.stringify({ ...task, id: 'w2' }), store });
  ok(out.code === 401, 'webhook: wrong secret should be 401');
  out = handleWebhook({ env, headers: { 'x-node-tower-secret': 'test-secret-ok' }, contentType: json, body: JSON.stringify({ tasks: [{ id: 'w3', owner: 'Vega', status: 'blocked', title: 'Webhook blocked task' }, { id: 'w4', owner: 'Quill', status: 'canceled', title: 'Webhook canceled' }] }), store });
  ok(out.code === 200 && out.body.accepted === 2 && out.body.stored === 3, 'webhook: post with secret should be accepted');
  out = handleWebhook({ env: {}, headers: {}, contentType: json, body: '{bad', store });
  ok(out.code === 400, 'webhook: bad JSON should be 400');
  const r = await run({ FEED_SOURCE: 'webhook' }, { webhookStore: store });
  ok(r.source === 'webhook', 'webhook: stored tasks should be served');
  ok(botOf(r.snapshot, 'echo').status === 'working' && botOf(r.snapshot, 'vega').status === 'blocked', 'webhook: task mapping');
  ok(r.snapshot.completedTaskIds.includes('w4'), 'webhook: canceled -> done');
  out = handleWebhook({ env: {}, headers: {}, contentType: json, body: JSON.stringify({ id: 'w1', delete: true }), store });
  ok(out.body.removed === 1 && store.size() === 2, 'webhook: delete by id');
  console.log('  webhook: post with and without secret, wrong secret 401, bad JSON 400, served as feed');
}

function checkUnits() {
  for (const s of ['done', 'Closed', 'COMPLETE', 'completed', 'cancelled', 'canceled']) ok(normalizeStatus(s) === 'done', `status ${s} should be done`);
  for (const s of ['blocked', 'On Hold', 'at risk']) ok(normalizeStatus(s) === 'blocked', `status ${s} should be blocked`);
  for (const s of ['', 'to do', 'in progress', 'review', 'threshold check']) ok(normalizeStatus(s) === 'working', `status "${s}" should be working`);
  ok(normalizeDue('2026-12-01') === '2026-12-01T00:00:00.000Z' && normalizeDue('nope') === null && normalizeDue(null) === null, 'due normalization');
  ok(parseCsv('a,b\n"x, y","z ""q"""\n')[1].join('|') === 'x, y|z "q"', 'csv parser');
  const snap = tasksToSnapshot([{ id: 'u1', owner: 'Nobody Here', status: 'working', title: 'Unmatched owner' }]);
  ok(snap.packets.length === 0 && snap.stats.unmatched === 1, 'unmatched owners are skipped and counted');
  const keys = ['schemaVersion', 'completedTaskIds', 'synthetic', 'generatedAt', 'floors', 'rooms', 'walkways', 'lifts', 'bots', 'packets', 'events'];
  ok(keys.every((k) => k in snap), 'snapshot keeps the app schema');
}

function checkMockShape() {
  const rooms = new Set(ROOMS.map((r) => r.id)), bots = new Set(BOTS.map((b) => b.id));
  const valid = (e) => e && EVENT_TYPES.includes(e.type) && [e.fromRoom, e.toRoom, e.room].filter(Boolean).every((r) => rooms.has(r)) && [e.fromBot, e.toBot, e.bot].filter(Boolean).every((b) => bots.has(b)) && e.task && e.task.business && (e.type === 'blocked' || (e.packetId && (!e.route || e.route.path.every(Boolean))));
  const fast = createFeed({ seed: 7 }); const seen = new Set(); let bad = 0; let liftUsed = false; let activityBad = 0;
  const toolOk = (snap) => snap.bots.every((b) => (b.status === 'working') === (!!b.activity && !!b.startedAt && !isNaN(Date.parse(b.startedAt))));
  for (let i = 0; i < 300; i++) {
    const e = fast.next();
    if (!toolOk(fast.snapshot())) activityBad++;
    if (!e) continue;
    if (!valid(e)) { bad++; console.log('BAD', JSON.stringify(e)); }
    else {
      seen.add(e.type);
      if (e.route && e.route.path.includes('lift-core-f1-f2')) liftUsed = true;
      if (e.type === 'done' && (e.toRoom !== 'hq' || !e.route.path.includes('lift-core-f4-hq'))) { bad++; console.log('BAD done', JSON.stringify(e)); }
    }
  }
  const snap = fast.snapshot();
  const apiClean = !('workflows' in snap) && !JSON.stringify(snap).match(/workflowId|"stage/);
  const pass = bad === 0 && EVENT_TYPES.every((x) => seen.has(x)) && liftUsed && apiClean && activityBad === 0;
  console.log('  demo engine: ' + JSON.stringify({ invalid: bad, typesSeen: [...seen], apiClean, liftUsed, activityBad }));
  ok(pass, 'mock feed shape check failed');
}

const realFetch = globalThis.fetch;
globalThis.fetch = offline; // belt and braces: nothing in this script may reach the network
try {
  console.log('feed:check (offline)');
  checkUnits();
  await checkDemo();
  await checkFile();
  await checkSheet();
  await checkClickUp();
  await checkTrello();
  await checkNotion();
  await checkWebhook();
  checkMockShape();
  noLeak({}, 'logs');
  console.log(`  fallback log lines: ${logs.length} (no secrets)`);
  console.log(`PASS (${checks} checks)`);
} catch (err) {
  console.error('FAIL', err && err.message ? err.message : err);
  process.exitCode = 1;
} finally {
  globalThis.fetch = realFetch;
}
