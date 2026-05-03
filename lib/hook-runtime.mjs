// Per tech spec §17.1 / §17.1.1.
// Common skeleton for every hooks/*.mjs. Each hook exports its `decide`
// function so unit tests can import and call directly. The script-vs-import
// guard at the bottom of each hook file ensures `runHook` only fires when
// the hook is invoked by Claude Code or Cursor, never during a test import.
//
// CURSOR-COMPAT NOTE (cursor-lua-agent-builder port): Claude Code and Cursor
// invoke hooks with different input shapes. Claude Code wraps the tool call
// as `{tool_input: {command}, tool_name, ...}`; Cursor flattens to
// `{command, cwd, conversation_id, generation_id, ...}` for shell hooks. We
// normalise to Claude Code's shape inside readStdin() so the existing decide()
// implementations don't need per-tool conditionals. Detection uses two
// signals: (a) Cursor sets the CURSOR_TRACE_ID env var, (b) the input shape
// has `command` at the top level without a `tool_input` wrapper.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const REQUIRED_NODE_MAJOR = 18;

/**
 * Defensive runtime check (§21.1) — catches users who bypass `npm ci`'s
 * engine-strict gate (e.g. installing via `lua claude-plugin install` from
 * a Path B distribution onto a stale Node).
 *
 * Called explicitly from each hook's entry section, not at module load —
 * loading this file during a test on too-old-Node would kill the test
 * process. Tests run on whatever Node CI provides; that's their concern.
 */
export function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < REQUIRED_NODE_MAJOR) {
    log.toClaudeCode(
      `LUA_NODE_VERSION_TOO_OLD: This plugin requires Node ≥${REQUIRED_NODE_MAJOR}. ` +
      `You have ${process.versions.node}. Update Node and re-run /lua-doctor.`
    );
    exit(0);  // Fail-open per §6.1
  }
}

/**
 * True iff this hook is running under Cursor (vs Claude Code). Two signals:
 * (a) the CURSOR_TRACE_ID env var (set by Cursor on every hook invocation),
 * (b) the input has `command` at top level without a `tool_input` wrapper.
 */
export function isCursorRuntime(input) {
  if (process.env.CURSOR_TRACE_ID) return true;
  if (input && typeof input === 'object' && input.command && !input.tool_input) return true;
  return false;
}

/**
 * Normalise a Cursor-shaped input ({command, cwd, ...}) into Claude Code's
 * shape ({tool_input: {command}, tool_name, ...}) so existing decide()
 * functions work against either runtime without modification.
 */
function normaliseCursorInput(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  if (raw.tool_input) return raw;  // already CC shape
  if (!raw.command) return raw;    // not a shell-style hook
  return {
    tool_name: 'Bash',
    tool_input: { command: raw.command, cwd: raw.cwd },
    // Preserve the originals so Cursor-aware hooks can still inspect them.
    cursor: raw,
  };
}

/**
 * Read the JSON-encoded tool input that the host (Claude Code or Cursor)
 * sends to hooks via stdin. Returns the parsed object normalised to Claude
 * Code's shape, or null if stdin is empty (SessionStart / Stop hooks have no
 * input payload).
 *
 * @returns {Promise<object|null>}
 */
export async function readStdin() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  if (chunks.length === 0) return null;
  const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return normaliseCursorInput(raw);
}

export const log = {
  /**
   * Write to stderr. Claude Code surfaces stderr from a hook ONLY when the
   * hook also exits with code 2 (block); for exit 0 the stderr is logged
   * silently and never reaches the model. Use `emitContext()` instead when
   * you want to inject information into Claude's context.
   */
  toClaudeCode(message) {
    process.stderr.write(message.endsWith('\n') ? message : `${message}\n`);
  },
};

// Iteration-13 audit: every "warn" path was previously written to stderr +
// exit 0, which Claude Code logs silently and never injects into the model
// (verified against https://code.claude.com/docs/en/hooks.md). The
// documented non-blocking context-injection protocol is JSON-on-stdout
// shaped `{ hookSpecificOutput: { hookEventName, additionalContext } }`,
// supported on SessionStart, UserPromptSubmit, and PostToolUse. PreToolUse
// uses the same envelope (the hook still allows the tool, but the warning
// becomes visible to Claude). Without this fix, "Lua project detected",
// "[lua] agent: <id>", "✓ Compiled N primitives", and the post-deploy
// smoke warnings all silently dropped.

