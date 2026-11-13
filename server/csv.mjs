// Minimal RFC 4180 CSV parser (quoted fields, "" escapes, CRLF) and row -> raw task mapping.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  const s = String(text ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

// Header aliases, matched case-insensitively with spaces/underscores ignored.
const ALIASES = {
  id: ['id', 'taskid', 'key'],
  owner: ['owner', 'assignee', 'bot', 'assignedto'],
  status: ['status', 'state', 'stage'],
  title: ['title', 'name', 'task', 'summary'],
  due: ['due', 'duedate', 'deadline', 'dueat'],
  blocker: ['blocker', 'waitingon', 'note']
};
const keyOf = (h) => String(h || '').toLowerCase().replace(/[\s_\-]+/g, '');

export function csvToRawTasks(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map(keyOf);
  const col = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const idx = header.findIndex((h) => names.includes(h));
    if (idx >= 0) col[field] = idx;
  }
  if (col.title == null) throw new Error('CSV needs a title column (title, name or task)');
  return rows.slice(1).map((r, i) => {
    const get = (f) => (col[f] == null ? '' : String(r[col[f]] ?? '').trim());
    return { id: get('id') || `row-${i + 1}`, owner: get('owner'), status: get('status'), title: get('title'), due: get('due') || null, blocker: get('blocker') };
  });
}
