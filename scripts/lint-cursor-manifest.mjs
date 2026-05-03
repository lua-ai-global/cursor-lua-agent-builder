#!/usr/bin/env node
// Validates .cursor-plugin/plugin.json against Cursor's manifest schema (a
// subset — full schema at https://cursor.com/schemas/cursor-plugin/plugin.json).
//
// Catches the ship-blockers: missing required fields, wrong field types,
// invalid kebab-case `name`, unknown top-level keys (additionalProperties:
// false in the upstream schema).

import { readFile } from 'node:fs/promises';

const MANIFEST = '.cursor-plugin/plugin.json';

const KNOWN_FIELDS = new Set([
  '$schema',
  'name', 'displayName', 'description', 'version',
  'author', 'publisher', 'homepage', 'repository', 'license',
  'logo', 'keywords', 'category', 'tags',
  'commands', 'agents', 'skills', 'rules', 'hooks', 'mcpServers',
]);

const NAME_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

let failed = false;
const fail = (msg) => { console.error(`✗ ${MANIFEST}: ${msg}`); failed = true; };

let raw;
try { raw = await readFile(MANIFEST, 'utf8'); }
catch { fail('file not found at expected path'); process.exit(1); }

let manifest;
try { manifest = JSON.parse(raw); }
catch (e) { fail(`invalid JSON: ${e.message}`); process.exit(1); }

if (!manifest.name) {
  fail('missing required field `name`');
} else if (typeof manifest.name !== 'string') {
  fail(`\`name\` must be a string, got ${typeof manifest.name}`);
} else if (!NAME_RE.test(manifest.name)) {
  fail(`\`name\` "${manifest.name}" is not valid kebab-case (must match ${NAME_RE})`);
}

for (const key of Object.keys(manifest)) {
  if (!KNOWN_FIELDS.has(key)) {
    fail(`unknown field "${key}" — Cursor's schema uses additionalProperties:false`);
  }
}

if (manifest.author && typeof manifest.author === 'object' && !manifest.author.name) {
  fail('`author` is an object but missing required `name` subfield');
}

if (failed) {
  console.error('\nFix the manifest. Reference: https://github.com/cursor/plugins/blob/main/schemas/plugin.schema.json');
  process.exit(1);
}
console.log(`✓ .cursor-plugin/plugin.json: schema valid (${Object.keys(manifest).length} field(s) recognised, name="${manifest.name}").`);
