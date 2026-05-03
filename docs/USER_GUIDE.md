# Lua Agent Builder for Cursor — User Guide

Complete walkthrough: install → authenticate → ship a Lua agent end-to-end. Assumes Cursor 2.6+. If you're a tester rather than a regular user, read [TESTERS.md](./TESTERS.md) first for the 5-minute setup + how to report bugs.

---

## 1. Install

```bash
# Clone (the path is your dev location — install.mjs will wire components into ~/.cursor/)
git clone https://github.com/lua-ai-global/cursor-lua-agent-builder \
  ~/.cursor/plugins/lua-agent-builder
cd ~/.cursor/plugins/lua-agent-builder

# Build the bundled MCP server (gitignored — must exist before install)
cd mcp/lua-platform && npm ci && npm run build && cd ../..

# Install — symlinks 14 skills, registers MCP server, wires safety hooks
node scripts/install.mjs

# Fully quit Cursor (Cmd+Q on macOS, NOT just close-window) and reopen
```

What `install.mjs` does:

- Symlinks each skill from `skills/<name>/` into `~/.cursor/skills-cursor/<name>/` — Cursor's actual skill discovery path
- Adds the `lua-platform` MCP server entry to `~/.cursor/mcp.json`, **preserving any existing servers** (mintlify, Lua CLI, etc.)
- Adds 10 hook entries to `~/.cursor/hooks.json`, each tagged with `__source: "__cursor-lua-agent-builder"` so uninstall can find and remove only ours
- Backs up your existing `mcp.json` and `hooks.json` before modifying (timestamped `.bak.<unix-ts>` files)

To uninstall: `node scripts/install.mjs --uninstall` — removes only the entries it added; your other MCP servers and hooks stay put.

To update: `cd ~/.cursor/plugins/lua-agent-builder && git pull && node scripts/install.mjs` — the script is idempotent; re-running it overwrites only the entries it owns.

---

## 2. Verify install

In Composer, type `/lua-` — autocomplete should list 14 skills:

> `/lua-architect`, `/lua-auth`, `/lua-chat`, `/lua-deploy`, `/lua-docs`, `/lua-doctor`, `/lua-init`, `/lua-logs`, `/lua-new`, `/lua-push`, `/lua-qa`, `/lua-sync`, `/lua-test`, `/lua-update`

Then ask the agent: *"What MCP tools do you have available?"* — you should see the `lua-platform` server's 5 tools:

- `mcp__lua-platform__list_agents`
- `mcp__lua-platform__get_agent`
- `mcp__lua-platform__list_primitive_versions`
- `mcp__lua-platform__get_deployment_status`
- `mcp__lua-platform__tail_logs`

