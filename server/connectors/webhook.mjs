// webhook: push tasks to the feed server with POST /api/webhook. Tasks live in memory only
// (lost on restart). Optional WEBHOOK_SECRET, sent in the X-Node-Tower-Secret header.
import crypto from 'node:crypto';
import { normalizeTask } from '../normalize.mjs';

export const name = 'webhook';
export const envKeys = [];
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_TASKS = 1000;

export function createWebhookStore() {
  const tasks = new Map();
  return {
    tasks,
    size: () => tasks.size,
    list: () => [...tasks.values()],
    clear: () => tasks.clear()
  };
}

// Shared default store used by the feed server.
export const defaultStore = createWebhookStore();

export function secretMatches(expected, given) {
  const a = crypto.createHash('sha256').update(String(expected)).digest();
  const b = crypto.createHash('sha256').update(String(given ?? '')).digest();
  return crypto.timingSafeEqual(a, b);
}

// Payload: one task object, an array of tasks, or { "tasks": [...], "replace": true|false }.
// Tasks are upserted by id. With "replace": true the stored list is replaced.
// Send { "id": "...", "delete": true } to remove one task.
export function handleWebhook({ env = {}, headers = {}, contentType = '', body = '', store = defaultStore } = {}) {
  const secret = env.WEBHOOK_SECRET || '';
  if (secret && !secretMatches(secret, headers['x-node-tower-secret'])) return { code: 401, body: { ok: false, error: 'bad or missing secret' } };
  if (!/^application\/json\b/i.test(String(contentType || ''))) return { code: 415, body: { ok: false, error: 'content-type must be application/json' } };
  if (Buffer.byteLength(String(body)) > MAX_BODY_BYTES) return { code: 413, body: { ok: false, error: 'payload too large' } };
  let data;
  try { data = JSON.parse(String(body)); } catch { return { code: 400, body: { ok: false, error: 'invalid JSON' } }; }
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.tasks) ? data.tasks : (data && typeof data === 'object' ? [data] : null));
  if (!list) return { code: 400, body: { ok: false, error: 'expected a task, an array, or { "tasks": [...] }' } };
  if (data && data.replace === true) store.clear();
  let accepted = 0, removed = 0, rejected = 0;
  for (const raw of list) {
    if (raw && raw.delete === true && raw.id != null) { if (store.tasks.delete(String(raw.id))) removed++; continue; }
    const t = normalizeTask(raw, store.size());
    if (!t || raw.id == null) { rejected++; continue; }
    if (!store.tasks.has(t.id) && store.size() >= MAX_TASKS) { rejected++; continue; }
    store.tasks.set(t.id, t);
    accepted++;
  }
  return { code: 200, body: { ok: true, accepted, removed, rejected, stored: store.size() } };
}

export async function fetchTasks(env, opts = {}) {
  const store = opts.webhookStore || defaultStore;
  if (store.size() === 0) throw new Error('webhook: no tasks received yet');
  return store.list();
}
