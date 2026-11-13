# Node Tower

Node Tower is a live 3D office tower for your bots or your team. Each floor is a
department, each bot sits at a desk, and tasks move between rooms as packets
you can watch. It runs locally in the browser (Vite + React 18 + three.js) with
a small Node feed server that reads your tasks from one source:

- demo data (default, works out of the box)
- a local JSON or CSV file
- a Google Sheet published as CSV
- ClickUp, Trello or Notion (read-only)
- a webhook you push tasks to

## Quick start

Needs Node 18 or newer.

```
npm install
npm run feed:serve      # feed server on http://127.0.0.1:8788 (demo data by default)
npm run build
npm run preview         # app on http://localhost:4173
```

For development use `npm run dev` (http://localhost:5173) instead of build + preview.
If the feed server is not running, the app falls back to its built-in demo feed.

Checks (offline, no network):

```
npm run feed:check      # prints PASS
```

## Choosing a source

Copy `server/.env.example` to `server/.env` and set `FEED_SOURCE` plus the lines
for that source. Restart `npm run feed:serve` after editing.

If a setting is missing or the source fails, the server logs one line such as
`feed: clickup unavailable (ClickUp GET failed (HTTP 401)), using DEMO DATA`
and serves demo data. Tokens are never printed.

Every source produces the same normalized task:

```
{ "id": "123", "owner": "Nova", "status": "working", "title": "Write docs", "due": "2026-12-01T00:00:00.000Z" }
```

- `status` is `working`, `blocked` or `done`. Source statuses are mapped:
  done, closed, complete, completed, cancelled, canceled (and archived, resolved, shipped) -> `done`;
  blocked, on hold, at risk, waiting, stuck, update required -> `blocked`; anything else -> `working`.
- `owner` must match a bot `name` or `id` in `src/feed/mockData.js` (case and
  punctuation ignored). Tasks with an unknown owner are skipped and counted in
  the server log. Rename the bots in `BOTS` to match your people or agents.
- `due` is an ISO date string or null.

### demo (default)

```
FEED_SOURCE=demo
```

### file (local JSON or CSV)

```
FEED_SOURCE=file
FEED_FILE=examples/tasks.example.json
```

`FEED_FILE` is absolute or relative to the repo root. JSON is an array of tasks
or `{ "tasks": [...] }`. CSV needs a header row; columns `id,owner,status,title,due`
(aliases such as name, assignee, state, deadline also work). See
`examples/tasks.example.json` and `examples/tasks.example.csv`. The file is
re-read every `FEED_POLL_MS` (default 10000).

### sheet (Google Sheet published as CSV)

```
FEED_SOURCE=sheet
SHEET_CSV_URL=https://docs.google.com/spreadsheets/d/e/YOUR_PUBLISHED_ID/pub?output=csv
```

In Google Sheets: File > Share > Publish to web > pick the sheet > CSV. Use the
same columns as the CSV file. No auth is used, so anyone with the link can read
the sheet; do not put private data in it.

### clickup

```
FEED_SOURCE=clickup
CLICKUP_TOKEN=your_personal_api_token
CLICKUP_LIST_ID=123456789
```

Token: ClickUp > Settings > Apps > API Token. The list id is the number in the
list URL. Only GET requests are made. Owner comes from a tag that matches a bot
name, else `owner: Name` at the end of the task name, else the first assignee.

### trello

```
FEED_SOURCE=trello
TRELLO_KEY=your_api_key
TRELLO_TOKEN=your_token
TRELLO_BOARD_ID=abc123XY
```

Create a key and token from https://trello.com/power-ups/admin (generate a
read-only token if you can). The board id is the short code in the board URL.
Only GET requests are made, and credentials go in a header, not the URL.
Owner comes from a card member whose name matches a bot, else a matching label,
else the first member. Archived cards, completed due dates and lists named like
Done -> done; lists or labels named like Blocked or Waiting -> blocked.

### notion

```
FEED_SOURCE=notion
NOTION_TOKEN=your_internal_integration_token
NOTION_DATABASE_ID=0123456789abcdef0123456789abcdef
NOTION_OWNER_PROP=Owner
NOTION_STATUS_PROP=Status
NOTION_TITLE_PROP=
NOTION_DUE_PROP=Due
```

Create an internal integration at https://www.notion.so/my-integrations with
read content only, then share the database with it. The only call is the
read-only `POST /v1/databases/{id}/query`. Property names are optional; the
title defaults to the database's title column. Owner can be a person, select,
text or multi-select property; status can be status, select, text or a checkbox
(checked = done).

### webhook

```
FEED_SOURCE=webhook
WEBHOOK_SECRET=a_long_random_string
```

The feed server accepts `POST /api/webhook` (Content-Type: application/json).
Tasks are kept in memory only and are lost on restart. Until the first task
arrives, demo data is shown. If `WEBHOOK_SECRET` is set, send it in the
`X-Node-Tower-Secret` header (compared in constant time); wrong or missing -> 401.

Payload: one task, an array of tasks, or an object with a `tasks` array. Tasks
are upserted by `id` (required). Add `"replace": true` to replace the whole list,
or send `{ "id": "t-1", "delete": true }` to remove one task.

```
curl -X POST http://127.0.0.1:8788/api/webhook \
  -H 'Content-Type: application/json' \
  -H 'X-Node-Tower-Secret: a_long_random_string' \
  -d '{"tasks":[{"id":"t-1","owner":"Nova","status":"in progress","title":"Write docs","due":"2026-12-01"}]}'
```

## Feed server API

- `GET /api/health` -> `{ ok, status, schemaVersion, synthetic, source, requested }`
- `GET /api/snapshot` -> full state (floors, rooms, walkways, lifts, bots, packets, events)
- `GET /api/events` -> server-sent events, one `feed` event per change
- `POST /api/webhook` -> only when `FEED_SOURCE=webhook`

The server listens on 127.0.0.1:8788 only. Vite (dev and preview) proxies `/api`
to it.

## Security

- Tokens live only in `server/.env`, which is gitignored. Never commit it, paste
  it in chat, or put tokens in front-end code. `server/.env.example` holds
  placeholders only.
- ClickUp, Trello and Notion tokens can have broad access to your whole account.
  Use the narrowest token available (read-only scopes, a dedicated integration,
  access to one list, board or database).
- Remote sources are read-only: ClickUp and Trello use GET; Notion uses its
  read-only database query.
- If you expose the webhook beyond your own machine, set `WEBHOOK_SECRET`.

## Project layout

- `src/` - app (scene in `src/scene`, HUD in `src/hud`, demo feed in `src/feed`)
- `server/feed-server.mjs` - feed server
- `server/connectors/` - one module per source, each exports `fetchTasks(env, opts)`
- `server/normalize.mjs` - status mapping and task -> snapshot mapping
- `scripts/feed-check.mjs` - offline checks
- `examples/` - sample task files

## Credits

Built by SMSnow - https://smsnow.ai

## License

MIT. See LICENSE.
