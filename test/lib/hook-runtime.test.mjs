import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { join as pathJoin } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readStdin,
  log,
  exit,
  isMainScript,
  runHook,
  checkNodeVersion,
  emitContext,
  isCursorRuntime,
} from '../../lib/hook-runtime.mjs';

describe('readStdin', () => {
  let originalStdin;

  beforeEach(() => {
    originalStdin = process.stdin;
  });

  afterEach(() => {
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
  });

  test('returns null when stdin is a TTY (SessionStart-style)', async () => {
    const fakeStdin = Readable.from([]);
    fakeStdin.isTTY = true;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

    const result = await readStdin();
    expect(result).toBeNull();
  });

  test('returns null when stdin is empty (no chunks)', async () => {
    const fakeStdin = Readable.from([]);
    fakeStdin.isTTY = false;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

    const result = await readStdin();
    expect(result).toBeNull();
  });

  test('parses JSON payload from stdin', async () => {
    const payload = { tool_input: { command: 'lua test --ci' } };
    const fakeStdin = Readable.from([Buffer.from(JSON.stringify(payload))]);
    fakeStdin.isTTY = false;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

    const result = await readStdin();
    expect(result).toEqual(payload);
  });

  test('handles multi-chunk stdin', async () => {
    const payload = { hook_event_name: 'PreToolUse', tool_name: 'Bash' };
    const json = JSON.stringify(payload);
    const fakeStdin = Readable.from([
      Buffer.from(json.slice(0, 10)),
      Buffer.from(json.slice(10)),
    ]);
    fakeStdin.isTTY = false;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

    const result = await readStdin();
    expect(result).toEqual(payload);
  });
});

