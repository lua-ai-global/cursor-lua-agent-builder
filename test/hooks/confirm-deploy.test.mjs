import { decide } from '../../hooks/confirm-deploy.mjs';

describe('confirm-deploy decide()', () => {
  test('allows env-var-prefixed deploy', () => {
    const result = decide({
      tool_input: { command: 'LUA_DEPLOY_CONFIRMED=1 lua deploy skill --ci --name foo --set-version 1.2.3 --force' }
    });
    expect(result).toBeNull();
  });

  test('allows env-form prefix', () => {
    const result = decide({
      tool_input: { command: 'env LUA_DEPLOY_CONFIRMED=1 lua deploy webhook' }
    });
    expect(result).toBeNull();
  });

  test('allows leading-whitespace prefix', () => {
    const result = decide({
      tool_input: { command: '   LUA_DEPLOY_CONFIRMED=1 lua deploy job' }
    });
    expect(result).toBeNull();
  });

  test('blocks bare lua deploy', () => {
    const result = decide({
      tool_input: { command: 'lua deploy skill --ci --force' }
    });
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('DEPLOY_DENIED_BARE'),
    });
    expect(result.reason).toContain('Use /lua-deploy');
  });

  test('blocks bash-wrapper invocation even with prefix', () => {
    const result = decide({
      tool_input: { command: 'bash -c "LUA_DEPLOY_CONFIRMED=1 lua deploy"' }
    });
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('DEPLOY_DENIED_BARE'),
    });
  });

  test('blocks pipe even with prefix', () => {
    const result = decide({
      tool_input: { command: 'echo y | LUA_DEPLOY_CONFIRMED=1 lua deploy' }
    });
    expect(result?.block).toBe(true);
  });

  test('blocks --auto-deploy in deploy form', () => {
    const result = decide({
      tool_input: { command: 'LUA_DEPLOY_CONFIRMED=1 lua deploy --auto-deploy' }
    });
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('DEPLOY_DENIED_AUTO'),
    });
  });

  test('does NOT block --auto-deploy in push form (out of scope — that is block-auto-deploy.mjs)', () => {
    // After the Cursor-port fix, confirm-deploy.mjs only opines on `lua
    // deploy` commands. `lua push --auto-deploy` is caught by the
    // dedicated block-auto-deploy.mjs hook. Defense-in-depth via
    // separation of concerns.
    expect(decide({ tool_input: { command: 'lua push all --auto-deploy' } })).toBeNull();
  });

  // After the Cursor-port fix (2026-05-03), the hook early-returns null
  // for any command that isn't a `lua deploy` variant. The previous
  // "missing input → block" behavior depended on the host's matcher to
  // ensure decide() only ran for `lua deploy` commands; under Cursor that
  // assumption broke and blocked every shell command including
  // `node --version`. The hook now self-filters.

  test('allows when input is null (host invoked us with no payload)', () => {
    expect(decide(null)).toBeNull();
  });

  test('allows when tool_input is missing', () => {
    expect(decide({})).toBeNull();
  });

  test('allows when command field is missing', () => {
    expect(decide({ tool_input: {} })).toBeNull();
  });

  test('allows when command is empty string', () => {
    expect(decide({ tool_input: { command: '' } })).toBeNull();
  });

  // Regression tests for the Cursor-port bug — every shell command was
  // being blocked with DEPLOY_DENIED_BARE because the matcher in
  // hooks.json wasn't filtering as expected. The hook must now safely
  // no-op for any non-deploy command.

  describe('Cursor-port regression — non-deploy commands must be allowed', () => {
    const allowedCommands = [
      'node --version',
      'npm --version',
      'lua --version',
      'lua compile --ci',
      'lua test --ci',
      'lua chat --ci -m "hello" -t test',
      'ls -la',
      'pwd',
      'git status',
    ];
    // Note: `echo "lua deploy ..."` style commands (literal substring) WILL
    // be blocked — the regex matches the substring. Acceptable false-
    // positive; users echoing the literal phrase can quote-around-space or
    // pipe through cat. Real `lua deploy` invocations are correctly caught.

    test.each(allowedCommands)('allows: %s', (command) => {
      expect(decide({ tool_input: { command } })).toBeNull();
    });
  });
});
