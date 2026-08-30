#!/usr/bin/env node
// Install the plugin into the paths Cursor 2.6 actually discovers.
//
// Cursor's "plugin" wrapper concept (.cursor-plugin/plugin.json + auto-discovered
// folders) is documented for marketplace install but is not how local-install
// works in Cursor 2.6 (verified empirically 2026-05-03). The actual paths are:
//
//   Skills:  ~/.cursor/skills-cursor/<name>/SKILL.md     (each top-level)
//   MCP:     ~/.cursor/mcp.json                          (additive)
//   Hooks:   ~/.cursor/hooks.json                        (additive, this script
//                                                         creates if missing)
//
// This installer:
//   1. Symlinks each skill from skills/<name>/ into skills-cursor/<name>/
//   2. Adds the lua-platform MCP server to ~/.cursor/mcp.json (preserves
//      existing entries; backs up first)
//   3. Adds hook entries to ~/.cursor/hooks.json (creates if absent;
//      preserves existing entries; backs up first)
//
// Idempotent — safe to re-run after a `git pull`. Detects existing entries
// and updates them in place rather than duplicating.
//
// Usage (after `git clone` + `cd mcp/lua-platform && npm ci && npm run build`):
//   node scripts/install.mjs              # install
//   node scripts/install.mjs --uninstall  # remove

