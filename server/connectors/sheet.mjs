// sheet: a Google Sheet published to the web as CSV (File > Share > Publish to web > CSV). No auth.
// SHEET_CSV_URL=https://docs.google.com/spreadsheets/d/e/.../pub?output=csv
import { requireEnv, ConfigError } from '../env.mjs';
import { fetchText } from '../http.mjs';
import { csvToRawTasks } from '../csv.mjs';
import { normalizeTasks, normalizeStatus } from '../normalize.mjs';

export const name = 'sheet';
export const envKeys = ['SHEET_CSV_URL'];

export async function fetchTasks(env, opts = {}) {
  requireEnv(env, envKeys, name);
  let url;
  try { url = new URL(env.SHEET_CSV_URL); } catch { throw new ConfigError('sheet: SHEET_CSV_URL is not a valid URL'); }
  if (url.protocol !== 'https:') throw new ConfigError('sheet: SHEET_CSV_URL must use https');
  const text = await fetchText(url.toString(), { method: 'GET', headers: { Accept: 'text/csv' }, label: 'sheet GET', ...pick(opts) });
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('sheet: URL returned HTML, not CSV (publish the sheet as CSV)');
  const raw = csvToRawTasks(text);
  return normalizeTasks(raw.map((t) => ({ ...t, blocker: t.blocker || (normalizeStatus(t.status) === 'blocked' ? t.status : '') })));
}

function pick(opts) {
  const o = {};
  if (opts.fetchImpl) o.fetchImpl = opts.fetchImpl;
  if (opts.timeoutMs) o.timeoutMs = opts.timeoutMs;
  return o;
}
