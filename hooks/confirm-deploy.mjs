// PreToolUse / beforeShellExecution hook for `lua deploy` and
// `LUA_DEPLOY_CONFIRMED=1 lua deploy`.
// Per feature doc §3.3 / tech spec §6.3 row 4.
//
// The §5.2 `permissions.deny` rule blocks bare `lua deploy` at the
// Claude Code permission layer — this hook is defence-in-depth for
// terminal pass-through (Tier C) where `permissions` doesn't apply, and
// the only `lua deploy` gate at all under Cursor (which has no static
// permissions equivalent).
//
// CURSOR-PORT BUG FIX (2026-05-03): the original hook relied on the
// `matcher` field in hooks.json to filter — without it, the
// `!isPrefixedDeploy(command)` branch fires for EVERY shell command and
// blocks them all with DEPLOY_DENIED_BARE. Cursor's matcher semantics
// differ from Claude Code's (or are unreliable), so we now early-return
// inside decide() when the command is not a `lua deploy` variant. Same
// fix is independently applied by removing matchers from hooks.json.

import { runHook, checkNodeVersion, isMainScript } from '../lib/hook-runtime.mjs';
import { isPrefixedDeploy, hasAutoDeploy } from '../lib/tokenizer.mjs';

const LUA_DEPLOY_RE = /\blua\s+deploy\b/;

/**
 * Pure function — exported so tests can import and call directly without
 * the side effects of running as a script (per tech spec §17.1.1).
 *
 * @param {{tool_input?: {command?: string}}|null} input
 */
export function decide(input) {
  const command = input?.tool_input?.command ?? '';

  // Early return for any command that isn't a `lua deploy` variant. The
  // hook only has opinions about `lua deploy`; everything else (including
  // `node --version`, `npm install`, `lua compile`, etc.) is allowed.
  if (!LUA_DEPLOY_RE.test(command)) return null;

  if (hasAutoDeploy(command)) {
    return {
      block: true,
      reason:
        'DEPLOY_DENIED_AUTO: --auto-deploy is never appropriate from inside Claude Code. ' +
        'Use /lua-deploy instead — it spawns the deploy-pilot subagent which gates each step.',
    };
  }

  if (!isPrefixedDeploy(command)) {
    return {
      block: true,
      reason:
        'DEPLOY_DENIED_BARE: Bare `lua deploy` is blocked. Use /lua-deploy ' +
        '(which sets the required LUA_DEPLOY_CONFIRMED=1 prefix after collecting ' +
        'your single permission interaction per the §3.7 contract).',
    };
  }

  return null;  // Allow
}

// Script entry point — only fires when Claude Code invokes this file directly.
// Test imports skip this block, avoiding the `process.exit` that runHook calls.
//
// Coverage note (architect review I2): the spawn-based integration test
// (test/hooks/confirm-deploy.integration.test.mjs) verifies this block runs
// correctly end-to-end, but Jest's coverage collector measures the parent
// process — child-process coverage merging would require NODE_V8_COVERAGE
// plumbing disproportionate to the value. The integration test is the
// per-§17.1.1 smoke check for entry-point wiring; istanbul ignores the
// uninstrumented lines.
/* istanbul ignore next */
if (isMainScript(import.meta.url)) {
  checkNodeVersion();
  await runHook('confirm-deploy', decide);
}
