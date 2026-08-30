# cursor-lua-agent-builder

A [Cursor](https://cursor.com) plugin for building, testing, and deploying [Lua AI agents](https://heylua.ai) directly from inside your Cursor session.

This is the Cursor port of [`claude-code-lua-plugin`](https://github.com/lua-ai-global/claude-code-lua-plugin) (Anthropic Claude Code), with the same architecture, the same MCP-first integration model, the same §3.3 deploy-safety gates, and the same 14-verb workflow — translated to Cursor 2.6's actual extension model (skills + MCP servers + hooks at `~/.cursor/`).

## Install

```bash
# 1. Clone (path doesn't matter — install script reads from wherever this lives)
git clone https://github.com/lua-ai-global/cursor-lua-agent-builder \
  ~/.cursor/plugins/lua-agent-builder
cd ~/.cursor/plugins/lua-agent-builder

# 2. Build the bundled MCP server (gitignored — must be built before install)
cd mcp/lua-platform && npm ci && npm run build && cd ../..

# 3. Install — symlinks skills, registers MCP server, wires hooks
node scripts/install.mjs

# 4. Fully quit Cursor (Cmd+Q on macOS, NOT just close-window) and reopen.
```

Then run `/lua-auth` in Composer or Chat. A new login uses `lua auth configure` in a private terminal and requires lua-cli 3.28.0 or newer. Run `/lua-doctor` to verify the full environment.

To uninstall: `node scripts/install.mjs --uninstall`.

> **Why an install script?** Cursor 2.6 doesn't auto-discover `~/.cursor/plugins/` directories (the marketplace plugin format with `.cursor-plugin/plugin.json` is reserved for marketplace install, which is currently in flux). The install script wires the components into the paths Cursor actually scans: `~/.cursor/skills-cursor/<name>/SKILL.md` for skills, `~/.cursor/mcp.json` for the MCP server, `~/.cursor/hooks.json` for the safety hooks. The script is idempotent (safe to re-run after `git pull`) and additively merges with your existing `mcp.json` / `hooks.json` (with backup).

## What's inside

| Component | Count | Role |
|---|---|---|
| Skills (`/lua-*`) | 14 | One per verb: architect, init, new, test, push, deploy, sync, logs, chat, qa, doctor, auth, docs, update |
| Subagents | 5 | `lua-architect`, `lua-skill-builder`, `lua-debug`, `lua-deploy-pilot`, `lua-qa` |
| Hooks | 10 | sessionStart × 3, beforeSubmitPrompt × 1, beforeShellExecution × 4 (incl. new safety gate), afterShellExecution × 2 |
| Rules | 3 | `@primitives`, `@integrations`, `@decision-trees` — knowledge base for the architect |
| MCP server | 1 | `lua-platform` exposes 5 read-only tools (`list_agents`, `get_agent`, `list_primitive_versions`, `get_deployment_status`, `tail_logs`) |
| Lints | 12 | Catch known regression classes (CLI flag denylist, MCP refs, frontmatter schema, manifest schema, deploy-gate coverage) |
| Tests | 248 | Jest suites against hook scripts, MCP tools, and Cursor-runtime adapters |

## Quick walkthrough

After install + `/lua-auth`:

```
/lua-architect I want to build a refund-handling agent
   → drafts a plan: persona, primitives, integrations, build order
/lua-init       → scaffolds project, asks for name + org + model + optional promo code
/lua-new tool refund_lookup
   → spawns lua-skill-builder, scaffolds + compiles + tests
/lua-test       → exercises the tool in sandbox
/lua-deploy     → ships to production with the §3.3 confirmation gate
```

The architect deliberately uses the **MCP-first pattern**: every Unified.to integration auto-provisions an MCP server (`lua-cli` v3.13+). For known SaaS systems like Stripe, Google Calendar, Salesforce, etc., the architect will recommend connecting via `lua integrations connect` and using the auto-provisioned MCP tools rather than building duplicate custom tools. Trigger discovery (`lua integrations webhooks events --integration <name> --json`) is part of the architect's planning workflow.

## Differences from the Claude Code plugin

The two plugins are intentionally feature-equivalent. Cursor-specific differences:

- **Local install is via `scripts/install.mjs`, not file-drop** — Cursor 2.6 doesn't auto-discover `~/.cursor/plugins/`. The install script symlinks each skill into `~/.cursor/skills-cursor/<name>/`, additively merges the MCP server into `~/.cursor/mcp.json`, and writes hook entries (tagged for clean uninstall) into `~/.cursor/hooks.json`.
- **Verbs ship as skills, not commands** — Cursor is mid-migration from `/commands` to `/skills`. Skills are top-level dirs under `~/.cursor/skills-cursor/`, each with a `SKILL.md`. Invoke as `/lua-*` in Composer.
- **Knowledge files ship as rules** — `lib/knowledge/*.md` from Claude Code becomes `rules/*.mdc` here, attached via `@-mention` (`@primitives`, `@integrations`, `@decision-trees`) from the architect agent. Cursor's intelligent rule selection picks them up when relevant.
- **Safety gates are hooks, not permissions** — Cursor has no `permissions.deny` equivalent. The §3.3 deploy-safety contract is enforced by `hooks/before-shell-execution.mjs` (umbrella) plus the dedicated `confirm-deploy.mjs`, `block-auto-deploy.mjs`, and `warn-version-zero.mjs` hooks. Each returns `{permission: "deny", user_message, agent_message}` for the matched offence.
- **Hook input shape is normalised** — Cursor sends `{command, cwd}` while Claude Code sends `{tool_input: {command}}`. `lib/hook-runtime.mjs` detects the runtime (via `CURSOR_TRACE_ID` env or input shape) and normalises so the same hook scripts run unchanged on either host. Same source — works in both.
- **Richer block UX** — Cursor's hooks output structured JSON `{permission, user_message, agent_message}`. The user sees the human-readable reason and the LLM sees a separate agent-facing reason — better than Claude Code's stderr-only convention.

## Layout

```
cursor-lua-agent-builder/
├── scripts/install.mjs         ← LOCAL INSTALL — wires components into ~/.cursor/
├── skills/                     ← 14 verbs as skills (symlinked → ~/.cursor/skills-cursor/)
│   ├── lua-architect/SKILL.md
│   ├── lua-auth/SKILL.md
│   └── ... (12 more)
├── agents/                     ← 5 subagents (referenced by skills)
├── hooks/
│   ├── before-shell-execution.mjs    ← §3.3 safety gate (umbrella)
│   ├── confirm-deploy.mjs / block-auto-deploy.mjs / warn-version-zero.mjs
│   ├── check-lua-version.mjs / detect-project.mjs / check-lua-auth.mjs
│   ├── inject-context.mjs / post-deploy-smoke.mjs / post-compile-summary.mjs
│   └── hooks.json              ← marketplace-format manifest (NOT the install mechanism)
├── rules/                      ← knowledge files as MDC rules (@primitives etc.)
├── mcp/lua-platform/           ← bundled MCP server (registered into ~/.cursor/mcp.json)
├── lib/                        ← shared utilities (Cursor-runtime adapter included)
├── scripts/                    ← install.mjs + 12 lints + check-coverage + check-bundle-size
├── test/                       ← 248 jest tests (covers Cursor-runtime branches)
├── .cursor-plugin/plugin.json  ← marketplace manifest (forward-looking; not used by local install)
├── mcp.json                    ← marketplace MCP config (mirrors install.mjs's runtime patch)
├── docs/USER_GUIDE.md
└── .github/workflows/{ci,release-prod}.yml
```

The `.cursor-plugin/plugin.json`, `mcp.json`, and `hooks/hooks.json` files are kept for forward-compatibility with Cursor's marketplace plugin format. **The actual install mechanism is `scripts/install.mjs`**, which writes into `~/.cursor/skills-cursor/`, `~/.cursor/mcp.json`, and `~/.cursor/hooks.json`.

## Safety contracts

The plugin enforces the same gates as the Claude Code version, translated to Cursor's mechanisms:

- **§3.3 deploy gate** — bare `lua deploy` is denied by `hooks/before-shell-execution.mjs` unless prefixed with `LUA_DEPLOY_CONFIRMED=1` (the `/lua-deploy` skill sets this after walking the user through the gated 5-step ship sequence).
- **`--auto-deploy` block** — denied for any command containing `--auto-deploy`.
- **Credential isolation** — model-run `lua auth configure` and `lua auth key*` commands are denied. Account details, OTPs, and credentials stay in a private terminal.
- **Single-permission contract** — the same §3.7 contract from the Claude Code plugin (one user prompt per skill) is preserved in the skill bodies.

See [`SECURITY.md`](./SECURITY.md) for disclosure path.

## Contributing

Issues and PRs welcome. The plugin has 12 structural lint scripts that catch known regression classes — if your change adds a new bug class, the right fix is usually "add a lint guard so the next person doesn't repeat it." Mirrors the contribution conventions of the Claude Code plugin.

## License

[MIT](./LICENSE) © Lua AI
