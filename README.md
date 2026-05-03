# cursor-lua-agent-builder

A [Cursor](https://cursor.com) plugin for building, testing, and deploying [Lua AI agents](https://heylua.ai) directly from inside your Cursor session.

This is the Cursor port of [`claude-code-lua-plugin`](https://github.com/lua-ai-global/claude-code-lua-plugin) (Anthropic Claude Code), with the same architecture, the same MCP-first integration model, the same §3.3 deploy-safety gates, and the same 14-verb workflow — adapted to Cursor's plugin format.

## Install

Once published to the Cursor marketplace (Cursor 2.5+):

```
Cursor → Settings → Plugins → Marketplace → Lua Agent Builder → Install
```

Then in Composer or Chat: `/lua-auth` to authenticate (email + OTP, or paste an existing API key from [admin.heylua.ai](https://admin.heylua.ai)), and `/lua-doctor` to verify the full environment.

For local install (testing or development):

```bash
git clone https://github.com/lua-ai-global/cursor-lua-agent-builder ~/.cursor/plugins/lua-agent-builder
# Restart Cursor; the plugin appears under Settings → Plugins.
```

## What's inside

| Component | Count | Role |
|---|---|---|
| Skills (`/lua-*`) | 14 | One per verb: architect, init, new, test, push, deploy, sync, logs, chat, qa, doctor, auth, docs, update |
| Subagents | 5 | `lua-architect`, `lua-skill-builder`, `lua-debug`, `lua-deploy-pilot`, `lua-qa` |
| Hooks | 11 | sessionStart × 3, beforeSubmitPrompt × 1, beforeShellExecution × 4 (incl. new safety gate), afterShellExecution × 2 |
| Rules | 3 | `@primitives`, `@integrations`, `@decision-trees` — knowledge base for the architect |
| MCP server | 1 | `lua-platform` exposes 5 read-only tools (`list_agents`, `get_agent`, `list_primitive_versions`, `get_deployment_status`, `tail_logs`) |
| Lints | 12 | Catch known regression classes (CLI flag denylist, MCP refs, frontmatter schema, manifest schema, deploy-gate coverage) |
| Tests | 216 | Jest suites against hook scripts and MCP tools |

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

- **Verbs ship as skills, not commands** — Cursor is mid-migration from `/commands` to `/skills`; new plugins should ship skills. Functionally identical to Claude Code's slash commands (invoke as `/lua-*` in Composer).
- **Knowledge files ship as rules** — `lib/knowledge/*.md` from Claude Code becomes `rules/*.mdc` here, attached via `@-mention` (`@primitives`, `@integrations`, `@decision-trees`) from the architect agent. Cursor's intelligent rule selection picks them up when relevant.
- **Safety gates are hooks, not permissions** — Cursor has no `permissions.deny` equivalent in `settings.json`. The §3.3 deploy-safety contract is enforced by `hooks/before-shell-execution.mjs` which returns `{permission: "deny", user_message, agent_message}` for `lua deploy` (without `LUA_DEPLOY_CONFIRMED=1`), `--auto-deploy`, and `lua auth key*`.
- **Hook input shape is normalised** — Cursor sends `{command, cwd}` while Claude Code sends `{tool_input: {command}}`. The plugin's `lib/hook-runtime.mjs` detects the runtime (via `CURSOR_TRACE_ID` env or input shape) and normalises so the existing hook scripts run unchanged on both.
- **Richer block UX** — Cursor's hooks output structured JSON `{permission, user_message, agent_message}`. The user sees the human-readable reason and the LLM sees a separate agent-facing reason — better than Claude Code's stderr-only convention.

## Layout

```
cursor-lua-agent-builder/
├── .cursor-plugin/
│   └── plugin.json             ← required manifest (kebab-case name)
├── skills/                     ← 14 verbs as skills
│   ├── lua-architect/SKILL.md
│   ├── lua-auth/SKILL.md
│   └── ... (12 more)
├── agents/                     ← 5 subagents
├── hooks/
│   ├── hooks.json
│   ├── before-shell-execution.mjs    ← NEW: §3.3 safety gate as a Cursor hook
│   └── (10 vendored hook scripts, unchanged)
├── rules/                      ← knowledge files as MDC rules (auto-attach via @-mention)
├── mcp.json                    ← MCP server registration
├── mcp/lua-platform/           ← bundled MCP server (vendored from Claude Code plugin)
├── lib/                        ← shared utilities (vendored, with Cursor-compat patches)
├── scripts/                    ← 12 lints + check-coverage + check-bundle-size
├── test/                       ← 216 jest tests (vendored, unchanged)
├── docs/USER_GUIDE.md
└── .github/workflows/{ci,release-prod}.yml
```

## Safety contracts

The plugin enforces the same gates as the Claude Code version, translated to Cursor's mechanisms:

- **§3.3 deploy gate** — bare `lua deploy` is denied by `hooks/before-shell-execution.mjs` unless prefixed with `LUA_DEPLOY_CONFIRMED=1` (the `/lua-deploy` skill sets this after walking the user through the gated 5-step ship sequence).
- **`--auto-deploy` block** — denied for any command containing `--auto-deploy`.
- **Credential isolation** — `lua auth key*` is denied to prevent the API key from being printed into the chat transcript. The user can read it themselves in a private terminal.
- **Single-permission contract** — the same §3.7 contract from the Claude Code plugin (one user prompt per skill) is preserved in the skill bodies.

See [`SECURITY.md`](./SECURITY.md) for disclosure path.

## Contributing

Issues and PRs welcome. The plugin has 12 structural lint scripts that catch known regression classes — if your change adds a new bug class, the right fix is usually "add a lint guard so the next person doesn't repeat it." Mirrors the contribution conventions of the Claude Code plugin.

## License

[MIT](./LICENSE) © Lua AI
