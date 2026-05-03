# Security Policy

## Reporting a vulnerability

Email **security@heylua.ai** with the details. Please do NOT open a public GitHub issue for security reports.

We aim to acknowledge within 2 business days and ship a fix within 30 days for high-severity issues.

## Scope

This plugin's surface includes:

- **Skills** (`skills/<name>/SKILL.md`) — Markdown prompts that Cursor loads as `/lua-*` slash commands. Symlinked into `~/.cursor/skills-cursor/` by `scripts/install.mjs`.
- **Subagents** (`agents/*.md`) — referenced by skills; specialised assistants for architect/build/debug/deploy/QA flows.
- **Hooks** (`hooks/*.mjs`) — run as Node subprocesses on `sessionStart`, `beforeSubmitPrompt`, `beforeShellExecution`, `afterShellExecution` events. Registered in `~/.cursor/hooks.json` by the install script.
- **MCP server** (`mcp/lua-platform/dist/server.js`) — a stdio MCP server exposing 5 read-only tools. Talks to `https://api.heylua.ai` over HTTPS using the user's API key. Registered in `~/.cursor/mcp.json`.
- **Rules** (`rules/*.mdc`) — knowledge files attached to the architect agent's context via `@-mention`.
- **Install script** (`scripts/install.mjs`) — modifies `~/.cursor/mcp.json` and `~/.cursor/hooks.json` (always with backup). Runs only when explicitly invoked by the user.

In scope for security reports:

- Credential exposure (API keys leaking into transcripts, logs, environment, or external systems)
- Safety-gate bypasses (deploys or destructive operations succeeding without the documented confirmation)
- Hook payload injection (a maliciously-shaped command triggering unintended hook behavior)
- MCP server auth bypass
- Install script writing outside `~/.cursor/` or executing without explicit user invocation
- Symlink-target manipulation (an installed skill resolving to a path outside the cloned plugin)

Out of scope:

- Bugs in `lua-cli` itself (report to the lua-cli repo or via security@heylua.ai with `[lua-cli]` in the subject)
- Bugs in `lua-api` (report to security@heylua.ai with `[lua-api]` in the subject)
- Issues in user-installed third-party MCP servers
- Social-engineering / phishing of an Lua API key from a user

## Safety-critical contracts

The plugin enforces several safety contracts. Bypasses count as security issues.

| Contract | Where enforced |
|---|---|
| **§3.3 deploy gate**: bare `lua deploy` is denied | `hooks/before-shell-execution.mjs` (umbrella) + `hooks/confirm-deploy.mjs` (dedicated) |
| **§3.3 auto-deploy block**: `--auto-deploy` is denied | `hooks/before-shell-execution.mjs` + `hooks/block-auto-deploy.mjs` |
| **Credential isolation**: API key never enters chat transcript | `hooks/before-shell-execution.mjs` denies `lua auth key*` invocations + `commands/lua-doctor.md` Step 4 uses an authenticated metadata probe (`lua agents --json --ci`), not a key-printing command |
| **§3.7 single-permission contract**: each skill asks at most one prompt per invocation | Convention enforced in skill bodies; not yet machine-checked in the Cursor port (was lint-checked in the Claude Code plugin via `scripts/lint-single-permission.mjs`) |

If you find a way to bypass any of these without an explicit user prompt, please report.

### Hook safety model under Cursor

Cursor sends `beforeShellExecution` hooks structured stdin JSON `{command, cwd, ...}` and accepts either an exit code (2 = block) or a JSON return `{permission: "deny", user_message, agent_message}`. The plugin's hooks self-filter on `command` content rather than relying on Cursor's `matcher` field — a bug fix landed in `a85cff7` after the matcher proved unreliable in the wild and caused every shell command to be denied.

The runtime adapter (`lib/hook-runtime.mjs`) detects whether it's running under Claude Code or Cursor (via `CURSOR_TRACE_ID` env or input shape) and emits the host-appropriate output protocol. The same hook scripts run unchanged on either host.

## Audit history

This plugin is a port of [`claude-code-lua-plugin`](https://github.com/lua-ai-global/claude-code-lua-plugin), which underwent 13 iterations of structured audit (commits prefixed with `iteration-`) before public release, fixing 78 documented bugs across the plugin / hook / MCP / knowledge-file surfaces. See the iteration-history comments in each lint script (`scripts/lint-*.mjs`) for the rationale behind each structural guard.

The Cursor port adds:

- A new `before-shell-execution.mjs` umbrella hook covering all three §3.3 deny patterns
- Cursor-runtime detection + input/output normalisation in `lib/hook-runtime.mjs`
- Cursor-specific lints: `lint-cursor-manifest`, `lint-cursor-mcp-config`, `lint-cursor-no-claude-root`
- Test coverage for the Cursor branches (248/248 tests passing as of v1.0.0)
- A regression-test bundle covering the `confirm-deploy.mjs` matcher-leak bug fix in `a85cff7`
