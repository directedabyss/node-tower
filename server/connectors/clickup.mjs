// clickup: your own ClickUp personal token + one list. GET requests only, no writes.
// CLICKUP_TOKEN=your_token (keep in server/.env)   CLICKUP_LIST_ID=123456789
// Owner: a tag that matches a roster bot, else "owner: Name" at the end of the task name, else the first assignee.
import { requireEnv, ConfigError } from '../env.mjs';
import { fetchJson } from '../http.mjs';
import { matchBot, normalizeStatus, normalizeTasks } from '../normalize.mjs';

export const name = 'clickup';
export const envKeys = ['CLICKUP_TOKEN', 'CLICKUP_LIST_ID'];
const API = 'https://api.clickup.com/api/v2';

const tagName = (t) => (typeof t === 'string' ? t : (t && t.name) || '');

export function ownerOf(task) {
  for (const t of (task.tags || []).map(tagName)) if (matchBot(t)) return t;
  const m = String(task.name || '').match(/owner:\s*(.+)$/i);
  if (m) return m[1].trim();
  const a = (task.assignees || [])[0];
  return a ? String(a.username || a.email || a.id || '') : '';
}

export function statusOf(task) {
  const st = task && task.status;
  const label = typeof st === 'string' ? st : (st && st.status) || '';
  const type = st && typeof st === 'object' ? String(st.type || '').toLowerCase() : '';
  if (type === 'done' || type === 'closed') return { status: 'done', label };
  return { status: normalizeStatus(label), label };
}

export function toRawTask(task) {
  const { status, label } = statusOf(task);
  const title = String(task.name || 'Untitled').replace(/\s*-\s*owner:\s*.+$/i, '').trim() || 'Untitled';
  const dueMs = task.due_date != null && task.due_date !== '' ? Number(task.due_date) : null;
  const blocker = status === 'blocked' ? (/update required/i.test(label) ? 'Waiting on Owner' : label || 'Blocked') : '';
  return { id: String(task.id), owner: ownerOf(task), status, title, due: Number.isFinite(dueMs) ? dueMs : null, blocker };
}

export async function fetchTasks(env, opts = {}) {
  requireEnv(env, envKeys, name);
  const listId = String(env.CLICKUP_LIST_ID);
  if (!/^\d+$/.test(listId)) throw new ConfigError('clickup: CLICKUP_LIST_ID must be digits');
  const headers = { Authorization: env.CLICKUP_TOKEN };
  const raw = [];
  for (let page = 0; page < 50; page++) {
    const url = `${API}/list/${listId}/task?include_closed=true&subtasks=true&page=${page}`;
    const body = await fetchJson(url, { method: 'GET', headers, label: 'ClickUp GET', fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs });
    const batch = Array.isArray(body.tasks) ? body.tasks : [];
    raw.push(...batch);
    if (body.last_page === true || batch.length === 0) return normalizeTasks(raw.map(toRawTask));
  }
  throw new Error('clickup: task pagination incomplete');
}
