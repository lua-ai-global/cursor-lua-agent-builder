// Cursor `beforeShellExecution` hook — replaces the static permissions-deny
// rules from the Claude Code plugin's lib/permissions-template.json (Cursor
// has no `permissions.deny` equivalent, so we gate destructive operations
// with a hook).
//
// Coverage:
//   1. `lua auth key*`     — would print API key to stdout (transcript leak)
//   2. `--auto-deploy`     — bypasses the §3.3 confirmation contract
//   3. bare `lua deploy`   — must be prefixed with LUA_DEPLOY_CONFIRMED=1
//                            (set by confirm-deploy.mjs after the user OKs the
//                             5-step gated ship via /lua-deploy)
//
// Uses runHook from lib/hook-runtime.mjs which handles both Claude Code's
// stderr+exit-2 protocol AND Cursor's structured JSON output via runtime
// detection. The hook itself just exports a pure decide(input) function.

import { runHook, checkNodeVersion, isMainScript } from '../lib/hook-runtime.mjs';

/**
 * @param {{tool_input?: {command?: string}}|null} input
 */
export function decide(input) {
  const command = input?.tool_input?.command ?? '';

  // 1. lua auth key — never. The CLI writes the API key to stdout, which would
  // put it in the chat transcript permanently.
  if (/\blua\s+auth\s+key\b/.test(command)) {
    return {
      block: true,
      reason:
        'DEPLOY_DENIED_AUTH_KEY: Refused to run `lua auth key*` — the CLI prints your API key to stdout, ' +
        'which would put it into the chat transcript. If you genuinely need to read your key, run it ' +
        'yourself in a private terminal.',
    };
  }

  // 2. --auto-deploy — never. Bypasses the §3.3 confirmation contract.
  if (/--auto-deploy\b/.test(command)) {
    return {
      block: true,
      reason:
        'DEPLOY_DENIED_AUTO: Refused to run a command containing `--auto-deploy`. The §3.3 deploy-safety ' +
        'contract requires explicit user confirmation before any production deploy. Use `/lua-deploy` ' +
        '(which walks the gated 5-step ship sequence) or run `lua deploy` directly without `--auto-deploy`.',
    };
  }

  // 3. Bare `lua deploy` — only allowed when LUA_DEPLOY_CONFIRMED=1 is set
  // inline (which the confirm-deploy.mjs hook does after the user OKs the
  // /lua-deploy gated flow).
  if (/\blua\s+deploy\b/.test(command) && !/\bLUA_DEPLOY_CONFIRMED=1\b/.test(command)) {
    return {
      block: true,
      reason:
        'DEPLOY_DENIED_BARE: Refused to run bare `lua deploy`. The §3.3 deploy-safety contract requires ' +
        'explicit user confirmation. Use `/lua-deploy` (which walks the gated 5-step ship sequence) or ' +
        'run with the confirmation env-var set: `LUA_DEPLOY_CONFIRMED=1 lua deploy …`.',
    };
  }

  return null;
}

/* istanbul ignore next */
if (isMainScript(import.meta.url)) {
  checkNodeVersion();
  await runHook('before-shell-execution', decide);
}