// Per https://code.claude.com/docs/en/hooks.md, these are the events that
// support the `hookSpecificOutput.additionalContext` envelope. Stop is
// notably absent — it only supports `decision: "block"`. SessionEnd
// supports the envelope per the iteration-13 follow-up confirmation.
const CONTEXT_EVENTS = new Set([
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
]);

/**
 * Emit a JSON `hookSpecificOutput` envelope on stdout so Claude Code injects
 * the message into the model's context. Caller still must `exit(0)` after.
 */
export function emitContext(hookEventName, additionalContext) {
  if (!CONTEXT_EVENTS.has(hookEventName)) {
    // Unknown event — fall back to stderr so we at least surface in logs.
    process.stderr.write(`⚠ ${additionalContext}\n`);
    return;
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName, additionalContext },
  }) + '\n');
}

/**
 * Exit with a Claude-Code-meaningful code.
 *   0 — allow the tool call
 *   2 — block the tool call (stderr surfaced as the reason)
 *   any other — treated as fail-open (allow) per §6.1
 *
 * Explicit stderr flush via empty write+callback: Windows can drop the last
 * line otherwise.
 */
export function exit(code) {
  process.stderr.write('', () => process.exit(code));
}

/**
 * True iff this module is the entry point for the Node process (script
 * invocation), false when it's been `import`-ed from another module.
 *
 * Cross-platform: resolves both sides to absolute paths so Windows
 * (forward-slash file:// URL vs back-slash argv[1]) and POSIX agree.
 *
 * @param {string} importMetaUrl - pass `import.meta.url` from the calling module
 */
export function isMainScript(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return resolve(fileURLToPath(importMetaUrl)) === resolve(process.argv[1]);
  } catch {
    return false;
  }
}

/**
 * Wrap a hook's main logic with fail-open error handling. A hook with a
 * runtime bug must not lock the user out of the plugin (§6.1).
 *
 * @param {string} hookName  Used for error messages only.
 * @param {(input: object|null) => Promise<{block?: boolean, reason?: string, warn?: string}|null> | {block?: boolean, reason?: string, warn?: string}|null} decideFn
 * @param {{eventName?: string}} [opts] eventName is one of SessionStart |
 *   UserPromptSubmit | PreToolUse | PostToolUse — required for the warn
 *   path to surface in Claude's context (the JSON envelope needs it).
 */
export async function runHook(hookName, decideFn, { eventName } = {}) {
  try {
    const input = await readStdin();
    const decision = await decideFn(input);
    if (decision?.block) {
      const reason = decision.reason ?? `Blocked by ${hookName}.`;
      // Under Cursor, emit structured JSON on stdout for nicer UX (the
      // user sees user_message, the LLM sees agent_message). Under Claude
      // Code, fall back to stderr+exit 2. Cursor accepts exit 2 too, but
      // the JSON path gives it richer block-reason rendering.
      if (isCursorRuntime(input)) {
        process.stdout.write(JSON.stringify({
          permission: 'deny',
          user_message: reason,
          agent_message: reason,
        }) + '\n');
        exit(0);
        /* istanbul ignore next */ return;
      }
      log.toClaudeCode(reason);
      exit(2);
      /* istanbul ignore next */ return;  // defensive: exit() doesn't return in production
    }
    if (decision?.warn) {
      if (isCursorRuntime(input)) {
        // Cursor: emit allow with a user_message so the warn surfaces.
        process.stdout.write(JSON.stringify({
          permission: 'allow',
          user_message: decision.warn,
        }) + '\n');
      } else if (eventName) {
        emitContext(eventName, decision.warn);
      } else {
        // Fall back to stderr — undocumented behaviour, but better than
        // silent drop in case a hook author forgot the eventName parameter.
        log.toClaudeCode(`⚠ ${decision.warn}`);
      }
    }
    exit(0);
  } catch (err) {
    log.toClaudeCode(`Hook ${hookName} error: ${err.message}. Allowing the tool call (fail-open).`);
    exit(0);
  }
}