import { readFile, writeFile, mkdir, readdir, stat, symlink, rm, copyFile } from 'node:fs/promises';
import { join, basename, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..');
const HOME = homedir();
const SKILLS_DIR = join(HOME, '.cursor/skills-cursor');
const MCP_PATH = join(HOME, '.cursor/mcp.json');
const HOOKS_PATH = join(HOME, '.cursor/hooks.json');
const TS = Date.now();

const isUninstall = process.argv.includes('--uninstall');

const HOOK_TAG = '__cursor-lua-agent-builder';   // marker to identify our entries on uninstall

// ───────────────────────────────────────────────────────────────────────────────
// Logging
// ───────────────────────────────────────────────────────────────────────────────

const log = (msg) => console.log(msg);
const ok = (msg) => console.log(`✓ ${msg}`);
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

// ───────────────────────────────────────────────────────────────────────────────
// Pre-flight: confirm MCP server bundle exists
// ───────────────────────────────────────────────────────────────────────────────

async function preflight() {
  if (isUninstall) return;  // uninstall doesn't need the bundle

  const bundle = join(PLUGIN_ROOT, 'mcp/lua-platform/dist/server.js');
  try {
    await stat(bundle);
  } catch {
    fail(
      `MCP server bundle not found at ${bundle}.\n` +
      `Build it first:\n` +
      `  cd ${PLUGIN_ROOT}/mcp/lua-platform && npm ci && npm run build`
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Skills: symlink (or remove on uninstall)
// ───────────────────────────────────────────────────────────────────────────────

async function installSkills() {
  await mkdir(SKILLS_DIR, { recursive: true });
  const srcDir = join(PLUGIN_ROOT, 'skills');
  const skills = await readdir(srcDir, { withFileTypes: true });
  let count = 0;
  for (const e of skills) {
    if (!e.isDirectory()) continue;
    const target = join(srcDir, e.name);
    const link = join(SKILLS_DIR, e.name);
    try { await rm(link, { recursive: true, force: true }); } catch { /* ignore */ }
    await symlink(target, link);
    count++;
  }
  ok(`Linked ${count} skill(s) into ${SKILLS_DIR}/`);
}

async function uninstallSkills() {
  const srcDir = join(PLUGIN_ROOT, 'skills');
  let entries;
  try { entries = await readdir(srcDir); } catch { return; }
  let count = 0;
  for (const name of entries) {
    const link = join(SKILLS_DIR, name);
    try {
      await rm(link, { recursive: true, force: true });
      count++;
    } catch { /* not present */ }
  }
  ok(`Removed ${count} skill(s) from ${SKILLS_DIR}/`);
}

// ───────────────────────────────────────────────────────────────────────────────
// MCP: additive merge into ~/.cursor/mcp.json
// ───────────────────────────────────────────────────────────────────────────────

async function loadJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function backup(path) {
  try {
    await stat(path);
    const bak = `${path}.bak.${TS}`;
    await copyFile(path, bak);
    log(`  (backed up existing ${basename(path)} → ${basename(bak)})`);
  } catch { /* doesn't exist yet — no backup needed */ }
}

async function installMcp() {
  await backup(MCP_PATH);
  const cfg = await loadJson(MCP_PATH, {});
  cfg.mcpServers ||= {};
  cfg.mcpServers['lua-platform'] = {
    command: 'node',
    args: [join(PLUGIN_ROOT, 'mcp/lua-platform/dist/server.js')],
  };
  await writeFile(MCP_PATH, JSON.stringify(cfg, null, 2) + '\n');
  ok(`Added "lua-platform" to ${MCP_PATH} (preserved ${Object.keys(cfg.mcpServers).length - 1} existing server(s))`);
}

async function uninstallMcp() {
  const cfg = await loadJson(MCP_PATH, null);
  if (!cfg?.mcpServers?.['lua-platform']) {
    log(`  (no lua-platform entry in ${MCP_PATH} — skipping)`);
    return;
  }
  await backup(MCP_PATH);
  delete cfg.mcpServers['lua-platform'];
  await writeFile(MCP_PATH, JSON.stringify(cfg, null, 2) + '\n');
  ok(`Removed "lua-platform" from ${MCP_PATH}`);
}

// ───────────────────────────────────────────────────────────────────────────────
// Hooks: additive merge into ~/.cursor/hooks.json
// Each hook entry is tagged with `__source: HOOK_TAG` so uninstall can find ours.
// ───────────────────────────────────────────────────────────────────────────────

const HOOKS = {
  sessionStart: [
    { script: 'check-lua-version.mjs', timeout: 10 },
    { script: 'detect-project.mjs', timeout: 5 },
    { script: 'check-lua-auth.mjs', timeout: 15 },
  ],
  beforeSubmitPrompt: [
    { script: 'inject-context.mjs', timeout: 5 },
  ],
  beforeShellExecution: [
    { script: 'before-shell-execution.mjs', timeout: 30 },
    { script: 'confirm-deploy.mjs', timeout: 30 },
    { script: 'block-auto-deploy.mjs', timeout: 5 },
    { script: 'warn-version-zero.mjs', timeout: 5 },
  ],
  afterShellExecution: [
    { script: 'post-deploy-smoke.mjs', timeout: 60 },
    { script: 'post-compile-summary.mjs', timeout: 10 },
  ],
};

function entryFor(script, timeout) {
  return {
    command: `node ${join(PLUGIN_ROOT, 'hooks', script)}`,
    timeout,
    __source: HOOK_TAG,
  };
}

async function installHooks() {
  await backup(HOOKS_PATH);
  const cfg = await loadJson(HOOKS_PATH, { version: 1, hooks: {} });
  cfg.version ||= 1;
  cfg.hooks ||= {};

  let added = 0;
  for (const [event, entries] of Object.entries(HOOKS)) {
    cfg.hooks[event] ||= [];
    // Strip any previously-installed entries from us (idempotency)
    cfg.hooks[event] = cfg.hooks[event].filter((e) => e?.__source !== HOOK_TAG);
    for (const { script, timeout } of entries) {
      cfg.hooks[event].push(entryFor(script, timeout));
      added++;
    }
  }

  await writeFile(HOOKS_PATH, JSON.stringify(cfg, null, 2) + '\n');
  ok(`Installed ${added} hook entr(y/ies) into ${HOOKS_PATH}`);
}

async function uninstallHooks() {
  const cfg = await loadJson(HOOKS_PATH, null);
  if (!cfg?.hooks) {
    log(`  (no ${HOOKS_PATH} or no hooks block — skipping)`);
    return;
  }
  await backup(HOOKS_PATH);
  let removed = 0;
  for (const event of Object.keys(cfg.hooks)) {
    const before = cfg.hooks[event].length;
    cfg.hooks[event] = cfg.hooks[event].filter((e) => e?.__source !== HOOK_TAG);
    removed += before - cfg.hooks[event].length;
    // Clean up empty event arrays
    if (cfg.hooks[event].length === 0) delete cfg.hooks[event];
  }
  await writeFile(HOOKS_PATH, JSON.stringify(cfg, null, 2) + '\n');
  ok(`Removed ${removed} hook entr(y/ies) from ${HOOKS_PATH}`);
}

// ───────────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────────

await preflight();

log('');
log(isUninstall
  ? `Uninstalling cursor-lua-agent-builder (plugin source: ${PLUGIN_ROOT})`
  : `Installing cursor-lua-agent-builder (plugin source: ${PLUGIN_ROOT})`);
log('');

if (isUninstall) {
  await uninstallSkills();
  await uninstallMcp();
  await uninstallHooks();
} else {
  await installSkills();
  await installMcp();
  await installHooks();
}

log('');
ok(isUninstall ? 'Uninstall complete.' : 'Install complete.');
log('');
log('NEXT: fully quit Cursor (Cmd+Q on macOS, not just close-window) and');
log('reopen. Then in Composer, type "/lua-" — autocomplete should list all');
log('14 skills. Ask "what MCP tools do you have?" to verify lua-platform.');
log('');
