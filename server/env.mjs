// Reads server/.env (simple KEY=value lines). process.env wins over the file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ENV_PATH = path.join(DIR, '.env');
export const REPO_ROOT = path.resolve(DIR, '..');

// Every variable whose value must never be printed.
export const SECRET_KEYS = ['CLICKUP_TOKEN', 'TRELLO_KEY', 'TRELLO_TOKEN', 'NOTION_TOKEN', 'WEBHOOK_SECRET'];

export function loadServerEnv(file = SERVER_ENV_PATH) {
  const out = {};
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// Merged config: server/.env first, then process.env on top. Values are trimmed strings.
export function getEnv({ env = process.env, fileEnv } = {}) {
  const file = fileEnv ?? loadServerEnv();
  const out = {};
  for (const [k, v] of Object.entries(file)) out[k] = String(v ?? '').trim();
  for (const [k, v] of Object.entries(env || {})) {
    if (v != null && String(v).trim() !== '') out[k] = String(v).trim();
  }
  return out;
}

export function secretsOf(env = {}) {
  return SECRET_KEYS.map((k) => env[k]).filter((v) => v && String(v).length >= 4);
}

export function redact(text, secrets = []) {
  let s = String(text ?? '');
  for (const secret of secrets) {
    const token = String(secret || '');
    if (!token) continue;
    s = s.split(token).join('[redacted]');
    try { s = s.split(encodeURIComponent(token)).join('[redacted]'); } catch { /* ignore */ }
  }
  return s;
}

export function safeError(err, secrets = []) {
  return redact(err && err.message ? err.message : String(err), secrets);
}

// Thrown when a source is selected but its settings are missing or invalid.
export class ConfigError extends Error {
  constructor(message) { super(message); this.name = 'ConfigError'; }
}

export function requireEnv(env, keys, source) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) throw new ConfigError(`${source}: missing ${missing.join(', ')} in server/.env`);
}