describe('log.toClaudeCode', () => {
  let stderrSpy;

  beforeEach(() => {
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  test('appends newline if missing', () => {
    log.toClaudeCode('hello');
    expect(stderrSpy).toHaveBeenCalledWith('hello\n');
  });

  test('preserves existing trailing newline', () => {
    log.toClaudeCode('hello\n');
    expect(stderrSpy).toHaveBeenCalledWith('hello\n');
  });

  test('handles multi-line messages', () => {
    log.toClaudeCode('line1\nline2');
    expect(stderrSpy).toHaveBeenCalledWith('line1\nline2\n');
  });
});

describe('exit', () => {
  let exitSpy;
  let stderrSpy;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((data, cb) => {
      if (typeof cb === 'function') cb();
      return true;
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  test('calls process.exit with the given code after stderr flush', () => {
    expect(() => exit(0)).toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test('passes block code (2) through', () => {
    expect(() => exit(2)).toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(2);
  });
});

describe('isMainScript', () => {
  test('returns false when process.argv[1] is undefined', () => {
    const original = process.argv[1];
    process.argv[1] = undefined;
    try {
      expect(isMainScript('file:///some/path.mjs')).toBe(false);
    } finally {
      process.argv[1] = original;
    }
  });

  test('returns true when import.meta.url matches process.argv[1]', () => {
    const original = process.argv[1];
    // Cross-platform: Windows file URLs need a drive letter (file:///C:/...).
    // Build via pathToFileURL on a real temp path so this works on both POSIX and Windows.
    const real = pathJoin(tmpdir(), 'test-script.mjs');
    const url = pathToFileURL(real).href;
    process.argv[1] = real;
    try {
      expect(isMainScript(url)).toBe(true);
    } finally {
      process.argv[1] = original;
    }
  });

  test('returns false when import.meta.url differs from process.argv[1]', () => {
    expect(isMainScript(pathToFileURL(pathJoin(tmpdir(), 'different.mjs')).href)).toBe(false);
  });

  test('returns false on invalid file URL (catches gracefully)', () => {
    expect(isMainScript('not-a-valid-url')).toBe(false);
  });
});

describe('runHook', () => {
  let exitSpy;
  let stderrSpy;
  let stdoutSpy;
  let originalStdin;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((data, cb) => {
      if (typeof cb === 'function') cb();
      return true;
    });
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    originalStdin = process.stdin;
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
  });

  function mockStdin(payload) {
    const fakeStdin = Readable.from([Buffer.from(JSON.stringify(payload))]);
    fakeStdin.isTTY = false;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
  }

  test('exits 0 when decide returns null (allow)', async () => {
    mockStdin({ tool_input: { command: 'lua test' } });
    await expect(runHook('test-hook', () => null)).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test('exits 2 with reason when decide returns block', async () => {
    mockStdin({ tool_input: { command: 'evil' } });
    await expect(runHook('test-hook', () => ({ block: true, reason: 'Nope' }))).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(stderrSpy).toHaveBeenCalledWith('Nope\n');
  });

  test('uses fallback reason when block has no reason', async () => {
    mockStdin({ tool_input: { command: 'evil' } });
    await expect(runHook('my-hook', () => ({ block: true }))).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(stderrSpy).toHaveBeenCalledWith('Blocked by my-hook.\n');
  });

  test('warn path with eventName emits the documented JSON envelope on stdout', async () => {
    mockStdin({ tool_input: { command: 'risky' } });
    await expect(
      runHook('test-hook', () => ({ warn: 'be careful' }), { eventName: 'PostToolUse' })
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(0);

    const stdoutCalls = stdoutSpy.mock.calls.map((c) => c[0]);
    const payload = stdoutCalls.find((s) => s.includes('hookSpecificOutput'));
    expect(payload).toBeDefined();
    expect(JSON.parse(payload)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: 'be careful',
      },
    });
  });

  test('warn path without eventName falls back to stderr (does not silently drop)', async () => {
    mockStdin({ tool_input: { command: 'risky' } });
    await expect(runHook('test-hook', () => ({ warn: 'be careful' }))).rejects.toThrow('exit');
    expect(stderrSpy).toHaveBeenCalledWith('⚠ be careful\n');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test('fails open on decide() throwing — exits 0 with error message', async () => {
    mockStdin({ tool_input: { command: 'x' } });
    await expect(
      runHook('boom-hook', () => { throw new Error('decide blew up'); })
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Hook boom-hook error: decide blew up')
    );
  });

  test('awaits async decide functions', async () => {
    mockStdin({ tool_input: { command: 'x' } });
    await expect(
      runHook('async-hook', async () => ({ block: true, reason: 'async block' }))
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(stderrSpy).toHaveBeenCalledWith('async block\n');
  });
});

describe('emitContext', () => {
  let stdoutSpy;
  let stderrSpy;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  test.each(['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse'])(
    'emits a JSON hookSpecificOutput envelope for %s',
    (eventName) => {
      emitContext(eventName, 'hello world');
      const payload = stdoutSpy.mock.calls[0][0];
      expect(JSON.parse(payload)).toEqual({
        hookSpecificOutput: { hookEventName: eventName, additionalContext: 'hello world' },
      });
      expect(stderrSpy).not.toHaveBeenCalled();
    }
  );

  test('falls back to stderr for unsupported event names (Stop only supports decision:block)', () => {
    emitContext('Stop', 'whoops');
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith('⚠ whoops\n');
  });
});

describe('checkNodeVersion', () => {
  let exitSpy;
  let stderrSpy;
  let originalVersions;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((data, cb) => {
      if (typeof cb === 'function') cb();
      return true;
    });
    originalVersions = process.versions;
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
    Object.defineProperty(process, 'versions', { value: originalVersions, configurable: true });
  });

  test('passes silently on Node ≥18', () => {
    Object.defineProperty(process, 'versions', { value: { ...originalVersions, node: '20.10.0' }, configurable: true });
    expect(() => checkNodeVersion()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('fails-open on Node <18 with clear error message', () => {
    Object.defineProperty(process, 'versions', { value: { ...originalVersions, node: '16.20.0' }, configurable: true });
    expect(() => checkNodeVersion()).toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(0);  // Fail-open, not block
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('LUA_NODE_VERSION_TOO_OLD')
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('You have 16.20.0')
    );
  });
});

describe('isCursorRuntime — Cursor port detection', () => {
  let originalCursorTraceId;

  beforeEach(() => {
    originalCursorTraceId = process.env.CURSOR_TRACE_ID;
    delete process.env.CURSOR_TRACE_ID;
  });

  afterEach(() => {
    if (originalCursorTraceId !== undefined) {
      process.env.CURSOR_TRACE_ID = originalCursorTraceId;
    }
  });

  test('detects Cursor via CURSOR_TRACE_ID env var', () => {
    process.env.CURSOR_TRACE_ID = 'abc-123';
    expect(isCursorRuntime(null)).toBe(true);
    expect(isCursorRuntime({})).toBe(true);
    expect(isCursorRuntime({ tool_input: { command: 'foo' } })).toBe(true);
  });

  test('detects Cursor via input shape (command at top level, no tool_input)', () => {
    expect(isCursorRuntime({ command: 'lua deploy', cwd: '/tmp' })).toBe(true);
  });

  test('false on Claude Code shape (tool_input wrapper)', () => {
    expect(isCursorRuntime({ tool_input: { command: 'lua deploy' }, tool_name: 'Bash' })).toBe(false);
  });

  test('false on null/empty input with no env var', () => {
    expect(isCursorRuntime(null)).toBe(false);
    expect(isCursorRuntime({})).toBe(false);
    expect(isCursorRuntime(undefined)).toBe(false);
  });
});

describe('readStdin — Cursor input normalisation', () => {
  let originalStdin;

  beforeEach(() => {
    originalStdin = process.stdin;
  });

  afterEach(() => {
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
  });

  function fakeStdin(text) {
    const r = Readable.from([Buffer.from(text)]);
    r.isTTY = false;
    Object.defineProperty(process, 'stdin', { value: r, configurable: true });
  }

  test('normalises Cursor-shaped {command, cwd} into Claude Code shape', async () => {
    fakeStdin(JSON.stringify({ command: 'lua deploy', cwd: '/work' }));
    const result = await readStdin();
    expect(result.tool_name).toBe('Bash');
    expect(result.tool_input.command).toBe('lua deploy');
    expect(result.tool_input.cwd).toBe('/work');
    expect(result.cursor.command).toBe('lua deploy');
  });

  test('passes through Claude-Code-shaped input unchanged', async () => {
    fakeStdin(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'lua compile' } }));
    const result = await readStdin();
    expect(result.tool_input.command).toBe('lua compile');
    expect(result.cursor).toBeUndefined();
  });

  test('passes through non-shell-shape input unchanged (no command field)', async () => {
    fakeStdin(JSON.stringify({ session_id: 'abc' }));
    const result = await readStdin();
    expect(result.session_id).toBe('abc');
    expect(result.tool_input).toBeUndefined();
  });
});

describe('runHook — Cursor JSON output protocol', () => {
  let exitSpy;
  let stdoutSpy;
  let stderrSpy;
  let originalCursorTraceId;
  let originalStdin;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((data, cb) => {
      if (typeof cb === 'function') cb();
      return true;
    });
    originalCursorTraceId = process.env.CURSOR_TRACE_ID;
    process.env.CURSOR_TRACE_ID = 'cursor-test';
    originalStdin = process.stdin;
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    if (originalCursorTraceId !== undefined) process.env.CURSOR_TRACE_ID = originalCursorTraceId;
    else delete process.env.CURSOR_TRACE_ID;
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
  });

  function fakeStdin(text) {
    const r = Readable.from([Buffer.from(text)]);
    r.isTTY = false;
    Object.defineProperty(process, 'stdin', { value: r, configurable: true });
  }

  test('block decision under Cursor emits {permission: deny, ...} JSON on stdout, exits 0', async () => {
    fakeStdin(JSON.stringify({ command: 'lua deploy', cwd: '/tmp' }));
    await expect(runHook('test-hook', () => ({ block: true, reason: 'NOPE' }))).rejects.toThrow('exit');
    const written = stdoutSpy.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('"permission":"deny"'));
    expect(written).toBeDefined();
    const json = JSON.parse(written[0]);
    expect(json.permission).toBe('deny');
    expect(json.user_message).toBe('NOPE');
    expect(json.agent_message).toBe('NOPE');
    expect(exitSpy).toHaveBeenCalledWith(0);  // 0, not 2 — Cursor uses JSON
  });

  test('warn decision under Cursor emits {permission: allow, user_message} JSON on stdout', async () => {
    fakeStdin(JSON.stringify({ command: 'lua compile', cwd: '/tmp' }));
    await expect(runHook('test-hook', () => ({ warn: 'heads up' }))).rejects.toThrow('exit');
    const written = stdoutSpy.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('"permission":"allow"'));
    expect(written).toBeDefined();
    const json = JSON.parse(written[0]);
    expect(json.permission).toBe('allow');
    expect(json.user_message).toBe('heads up');
  });
});