If any of this fails, see the [Troubleshooting](#7-troubleshooting) section below.

---

## 3. Authenticate

```
/lua-auth
```

The skill asks how you want to authenticate:

- **Email + OTP** (recommended for first-time users) — enter your email; you'll receive a 6-digit code; enter it back. The CLI generates and stores an API key for you.
- **Existing API key** — paste it. (The plugin's `before-shell-execution.mjs` hook denies `lua auth key*` invocations specifically to prevent your stored key from being printed back into the chat transcript.)

Verify with:

```
/lua-doctor
```

`/lua-doctor` runs a 5-step environment diagnostic: Node version, lua-cli version, MCP wiring, auth state, and rule attachment. If anything is off, it walks you through the fix.

---

## 4. Build your first agent

The recommended flow is **architect → init → primitives → test → deploy**. Each step is a separate skill so the §3.7 single-permission contract holds (one prompt per skill).

### 4.1 Architect

```
/lua-architect I want to build a refund-handling agent
```

The architect attaches the `@primitives`, `@integrations`, `@decision-trees` rules and produces a structured plan:

- **Persona & model** — voice, scope, refusal behaviour, model recommendation.
- **Primitives** — tools (skills), webhooks, jobs, processors, data model.
- **Integrations** — which Unified.to connectors to use, what the MCP exposes (verified, not assumed), what triggers to subscribe to with proposed handler responsibilities.
- **Build order** — sequenced steps you can hand off to the next skills.

The architect deliberately uses the **MCP-first pattern**: it never proposes a custom tool that duplicates an integration's MCP capability. Before listing custom tools it instructs you to verify the MCP's actual surface (since coverage varies per Unified.to integration).

### 4.2 Initialise

```
/lua-init
```

The skill collects: agent name, organisation (existing or new), model, whether to include example skills, and an optional **promo code** (Lua periodically issues codes that grant bonus credits at agent-creation time; see [admin.heylua.ai](https://admin.heylua.ai) for active codes).

It runs `lua init --ci ...` with the gathered inputs. Auth and lua-cli version are auto-resolved if missing — no need to run `/lua-auth` first.

### 4.3 Scaffold primitives

```
/lua-new tool refund_lookup
/lua-new webhook stripe_refunds
/lua-new job daily_report
```

Each invocation dispatches the `lua-skill-builder` agent which scaffolds the file (using class-based pattern + Zod schema), wires it into `lua.skill.yaml`, runs `lua compile`, and runs `lua test` for the primitive.

### 4.4 Connect integrations

The architect tells you which integrations to connect. For each:

```bash
# Tier C — interactive. Run in a terminal pane (Cursor's integrated terminal works).
lua integrations connect --integration stripe --auth-method oauth --scopes all \
  --triggers payment_intent.succeeded,payment_intent.payment_failed,charge.refunded
```

The CLI opens a browser for OAuth, creates the connection, **auto-provisions an MCP server**, and (if `--triggers` was passed) creates the webhook subscriptions. Verify the MCP is active:

```bash
lua integrations mcp list                    # confirm Active
lua integrations webhooks events --integration stripe --json   # discover all available events
lua integrations webhooks list --json        # see what's already subscribed
```

After activating, restart Cursor so the new MCP server loads. The integration's tools appear as `mcp__stripe__list-charges`, `mcp__stripe__create-refund`, etc. — the agent can call them directly without you writing tool code.

### 4.5 Test

```
/lua-test
```

Picks the right `lua test` form for each primitive type (skill / webhook / job) and exercises it in sandbox. If a test fails, it auto-hands off to the `lua-debug` agent to diagnose.

```
/lua-qa
```

Runs a conversational QA pass — exercises the persona against the primitives in either sandbox (if drift detected) or production (if clean), and writes a triage report routing findings to `lua-debug` or `lua-skill-builder`.

### 4.6 Deploy

```
/lua-deploy
```

The skill dispatches `lua-deploy-pilot` which walks the gated 5-step ship sequence: compile → sync check → push → smoke test → deploy. The §3.3 safety contract enforces explicit user confirmation before the production deploy fires; bypassing it via `--auto-deploy` or bare `lua deploy` is blocked by the `before-shell-execution.mjs` hook.

---

## 5. Day-2 operations

```
/lua-sync   → detect drift between local code and server state, pull or push
/lua-logs   → view recent agent logs (skill, webhook, job, etc.) with filtering
/lua-chat   → one-shot or threaded conversation with the agent in sandbox or production
/lua-push   → push primitives to server without deploying
/lua-update → update lua-cli to the latest version
/lua-docs   → search heylua.ai docs from inside Cursor
```

---

## 6. Subagents

The five subagents under `agents/` are dispatched automatically by the matching skills, but you can also invoke them directly in Composer for ad-hoc work:

| Agent | What it does | Tools |
|---|---|---|
| `lua-architect` | Goal → architecture mapping | Read, Glob, Grep, Bash, WebFetch, MCP read-only tools |
| `lua-skill-builder` | Scaffolds primitives, runs compile loop | Read, Write, Edit, Glob, Grep, Bash, WebFetch, MCP get_agent |
| `lua-debug` | Diagnoses compile/test failures, proposes minimal fixes | Read, Edit, Grep, Bash, WebFetch |
| `lua-deploy-pilot` | 5-step gated ship sequence | Read, Bash, MCP get_deployment_status |
| `lua-qa` | Conversational QA, triage report | Read, Grep, Bash, MCP get_agent + tail_logs |

---

## 7. Safety contracts (worth knowing)

The plugin enforces three gates via four `beforeShellExecution` hooks. Each returns a structured `{permission: "deny", user_message, agent_message}` JSON response on Cursor for clean denial UX:

| Gate | Hook(s) that enforce it |
|---|---|
| **`lua deploy`** without `LUA_DEPLOY_CONFIRMED=1` is denied | `before-shell-execution.mjs` (umbrella) + `confirm-deploy.mjs` |
| **`--auto-deploy`** in any command is denied | `before-shell-execution.mjs` (umbrella) + `block-auto-deploy.mjs` |
| **`lua auth key*`** is denied (would print key to transcript) | `before-shell-execution.mjs` (umbrella) |

The umbrella hook gives the cleanest deny message; the dedicated hooks are defense-in-depth (if one is bypassed by a future Cursor change, the other still catches the offence). All hooks self-filter based on the actual command — they're safe regardless of Cursor's matcher behaviour (a bug we hit on initial release; see [bug fix `a85cff7`](https://github.com/lua-ai-global/cursor-lua-agent-builder/commit/a85cff7) for context).

To bypass the deploy gate intentionally (e.g. for a deliberate prod ship), prefix:

```bash
LUA_DEPLOY_CONFIRMED=1 lua deploy skill --name foo --skill-version 1.0.0 --force
```

The `/lua-deploy` skill sets this env var automatically after walking you through the gated 5-step sequence.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/lua-` doesn't autocomplete in Composer | Skills weren't symlinked — `install.mjs` not run | `cd ~/.cursor/plugins/lua-agent-builder && node scripts/install.mjs`, then fully quit + reopen Cursor |
| Plugin appears installed but MCP tools don't appear | MCP server bundle missing | `cd ~/.cursor/plugins/lua-agent-builder/mcp/lua-platform && npm ci && npm run build`, then restart Cursor |
| **All shell commands rejected with `DEPLOY_DENIED_BARE`** | Stale install — pre-fix `confirm-deploy.mjs` blocking everything | `cd ~/.cursor/plugins/lua-agent-builder && git pull && node scripts/install.mjs` (this fix landed in `a85cff7`) |
| `/lua-auth` runs but next skill says "not authenticated" | Stored credentials don't match the current org | Run `lua agents --json --ci` in a terminal to verify; if the response is empty or wrong, re-run `/lua-auth` |
| Architect proposes custom tools that duplicate an integration's API | Rare, but if seen: the architect didn't run the MCP discovery step | Manually attach `@integrations`, then re-prompt with: "Verify the MCP surface for `<integration>` before listing custom tools" |
| Hook scripts hang | Cursor's hook timeout (default 30s) exceeded | Re-run install with a higher timeout, or check the hook's stderr in Cursor's logs |
| Want to start fresh | n/a | `node scripts/install.mjs --uninstall && node scripts/install.mjs` — clean re-install with backups |

For deeper issues, see [SECURITY.md](../SECURITY.md) for the disclosure path or open an issue at [https://github.com/lua-ai-global/cursor-lua-agent-builder/issues](https://github.com/lua-ai-global/cursor-lua-agent-builder/issues).

---

## 9. Uninstall

```bash
cd ~/.cursor/plugins/lua-agent-builder
node scripts/install.mjs --uninstall
# Optionally also remove the dev clone:
rm -rf ~/.cursor/plugins/lua-agent-builder
```

The uninstall script:

- Removes the 14 skill symlinks from `~/.cursor/skills-cursor/`
- Deletes the `lua-platform` entry from `~/.cursor/mcp.json` (your other MCP servers stay put)
- Removes only hook entries tagged with `__source: "__cursor-lua-agent-builder"` from `~/.cursor/hooks.json` (your other hooks stay put)
- Backs up `mcp.json` and `hooks.json` before modifying

Your local Lua CLI auth credentials at `~/.lua-cli/credentials` are NOT touched by uninstall — log out separately with `lua auth logout` if you want.
