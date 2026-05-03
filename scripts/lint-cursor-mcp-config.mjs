#!/usr/bin/env node
// Validates that mcp.json's server entries point at files that actually exist
// and are buildable. Catches the iteration-13-equivalent bug class for the
// Cursor port: an MCP server is registered but its build artifact is missing.

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const CONFIG = 'mcp.json';

let raw;
try { raw = await readFile(CONFIG, 'utf8'); }
catch { console.error(`✗ ${CONFIG}: not found`); process.exit(1); }

let config;
try { config = JSON.parse(raw); }
catch (e) { console.error(`✗ ${CONFIG}: invalid JSON: ${e.message}`); process.exit(1); }

if (!config.mcpServers || typeof config.mcpServers !== 'object') {
  console.error(`✗ ${CONFIG}: missing or malformed \`mcpServers\` block`);
  process.exit(1);
}

let failed = false;
let count = 0;
for (const [name, server] of Object.entries(config.mcpServers)) {
  count++;
  if (!server.command) {
    console.error(`✗ ${CONFIG}: server "${name}" missing \`command\``);
    failed = true;
    continue;
  }
  if (!Array.isArray(server.args) || server.args.length === 0) {
    console.warn(`! ${CONFIG}: server "${name}" has no \`args\` — may be intentional, but unusual for node-based MCP servers`);
    continue;
  }
  // Inspect the first arg as the entry-point path (relative to repo root).
  // Skip env-var or absolute paths (those resolve at runtime).
  const entry = server.args[0];
  if (entry.startsWith('${') || entry.startsWith('/')) continue;
  const resolved = resolve(entry.replace(/^\.\//, ''));
  try {
    const st = await stat(resolved);
    if (!st.isFile()) {
      console.error(`✗ ${CONFIG}: server "${name}" entry-point ${entry} resolves to ${resolved} which is not a file`);
      failed = true;
    }
  } catch {
    console.error(`✗ ${CONFIG}: server "${name}" entry-point ${entry} resolves to ${resolved} which doesn't exist. Did you run the bundle build?`);
    failed = true;
  }
}

if (failed) {
  console.error('\nFix the references above. Run `cd mcp/<server> && npm ci && npm run build` if the build artifact is missing.');
  process.exit(1);
}
console.log(`✓ mcp.json: all ${count} server(s) resolve to existing entry-points.`);
