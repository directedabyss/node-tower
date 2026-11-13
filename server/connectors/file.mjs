// file: local JSON or CSV file. FEED_FILE=path (absolute, or relative to the repo root).
// JSON: an array of tasks, or { "tasks": [...] }. CSV: header row with id,owner,status,title,due.
import fs from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT, requireEnv } from '../env.mjs';
import { csvToRawTasks } from '../csv.mjs';
import { normalizeTasks, normalizeStatus } from '../normalize.mjs';

export const name = 'file';
export const envKeys = ['FEED_FILE'];

export async function fetchTasks(env, opts = {}) {
  requireEnv(env, envKeys, name);
  const file = path.resolve(opts.root || REPO_ROOT, env.FEED_FILE);
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch { throw new Error('file: could not read FEED_FILE'); }
  let raw;
  if (/\.csv$/i.test(file)) raw = csvToRawTasks(text);
  else {
    let body;
    try { body = JSON.parse(text); } catch { throw new Error('file: FEED_FILE is not valid JSON'); }
    raw = Array.isArray(body) ? body : (body && Array.isArray(body.tasks) ? body.tasks : null);
    if (!raw) throw new Error('file: JSON must be an array or { "tasks": [...] }');
  }
  return normalizeTasks(raw.map((t) => ({ ...t, blocker: t.blocker || (normalizeStatus(t.status) === 'blocked' ? t.status : '') })));
}
