#!/usr/bin/env node
// Catches `${CLAUDE_PLUGIN_ROOT}` references that slipped through the Claude
// Code → Cursor conversion. Cursor has no equivalent var; references would
// reach the LLM as literal strings and break path resolution.
//
// Allowed references: this lint script itself + historical commentary in
// vendored hook scripts (which still run unchanged on Cursor — see Phase D
// of the port plan).

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';

const NEEDLE = '${CLAUDE_PLUGIN_ROOT}';
const SCAN_DIRS = ['agents', 'skills', 'rules', 'commands', 'hooks', 'lib', '.cursor-plugin', 'mcp.json', 'README.md', 'docs'];
const SCAN_EXT = new Set(['.md', '.mdc', '.json', '.mjs', '.js', '.ts']);
const SELF_EXCLUDE = new Set(['lint-cursor-no-claude-root.mjs']);

let failed = false;

async function* walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.git')) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) yield* walk(path);
    else if (SCAN_EXT.has(extname(e.name))) yield path;
  }
}

let scanned = 0;
for (const target of SCAN_DIRS) {
  try {
    const st = await stat(target);
    const files = st.isDirectory() ? walk(target) : (async function* () { yield target; })();
    for await (const path of files) {
      if (SELF_EXCLUDE.has(basename(path))) continue;
      const content = await readFile(path, 'utf8');
      // Vendored hook scripts may still contain the literal in comments
      // describing how Claude Code resolves the var. Allow that in comments
      // but flag any uncommented reference (which would actually be evaluated).
      if (path.endsWith('.mjs') || path.endsWith('.js') || path.endsWith('.ts')) {
        const stripped = content
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        if (stripped.includes(NEEDLE)) {
          console.error(`✗ ${path}: contains ${NEEDLE} in executable code (Cursor has no equivalent var; reaches LLM as literal).`);
          failed = true;
        }
      } else {
        if (content.includes(NEEDLE)) {
          console.error(`✗ ${path}: contains ${NEEDLE} (Cursor has no equivalent var). Use a relative path or @-mention a rule instead.`);
          failed = true;
        }
      }
      scanned++;
    }
  } catch { /* missing — skip */ }
}

if (failed) {
  console.error('\nFix the above. The Claude Code → Cursor port replaces ${CLAUDE_PLUGIN_ROOT} with relative paths (./...) or rule attachments (@rule-name).');
  process.exit(1);
}
console.log(`✓ ${scanned} file(s) scanned; no \${CLAUDE_PLUGIN_ROOT} leakage.`);
