# Lua Agent Builder for Cursor — User Guide

This guide walks through installing the plugin, authenticating, and shipping your first Lua agent end-to-end. It assumes Cursor 2.5+ (the version that introduced the plugin marketplace).

---

## 1. Install

### From the marketplace (once published)

```
Cursor → Settings → Plugins → Marketplace → search "Lua Agent Builder" → Install
```

### From a local clone (testing or development)

```bash
git clone https://github.com/lua-ai-global/cursor-lua-agent-builder \
  ~/.cursor/plugins/lua-agent-builder
```

Restart Cursor. The plugin should appear under `Settings → Plugins` with the 14 skills, 5 agents, and `lua-platform` MCP server.

---

## 2. Authenticate

```
/lua-auth
```

The skill asks how you want to authenticate:

- **Email + OTP** (recommended for first-time users) — enter your email; you'll receive a 6-digit code; enter it back. The CLI generates and stores an API key for you.
- **Existing API key** — paste it (don't worry, it doesn't enter the chat transcript; the plugin's `before-shell-execution.mjs` hook denies `lua auth key*` invocations specifically to prevent that).

Verify with:

```
/lua-doctor
```

`/lua-doctor` runs a 5-step environment diagnostic: Node version, lua-cli version, MCP wiring, auth state, and rule attachment. If anything is off, it walks you through the fix.

---

## 3. Build your first agent

The recommended flow is **architect → init → primitives → test → deploy**. Each step is a separate skill so the §3.7 single-permission contract holds (one prompt per skill).

### 3.1 Architect

```
/lua-architect I want to build a refund-handling agent
```

The architect attaches the `@primitives`, `@integrations`, `@decision-trees` rules and produces a structured plan:

- **Persona & model** — voice, scope, refusal behaviour, model recommendation.
- **Primitives** — tools (skills), webhooks, jobs, processors, data model.
- **Integrations** — which Unified.to connectors to use, what the MCP exposes (verified, not assumed), what triggers to subscribe to with proposed handler responsibilities.
- **Build order** — sequenced steps you can hand off to the next skills.

The architect deliberately uses the **MCP-first pattern**: it never proposes a custom tool that duplicates an integration's MCP capability. Before listing custom tools it instructs you to verify the MCP's actual surface (since coverage varies per Unified.to integration).

### 3.2 Initialise

```
/lua-init
```

The skill collects: agent name, organisation (existing or new), model, whether to include example skills, and an optional **promo code** (Lua periodically issues codes that grant bonus credits at agent-creation time; see [admin.heylua.ai](https://admin.heylua.ai) for active codes).

It runs `lua init --ci ...` with the gathered inputs. Auth and lua-cli version are auto-resolved if missing — no need to run `/lua-auth` first.

### 3.3 Scaffold primitives

```
/lua-new tool refund_lookup
/lua-new webhook stripe_refunds
/lua-new job daily_report
```

Each invocation dispatches the `lua-skill-builder` agent which scaffolds the file (using class-based pattern + Zod schema), wires it into `lua.skill.yaml`, runs `lua compile`, and runs `lua test` for the primitive.

### 3.4 Connect integrations

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

### 3.5 Test

```
/lua-test
```

Picks the right `lua test` form for each primitive type (skill / webhook / job) and exercises it in sandbox. If a test fails, it auto-hands off to the `lua-debug` agent to diagnose.

```
/lua-qa
```

Runs a conversational QA pass — exercises the persona against the primitives in either sandbox (if drift detected) or production (if clean), and writes a triage report routing findings to `lua-debug` or `lua-skill-builder`.

### 3.6 Deploy

```
/lua-deploy
```

The skill dispatches `lua-deploy-pilot` which walks the gated 5-step ship sequence: compile → sync check → push → smoke test → deploy. The §3.3 safety contract enforces explicit user confirmation before the production deploy fires; bypassing it via `--auto-deploy` or bare `lua deploy` is blocked by the `before-shell-execution.mjs` hook.

---

## 4. Day-2 operations

```
/lua-sync   → detect drift between local code and server state, pull or push
/lua-logs   → view recent agent logs (skill, webhook, job, etc.) with filtering
/lua-chat   → one-shot or threaded conversation with the agent in sandbox or production
/lua-push   → push primitives to server without deploying
/lua-update → update lua-cli to the latest version
/lua-docs   → search heylua.ai docs from inside Cursor
```

---

## 5. Subagents

The five subagents under `agents/` are dispatched automatically by the matching skills, but you can also invoke them directly in Composer for ad-hoc work:

| Agent | What it does | Tools |
|---|---|---|
| `lua-architect` | Goal → architecture mapping | Read, Glob, Grep, Bash, WebFetch, MCP read-only tools |
| `lua-skill-builder` | Scaffolds primitives, runs compile loop | Read, Write, Edit, Glob, Grep, Bash, WebFetch, MCP get_agent |
| `lua-debug` | Diagnoses compile/test failures, proposes minimal fixes | Read, Edit, Grep, Bash, WebFetch |
| `lua-deploy-pilot` | 5-step gated ship sequence | Read, Bash, MCP get_deployment_status |
| `lua-qa` | Conversational QA, triage report | Read, Grep, Bash, MCP get_agent + tail_logs |

---

## 6. Safety contracts (worth knowing)

The plugin enforces three gates via `hooks/before-shell-execution.mjs`. They're surfaced in Cursor as `{permission: "deny", user_message, agent_message}` JSON returns:

1. **`lua deploy`** without `LUA_DEPLOY_CONFIRMED=1` — denied. Use `/lua-deploy` (which sets the env var after walking you through confirmation) or set it yourself.
2. **`--auto-deploy`** — always denied. It bypasses the §3.3 confirmation contract.
3. **`lua auth key*`** — always denied. The CLI prints the API key to stdout, which would put your secret into the chat transcript permanently. Run it in a private terminal if you genuinely need the value.

These mirror the Claude Code plugin's `permissions.deny` rules, ported to Cursor's hook-based safety mechanism (Cursor has no static permissions equivalent).

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| MCP tools don't appear in Composer | Plugin loaded before MCP server built | `cd ~/.cursor/plugins/lua-agent-builder/mcp/lua-platform && npm ci && npm run build`, then restart Cursor |
| `/lua-auth` runs but next skill says "not authenticated" | Stored credentials don't match the current org | Run `lua agents --json --ci` in a terminal to verify; if the response is empty or wrong, re-auth |
| Architect proposes custom tools that duplicate an integration's API | Rare, but if seen: the architect didn't run the MCP discovery step | Manually attach `@integrations`, then re-prompt with: "Verify the MCP surface for `<integration>` before listing custom tools" |
| Hook scripts hang | Cursor's hook timeout (default 30s) exceeded | The hook `timeout` is configurable per entry in `hooks/hooks.json` — increase if a slow `lua` command needs longer |

For deeper issues, see [SECURITY.md](../SECURITY.md) for the disclosure path or open an issue at [https://github.com/lua-ai-global/cursor-lua-agent-builder/issues](https://github.com/lua-ai-global/cursor-lua-agent-builder/issues).
