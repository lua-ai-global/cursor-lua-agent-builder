import { describe, test, expect } from '@jest/globals';
import { decide } from '../../hooks/before-shell-execution.mjs';

describe('before-shell-execution decide() — Cursor safety hook', () => {
  describe('lua auth key — credential-leak prevention', () => {
    test('blocks `lua auth key`', () => {
      const r = decide({ tool_input: { command: 'lua auth key' } });
      expect(r?.block).toBe(true);
      expect(r?.reason).toContain('DEPLOY_DENIED_AUTH_KEY');
    });

    test('blocks `lua auth key --force`', () => {
      const r = decide({ tool_input: { command: 'lua auth key --force' } });
      expect(r?.block).toBe(true);
      expect(r?.reason).toContain('DEPLOY_DENIED_AUTH_KEY');
    });

    test('does NOT block `lua auth configure`', () => {
      expect(decide({ tool_input: { command: 'lua auth configure --email a@b.com' } })).toBeNull();
    });
  });

  describe('--auto-deploy — bypass prevention', () => {
    test('blocks `lua push --auto-deploy`', () => {
      const r = decide({ tool_input: { command: 'lua push all --auto-deploy' } });
      expect(r?.block).toBe(true);
      expect(r?.reason).toContain('DEPLOY_DENIED_AUTO');
    });

    test('blocks `--auto-deploy=true` variant', () => {
      const r = decide({ tool_input: { command: 'lua push --auto-deploy=true' } });
      expect(r?.block).toBe(true);
    });

    test('does NOT block `lua push --force`', () => {
      expect(decide({ tool_input: { command: 'lua push all --force' } })).toBeNull();
    });
  });

  describe('bare `lua deploy` — §3.3 confirmation gate', () => {
    test('blocks bare `lua deploy`', () => {
      const r = decide({ tool_input: { command: 'lua deploy skill --name foo --skill-version 1.0.0 --force' } });
      expect(r?.block).toBe(true);
      expect(r?.reason).toContain('DEPLOY_DENIED_BARE');
    });

    test('allows `LUA_DEPLOY_CONFIRMED=1 lua deploy`', () => {
      expect(decide({ tool_input: { command: 'LUA_DEPLOY_CONFIRMED=1 lua deploy skill --name foo --skill-version 1.0.0 --force' } })).toBeNull();
    });

    test('allows `env LUA_DEPLOY_CONFIRMED=1 lua deploy`', () => {
      expect(decide({ tool_input: { command: 'env LUA_DEPLOY_CONFIRMED=1 lua deploy --force' } })).toBeNull();
    });

    test('does NOT block `lua deploys` (lookalike)', () => {
      expect(decide({ tool_input: { command: 'lua deploys' } })).toBeNull();
    });
  });

  describe('graceful fallthrough', () => {
    test('allows other commands', () => {
      expect(decide({ tool_input: { command: 'lua compile --ci' } })).toBeNull();
      expect(decide({ tool_input: { command: 'lua test --ci skill --name foo' } })).toBeNull();
      expect(decide({ tool_input: { command: 'echo hello' } })).toBeNull();
    });

    test('handles missing input gracefully', () => {
      expect(decide(null)).toBeNull();
      expect(decide({})).toBeNull();
      expect(decide({ tool_input: {} })).toBeNull();
      expect(decide({ tool_input: { command: '' } })).toBeNull();
    });
  });
});
