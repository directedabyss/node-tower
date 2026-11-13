// notion: an internal integration token + one database shared with that integration.
// Read-only: the only call is POST /v1/databases/{id}/query, which queries and never writes.
// NOTION_TOKEN=...  NOTION_DATABASE_ID=32-hex id from the database URL
// Property names (optional): NOTION_OWNER_PROP=Owner NOTION_STATUS_PROP=Status NOTION_TITLE_PROP=(the title column) NOTION_DUE_PROP=Due
import { requireEnv, ConfigError } from '../env.mjs';
import { fetchJson } from '../http.mjs';
import { normalizeStatus, normalizeTasks } from '../normalize.mjs';

export const name = 'notion';
export const envKeys = ['NOTION_TOKEN', 'NOTION_DATABASE_ID'];
const API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const plain = (arr) => (Array.isArray(arr) ? arr.map((x) => x.plain_text || '').join('') : '');

// Reads a Notion property value as text (or boolean / date string for checkbox / date).
export function propValue(p) {
  if (!p || typeof p !== 'object') return '';
  switch (p.type) {
    case 'title': return plain(p.title);
    case 'rich_text': return plain(p.rich_text);
    case 'select': return p.select ? p.select.name : '';
    case 'status': return p.status ? p.status.name : '';
    case 'multi_select': return (p.multi_select || [])[0]?.name || '';
    case 'people': { const u = (p.people || [])[0]; return u ? (u.name || u.person?.email || u.id || '') : ''; }
    case 'date': return p.date ? p.date.start : '';
    case 'checkbox': return Boolean(p.checkbox);
    case 'formula': return p.formula ? (p.formula.string ?? p.formula.date?.start ?? p.formula.number ?? p.formula.boolean ?? '') : '';
    default: return '';
  }
}

export function toRawTask(page, props) {
  const P = page.properties || {};
  const titleKey = props.title && P[props.title] ? props.title : Object.keys(P).find((k) => P[k] && P[k].type === 'title');
  const statusVal = propValue(P[props.status]);
  let status;
  if (page.archived || page.in_trash) status = 'done';
  else if (typeof statusVal === 'boolean') status = statusVal ? 'done' : 'working';
  else status = normalizeStatus(statusVal);
  return {
    id: String(page.id),
    owner: String(propValue(P[props.owner]) || ''),
    status,
    title: String(titleKey ? propValue(P[titleKey]) : '') || 'Untitled',
    due: propValue(P[props.due]) || null,
    blocker: status === 'blocked' ? String(statusVal || 'Blocked') : ''
  };
}

export async function fetchTasks(env, opts = {}) {
  requireEnv(env, envKeys, name);
  const db = String(env.NOTION_DATABASE_ID).replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(db)) throw new ConfigError('notion: NOTION_DATABASE_ID must be the 32-character id');
  const props = {
    owner: env.NOTION_OWNER_PROP || 'Owner',
    status: env.NOTION_STATUS_PROP || 'Status',
    title: env.NOTION_TITLE_PROP || '',
    due: env.NOTION_DUE_PROP || 'Due'
  };
  const headers = { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
  const pages = [];
  let cursor;
  for (let i = 0; i < 50; i++) {
    const body = JSON.stringify(cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 });
    const res = await fetchJson(`${API}/databases/${db}/query`, { method: 'POST', headers, body, label: 'Notion query', fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs });
    pages.push(...(Array.isArray(res.results) ? res.results : []));
    if (!res.has_more || !res.next_cursor) return normalizeTasks(pages.map((p) => toRawTask(p, props)));
    cursor = res.next_cursor;
  }
  throw new Error('notion: pagination incomplete');
}
