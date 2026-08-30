#!/usr/bin/env node
// Validates that every server entry in mcp.json corresponds to a real,
// buildable source tree inside this repo. Mirrors the CC plugin's
// lint-mcp-config.mjs (which validates source presence, not the built
// artifact — the build artifact is gitignored and produced by CI).
//
// Lint contract per discovered server entry:
//   1. The args path must reference ./mcp/<name>/... (other layouts are
//      not handled — extend if a plugin adds another bundled MCP).
//   2. mcp/<name>/ must exist as a directory.
//   3. mcp/<name>/package.json must exist (the source tree must be a real
//      package — not just an empty stub).
//   4. If the args path ends in dist/server.js (or similar), the
//      mcp/<name>/package.json must declare a `build` script — CI relies
//      on this to produce the bundle for the release tarball.

import { readFile, stat } from 'node:fs/promises';

const CONFIG = 'mcp.json';

let failed = false;
const fail = (msg) => { console.error(`✗ ${msg}`); failed = true; };

let mcpDoc;
try {
  mcpDoc = JSON.parse(await readFile(CONFIG, 'utf8'));
} catch (err) {
  console.error(`✗ Could not read ${CONFIG}: ${err.message}`);
  process.exit(1);
}

const installer = await readFile('scripts/install.mjs', 'utf8');
if (/LUA_API_KEY\s*:\s*['"]\$\{env:LUA_API_KEY\}['"]/.test(installer)) {
  fail('scripts/install.mjs must not write the unsupported ${env:LUA_API_KEY} literal into ~/.cursor/mcp.json. Let the MCP process inherit the environment and use its credentials-file fallback.');
}

const servers = mcpDoc?.mcpServers ?? {};
const serverNames = Object.keys(servers);
if (serverNames.length === 0) {
  console.error(`✗ ${CONFIG} declares no servers`);
  process.exit(1);
}

for (const [name, server] of Object.entries(servers)) {
  if (!server.command) {
    fail(`${CONFIG}: server "${name}" missing \`command\``);
    continue;
  }
  if (Object.prototype.hasOwnProperty.call(server.env ?? {}, 'LUA_API_KEY')) {
    fail(`${CONFIG}: server "${name}" must inherit LUA_API_KEY instead of writing a literal interpolation string. Omitting this field also lets the MCP resolver fall back to ~/.lua-cli/credentials and .env.`);
  }
  if (!Array.isArray(server.args) || server.args.length === 0) {
    // Allow servers with no args (e.g. an HTTP-based MCP referenced by URL).
    continue;
  }

  const entry = server.args[0];
  // Skip env-var or absolute paths (those resolve at runtime).
  if (entry.startsWith('${') || entry.startsWith('/')) continue;

  // Expected layout: ./mcp/<name>/... — derive the source-tree dir.
  const m = entry.match(/^\.\/mcp\/([^/]+)\//);
  if (!m) {
    fail(`${CONFIG}: server "${name}" has unfamiliar args path "${entry}". Expected ./mcp/<name>/...`);
    continue;
  }
  const dir = `mcp/${m[1]}`;

  try {
    const st = await stat(dir);
    if (!st.isDirectory()) fail(`${CONFIG}: ${dir} exists but is not a directory`);
  } catch {
    fail(`${CONFIG}: server "${name}" references ${entry}, but ${dir}/ does not exist (no source tree).`);
    continue;
  }

  // package.json check
  let pkg;
  try {
    pkg = JSON.parse(await readFile(`${dir}/package.json`, 'utf8'));
  } catch {
    fail(`${CONFIG}: ${dir}/package.json missing — the MCP source tree must be a real package.`);
    continue;
  }

  // If the args reference a build artifact (dist/<x>.js or build/<x>.js),
  // the package must declare a build script so CI can produce it.
  if (/\/(dist|build)\//.test(entry)) {
    if (!pkg.scripts?.build) {
      fail(`${CONFIG}: server "${name}" references built artifact ${entry}, but ${dir}/package.json has no \`build\` script.`);
    }
  }
}

if (failed) {
  console.error(`\nFix the references above. Each MCP server in ${CONFIG} must point at a real source tree under mcp/<name>/ with a package.json (and a build script if shipping a bundled artifact).`);
  process.exit(1);
}
console.log(`✓ ${CONFIG}: all ${serverNames.length} server(s) resolve to real, buildable source trees.`);
