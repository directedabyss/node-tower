// Small fetch wrapper with a timeout. Error messages never include URLs, headers or bodies.
export async function fetchJson(url, { method = 'GET', headers = {}, body, fetchImpl = fetch, timeoutMs = 8000, label = 'request' } = {}) {
  const text = await fetchText(url, { method, headers: { Accept: 'application/json', ...headers }, body, fetchImpl, timeoutMs, label });
  try { return JSON.parse(text); } catch { throw new Error(`${label} returned non-JSON`); }
}

export async function fetchText(url, { method = 'GET', headers = {}, body, fetchImpl = fetch, timeoutMs = 8000, label = 'request' } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetchImpl(url, { method, headers, body, signal: ac.signal, redirect: 'follow' });
    } catch (err) {
      throw new Error(`${label} failed (${err && err.name === 'AbortError' ? 'timeout' : 'network error'})`);
    }
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`${label} failed (HTTP ${res.status})`);
      err.status = res.status;
      throw err;
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}
