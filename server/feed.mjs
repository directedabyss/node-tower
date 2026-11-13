// Feed loader: FEED_SOURCE picks the connector; anything missing or failing falls back to demo data.
// Log lines name the source and the reason only. Secrets are redacted and never printed.
import { getEnv, secretsOf, safeError } from './env.mjs';
import { CONNECTORS, SOURCES } from './connectors/index.mjs';
import { tasksToSnapshot, demoSnapshot } from './normalize.mjs';

export function selectedSource(env) {
  const s = String(env.FEED_SOURCE || 'demo').toLowerCase().trim();
  return SOURCES.includes(s) ? s : null;
}

function demo(opts, extra = {}) {
  return { snapshot: demoSnapshot(opts), source: 'demo', reason: 'DEMO DATA', synthetic: true, ...extra };
}

// opts: { env (overrides), fileEnv, fetchImpl, timeoutMs, webhookStore, root, now, log }
export async function loadFeed(opts = {}) {
  const env = getEnv({ env: opts.env ?? process.env, fileEnv: opts.fileEnv });
  const log = opts.log || ((line) => console.log(line));
  const secrets = secretsOf(env);
  const source = selectedSource(env);
  if (source === null) {
    const msg = `feed: unknown FEED_SOURCE, using DEMO DATA (valid: ${SOURCES.join(', ')})`;
    log(msg);
    return demo(opts, { fallback: true, requested: 'unknown', error: 'unknown FEED_SOURCE' });
  }
  if (source === 'demo') return demo(opts, { requested: 'demo' });
  try {
    const tasks = await CONNECTORS[source].fetchTasks(env, opts);
    const snapshot = tasksToSnapshot(tasks, opts);
    return { snapshot, source, reason: null, synthetic: false, requested: source, stats: snapshot.stats };
  } catch (err) {
    const error = safeError(err, secrets);
    log(`feed: ${source} unavailable (${error}), using DEMO DATA`);
    return demo(opts, { fallback: true, requested: source, error });
  }
}
