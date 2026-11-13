// SYNTHETIC DEMO DATA ONLY. Generic names; no real people, companies or tasks.
// Edit BOTS (names and ids) to match the owner names in your own task source:
// live connectors place a task on the bot whose name or id matches the task owner.
export const SCHEMA_VERSION = 2;
export const EVENT_TYPES = ['assign', 'handoff', 'review', 'blocked', 'done'];

// 4 office floors + HQ penthouse. Flow: INTAKE -> departments -> REVIEW -> elevator -> HQ (the outbox).
// Rooms are ordered bottom to top; packets move along that order, by walkway on a floor and by lift between floors.
export const FLOORS = [
  { id: 'f1', level: 1, name: 'Marketing' },
  { id: 'f2', level: 2, name: 'Engineering and Sales' },
  { id: 'f3', level: 3, name: 'Research Lab' },
  { id: 'f4', level: 4, name: 'Operations' },
  { id: 'hq', level: 5, name: 'Penthouse HQ', penthouse: true }
];
export const ROOMS = [
  { id: 'intake', name: 'INTAKE', floor: 'f1', order: 0, kind: 'intake' },
  { id: 'content', name: 'Marketing', floor: 'f1', order: 1, kind: 'department' },
  { id: 'dev', name: 'Engineering', floor: 'f2', order: 2, kind: 'department' },
  { id: 'sales', name: 'Sales', floor: 'f2', order: 3, kind: 'department' },
  { id: 'research', name: 'Research', floor: 'f3', order: 4, kind: 'department' },
  { id: 'ops', name: 'Operations', floor: 'f4', order: 5, kind: 'department' },
  { id: 'support', name: 'Support', floor: 'f4', order: 6, kind: 'department' },
  { id: 'review', name: 'REVIEW', floor: 'f4', order: 7, kind: 'review' },
  { id: 'hq', name: 'HQ', floor: 'hq', order: 8, kind: 'hq', outbox: true }
];
// Walkways join rooms on the same floor; the elevator (shaft 'core') joins floors.
export const WALKWAYS = [['intake', 'content'], ['dev', 'sales'], ['ops', 'support'], ['support', 'review']]
  .map(([from, to]) => ({ id: `walkway-${from}-${to}`, from, to }));
export const LIFTS = [['content', 'dev'], ['sales', 'research'], ['research', 'ops'], ['review', 'hq']]
  .map(([from, to]) => {
    const f = ROOMS.find((r) => r.id === from).floor, t = ROOMS.find((r) => r.id === to).floor;
    return { id: `lift-core-${f}-${t}`, shaft: 'core', floors: [f, t], fromRoom: from, toRoom: to };
  });

// role: 'ceo' renders as the lead bot; 'agent' renders as a regular agent.
export const CEO_BOT_ID = 'atlas';
export const BOTS = [
  { id: 'atlas', name: 'Atlas', department: 'HQ', room: 'hq', business: 'Internal' },
  { id: 'nova', name: 'Nova', department: 'Engineering', room: 'dev', business: 'Internal' },
  { id: 'echo', name: 'Echo', department: 'Engineering', room: 'dev', business: 'Internal' },
  { id: 'orion', name: 'Orion', department: 'Engineering', room: 'dev', business: 'Internal' },
  { id: 'lyra', name: 'Lyra', department: 'Engineering', room: 'dev', business: 'Internal' },
  { id: 'quill', name: 'Quill', department: 'Marketing', room: 'content', business: 'Internal' },
  { id: 'pixel', name: 'Pixel', department: 'Marketing', room: 'content', business: 'Internal' },
  { id: 'vega', name: 'Vega', department: 'Operations', room: 'ops', business: 'Operations' },
  { id: 'juno', name: 'Juno', department: 'Support', room: 'support', business: 'Support' },
  { id: 'titan', name: 'Titan', department: 'Sales', room: 'sales', business: 'Sales' },
  { id: 'sol', name: 'Sol', department: 'Sales', room: 'sales', business: 'Sales' },
  { id: 'iris', name: 'Iris', department: 'Research', room: 'research', business: 'Research' },
  { id: 'sentry', name: 'Sentry', department: 'QA', room: 'review', business: 'Internal' }
];
export const BOT_STATUSES = ['idle', 'working', 'blocked', 'handing_off'];
// Synthetic activity labels for working bots (e.g. WEB_SEARCH).
export const TOOLS = ['WEB_SEARCH', 'READ_FILE', 'WRITE_FILE', 'CODE_EDIT', 'RUN_TESTS', 'DRAFT_DOC', 'FEED_READ', 'RENDER'];

export const TASK_TITLES = [
  'Draft sample landing page', 'Fix demo signup form', 'Review weekly metrics', 'Edit demo video',
  'Update sample price list', 'Test new workflow', 'Write example post', 'Prepare demo newsletter'
];

// Internal handoff chains for the synthetic feed only: who hands a task to whom, in order.
// Each step is a room plus the bot that works it. Not part of the API output.
export const HANDOFF_CHAINS = [
  { business: 'Internal',
    stages: [{ room: 'intake', bot: 'atlas' }, { room: 'content', bot: 'quill' }, { room: 'content', bot: 'pixel' }, { room: 'review', bot: 'sentry' }, { room: 'hq', bot: null }] },
  { business: 'Sales',
    stages: [{ room: 'intake', bot: 'atlas' }, { room: 'dev', bot: 'nova' }, { room: 'dev', bot: 'echo' }, { room: 'sales', bot: 'titan' }, { room: 'review', bot: 'sentry' }, { room: 'hq', bot: null }] },
  { business: 'Research',
    stages: [{ room: 'intake', bot: 'atlas' }, { room: 'dev', bot: 'orion' }, { room: 'dev', bot: 'lyra' }, { room: 'research', bot: 'iris' }, { room: 'review', bot: 'sentry' }, { room: 'hq', bot: null }] },
  { business: 'Operations',
    stages: [{ room: 'intake', bot: 'atlas' }, { room: 'ops', bot: 'vega' }, { room: 'review', bot: 'sentry' }, { room: 'hq', bot: null }] },
  { business: 'Support',
    stages: [{ room: 'intake', bot: 'atlas' }, { room: 'support', bot: 'juno' }, { room: 'review', bot: 'sentry' }, { room: 'hq', bot: null }] }
];
