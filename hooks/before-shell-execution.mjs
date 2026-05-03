#!/usr/bin/env node
// Cursor `beforeShellExecution` hook — replaces the static permissions-deny
// rules from the Claude Code plugin's lib/permissions-template.json (Cursor
// has no `permissions.deny` equivalent, so we gate destructive operations
// with a hook that returns `{ permission: "deny", ... }`).
//
// Coverage:
//   1. `lua auth key*`     — would print API key to stdout (transcript leak)
//   2. `--auto-deploy`     — bypasses the §3.3 confirmation contract
//   3. bare `lua deploy`   — must be prefixed with LUA_DEPLOY_CONFIRMED=1
//                            (set by confirm-deploy.mjs after the user OKs the
//                             5-step gated ship via /lua-deploy)
//
// Input (stdin JSON, per https://cursor.com/docs/agent/hooks):
//   { command, cwd, sandbox, conversation_id, generation_id, ... }
//
// Output (stdout JSON):
//   { permission: "allow"|"deny"|"ask", user_message?, agent_message? }
//
// Exit code 0 = use the JSON above. Exit code 2 = block (Claude Code compat).

import { stdin } from 'node:process';

async function readStdin() {
  let raw = '';
  for await (const chunk of stdin) raw += chunk;
  return raw;
}

function deny(user_message, agent_message) {
  console.log(JSON.stringify({ permission: 'deny', user_message, agent_message }));
  process.exit(0);
}

function allow() {
  console.log(JSON.stringify({ permission: 'allow' }));
  process.exit(0);
}

let input;
try {
  const raw = await readStdin();
  input = raw ? JSON.parse(raw) : {};
} catch {
  // Malformed input — fail-open per Cursor's "Other codes: Fail-open" convention.
  // Better to let the command run than to block the entire shell on a parse glitch.
  allow();
}

const cmd = input.command || '';

// 1. lua auth key — never. The CLI writes the API key to stdout, which would
// put it in the chat transcript permanently. If the user genuinely wants their
// key, they run this in a private terminal.
if (/\blua\s+auth\s+key\b/.test(cmd)) {
  deny(
    'Refused to run `lua auth key*` — the CLI prints your API key to stdout and that would leak it into the chat transcript. If you genuinely need to read your key, run it yourself in a private terminal.',
    'Blocked by Lua plugin: `lua auth key*` would leak credentials to the transcript. Tell the user to run it in a private terminal if they truly need the value.'
  );
}

// 2. --auto-deploy — never. Bypasses the §3.3 confirmation contract.
if (/--auto-deploy\b/.test(cmd)) {
  deny(
    'Refused to run a command containing `--auto-deploy`. The §3.3 deploy-safety contract requires explicit user confirmation before any production deploy. Use `/lua-deploy` (which walks the gated 5-step ship sequence) or run `lua deploy` directly without `--auto-deploy`.',
    'Blocked by Lua plugin: --auto-deploy bypasses the §3.3 deploy confirmation gate. Use /lua-deploy instead.'
  );
}

// 3. Bare `lua deploy` — only allowed when LUA_DEPLOY_CONFIRMED=1 is set
// inline (which the confirm-deploy.mjs hook does after the user OKs the
// /lua-deploy gated flow). Inspect the command string itself rather than
// process.env, because the env-var prefix is what's about to run, not what's
// in the hook's own environment.
if (/\blua\s+deploy\b/.test(cmd) && !/\bLUA_DEPLOY_CONFIRMED=1\b/.test(cmd)) {
  deny(
    'Refused to run bare `lua deploy`. The §3.3 deploy-safety contract requires explicit user confirmation. Use `/lua-deploy` (which walks the gated 5-step ship sequence) or run with the confirmation env-var set: `LUA_DEPLOY_CONFIRMED=1 lua deploy …`.',
    'Blocked by Lua plugin: bare `lua deploy` requires §3.3 confirmation. Either invoke /lua-deploy or prefix the command with LUA_DEPLOY_CONFIRMED=1.'
  );
}

// All other commands matching the umbrella matcher pass through.
allow();
