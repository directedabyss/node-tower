import * as file from './file.mjs';
import * as sheet from './sheet.mjs';
import * as clickup from './clickup.mjs';
import * as trello from './trello.mjs';
import * as notion from './notion.mjs';
import * as webhook from './webhook.mjs';

export const CONNECTORS = { file, sheet, clickup, trello, notion, webhook };
export const SOURCES = ['demo', ...Object.keys(CONNECTORS)];
