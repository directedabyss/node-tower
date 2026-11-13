// trello: your own Trello API key + token + one board. GET requests only, no writes.
// TRELLO_KEY=...  TRELLO_TOKEN=...  TRELLO_BOARD_ID=abc123 (from the board URL)
// Owner: a member whose name matches a roster bot, else a label that matches, else the first member.
// Status: archived card or done-like list name -> done; blocked-like list or label -> blocked; else working.
import { requireEnv, ConfigError } from '../env.mjs';
import { fetchJson } from '../http.mjs';
import { matchBot, normalizeStatus, normalizeTasks } from '../normalize.mjs';

export const name = 'trello';
export const envKeys = ['TRELLO_KEY', 'TRELLO_TOKEN', 'TRELLO_BOARD_ID'];
const API = 'https://api.trello.com/1';

export function ownerOf(card, membersById) {
  const members = (card.idMembers || []).map((id) => membersById.get(id)).filter(Boolean);
  for (const m of members) {
    if (matchBot(m.fullName)) return m.fullName;
    if (matchBot(m.username)) return m.username;
  }
  for (const l of card.labels || []) if (matchBot(l.name)) return l.name;
  const m = members[0];
  return m ? String(m.fullName || m.username || '') : '';
}

export function toRawTask(card, listsById, membersById) {
  const listName = (listsById.get(card.idList) || {}).name || '';
  const labelNames = (card.labels || []).map((l) => l.name || '');
  let status = normalizeStatus(listName);
  if (card.closed || card.dueComplete) status = 'done';
  else if (status !== 'done' && labelNames.some((n) => normalizeStatus(n) === 'blocked')) status = 'blocked';
  const blocker = status === 'blocked' ? (labelNames.find((n) => normalizeStatus(n) === 'blocked') || listName || 'Blocked') : '';
  return { id: String(card.id), owner: ownerOf(card, membersById), status, title: card.name || 'Untitled', due: card.due || null, blocker };
}

export async function fetchTasks(env, opts = {}) {
  requireEnv(env, envKeys, name);
  const board = String(env.TRELLO_BOARD_ID);
  if (!/^[A-Za-z0-9]+$/.test(board)) throw new ConfigError('trello: TRELLO_BOARD_ID must be letters and digits');
  // Credentials go in the Authorization header, not the URL, so they never land in logs.
  const headers = { Authorization: `OAuth oauth_consumer_key="${env.TRELLO_KEY}", oauth_token="${env.TRELLO_TOKEN}"` };
  const get = (p) => fetchJson(`${API}${p}`, { method: 'GET', headers, label: 'Trello GET', fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs });
  const [cards, lists, members] = await Promise.all([
    get(`/boards/${board}/cards/all?fields=name,idList,idMembers,labels,closed,due,dueComplete`),
    get(`/boards/${board}/lists?filter=all&fields=name,closed`),
    get(`/boards/${board}/members?fields=fullName,username`)
  ]);
  if (!Array.isArray(cards) || !Array.isArray(lists)) throw new Error('trello: unexpected response');
  const listsById = new Map(lists.map((l) => [l.id, l]));
  const membersById = new Map((Array.isArray(members) ? members : []).map((m) => [m.id, m]));
  return normalizeTasks(cards.map((c) => toRawTask(c, listsById, membersById)));
}
