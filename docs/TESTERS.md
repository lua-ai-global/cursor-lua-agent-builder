# Testing the Lua Agent Builder for Cursor

Thanks for helping shake this out before we list it on the Cursor marketplace. This page is the 5-minute setup + what to look at + how to report bugs.

---

## 1. Setup (5 minutes)

```bash
# Clone
git clone https://github.com/lua-ai-global/cursor-lua-agent-builder \
  ~/.cursor/plugins/lua-agent-builder
cd ~/.cursor/plugins/lua-agent-builder

# Build the bundled MCP server (gitignored)
cd mcp/lua-platform && npm ci && npm run build && cd ../..

# Wire skills + MCP + hooks into ~/.cursor/
node scripts/install.mjs

# Fully quit Cursor (Cmd+Q on macOS, NOT just close-window) and reopen
```

The install script tells you exactly what it added (14 skills, 1 MCP server, 10 hook entries) and which existing config it preserved.

To clean up afterwards: `node scripts/install.mjs --uninstall` removes only the entries it added.

---

## 2. Sanity check (30 seconds)

In Composer:

1. **Skills loaded** — type `/lua-` and confirm autocomplete shows 14 entries (`lua-architect`, `lua-init`, `lua-doctor`, `lua-deploy`, etc.).
2. **MCP loaded** — ask: *"What MCP tools do you have?"* — confirm 5 entries with the prefix `mcp__lua-platform__` (list_agents, get_agent, list_primitive_versions, get_deployment_status, tail_logs).
3. **Safety hook fires** — ask the agent to run `lua deploy skill --name foo --skill-version 1.0.0 --force`. Cursor should reject it with a `DEPLOY_DENIED_BARE` message pointing you at `/lua-deploy` instead.
4. **Plain commands pass** — ask the agent to run `node --version`. It should run normally, no rejection.

If any of those four checks fails, see [Common gotchas](#5-common-gotchas) below or jump straight to [How to report a bug](#7-how-to-report-a-bug).

---

## 3. End-to-end smoke test (10 minutes)

Once the sanity check passes, walk a full agent build to verify the integration works in your own environment:

```
/lua-auth                                       # email+OTP, takes ~30s
/lua-doctor                                     # 5-step env diagnostic
/lua-architect Build me an agent that summarises my Stripe refund history
                                                # produces a structured plan
/lua-init                                       # scaffolds the project (asks for name + org + model)
/lua-test                                       # exercises the starter primitives in sandbox
```

You don't need to run `/lua-deploy` for the smoke test (that ships to production). Stopping after `/lua-test` is enough to validate the full toolchain works.

---

## 4. What we're specifically watching for

This is a fresh port from the Claude Code plugin, so the things most likely to break are at the seams between Cursor's mechanics and the plugin's behaviour:

| Area | What we want to know |
|---|---|
| **Skill autocomplete** | Do all 14 `/lua-*` skills appear? Do any conflict with Cursor's built-in skills? |
| **MCP tool surface** | Are the 5 `mcp__lua-platform__*` tools actually callable? Any auth errors when they hit `api.heylua.ai`? |
| **Hook firing** | Does `/lua-doctor` complete all 5 steps without any commands being silently blocked? |
| **Hook block UX** | When the safety gate fires (try `lua deploy ...` directly), is the deny message clear? Does Cursor render it readably? |
| **Subagent dispatch** | When `/lua-architect` runs, does it actually attach the `@primitives` / `@integrations` / `@decision-trees` rules? Does the plan reference them? |
| **Multi-step skills** | Skills like `/lua-init`, `/lua-doctor`, `/lua-deploy` ask multi-question prompts. Does Cursor's UX surface these well? |
| **Cross-platform** | If you're on Windows or Linux, does `install.mjs` work correctly? (We've only manually tested macOS so far, though CI runs the matrix.) |
| **Update flow** | Does `git pull && node scripts/install.mjs` smoothly update without duplicating entries or breaking your existing config? |

---

## 5. Common gotchas

| You see | Probably | Fix |
|---|---|---|
| `/lua-` doesn't autocomplete after restart | `install.mjs` failed silently or wasn't run | Re-run `node scripts/install.mjs` and check its output for `✓` lines |
| MCP tools missing | The bundle wasn't built | `cd mcp/lua-platform && npm ci && npm run build` then restart Cursor |
| Every shell command rejected with `DEPLOY_DENIED_BARE` | Stale install (pre-`a85cff7` bug) | `git pull && node scripts/install.mjs` |
| `lua agents --json --ci` returns nothing in `/lua-doctor` | Auth state out of sync | Re-run `/lua-auth` |
| `install.mjs` errors with "MCP server bundle not found" | Step 2 of setup skipped | `cd mcp/lua-platform && npm ci && npm run build` then re-run install |

---

## 6. Things that won't work yet (known)

- **Cursor marketplace install** — we're targeting this AFTER tester feedback. For now only the local `install.mjs` flow works.
- **Custom Modes shareability** — Cursor's Custom Modes are still per-user UI-only; the plugin doesn't ship a mode and won't until Cursor makes them shareable.
- **Cloud Agents** — should work in theory (Cursor's Cloud Agents do execute `~/.cursor/hooks.json` and MCP servers per the docs), but we haven't tested explicitly. If you try it, please tell us how it went.

---

## 7. How to report a bug

For functional bugs, open an issue at [github.com/lua-ai-global/cursor-lua-agent-builder/issues](https://github.com/lua-ai-global/cursor-lua-agent-builder/issues) with:

- **Cursor version** — `Cursor → About Cursor` (something like 2.6.x)
- **Platform** — macOS / Linux / Windows + version
- **What you did** — copy the skill invocation or terminal command
- **What you expected** — one sentence
- **What happened** — paste the actual output, including any `DEPLOY_DENIED_*` text or hook stderr if visible
- **Install state** — output of these three:
  ```bash
  ls ~/.cursor/skills-cursor/lua-* | wc -l       # should be 14
  cat ~/.cursor/mcp.json | jq '.mcpServers["lua-platform"]'   # should show our entry
  cat ~/.cursor/hooks.json | jq '[.hooks[][] | select(.__source == "__cursor-lua-agent-builder")] | length'
                                                  # should show 10
  ```

For **security issues** (credential leaks, gate bypasses, hook injection): email **security@heylua.ai** privately. See [SECURITY.md](../SECURITY.md) for scope.

For quick questions or "this is confusing, can you clarify?": ping in Slack (#cursor-plugin) or DM me.

---

## 8. When you're done

If everything worked, just close the loop with a thumbs-up in the issue tracker or Slack — that lets us count green tests.

If you'd like to keep using the plugin going forward, just leave it installed; we'll push fixes as `git pull && node scripts/install.mjs`.

If you'd like to remove it cleanly:

```bash
cd ~/.cursor/plugins/lua-agent-builder && node scripts/install.mjs --uninstall
rm -rf ~/.cursor/plugins/lua-agent-builder
```

Your other Cursor MCP servers, hooks, and skills are not touched.

Thanks again 🙏
