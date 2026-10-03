import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCKFILES = ['package-lock.json', 'mcp/lua-platform/package-lock.json'];
const readLock = (rel) => {
  if (!LOCKFILES.includes(rel)) throw new Error(`unexpected lockfile ${rel}`);
  return JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8'));
};

const parse = (v) => v.split('.').map((n) => parseInt(n, 10));
const lt = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
};

const resolved = (lock, name) =>
  Object.entries(lock.packages)
    .filter(([p]) => p === `node_modules/${name}` || p.endsWith(`/node_modules/${name}`))
    .map(([p, e]) => ({ path: p, version: e.version }));

const FIXED = { 3: '3.15.2', 4: '4.3.2' };

describe.each(LOCKFILES)('%s', (rel) => {
  const lock = readLock(rel);

  test('js-yaml@4.3.2 / js-yaml@3.15.2: every resolved js-yaml is at or above its fixed line', () => {
    const entries = resolved(lock, 'js-yaml');
    expect(entries.length).toBeGreaterThan(0);
    for (const { version } of entries) {
      const major = parseInt(version, 10);
      expect(FIXED[major]).toBeDefined();
      expect(lt(version, FIXED[major])).toBe(false);
    }
  });

  test('no vulnerable js-yaml@3.15.1 or js-yaml@4.3.1 literal remains', () => {
    const versions = resolved(lock, 'js-yaml').map((e) => e.version);
    expect(versions).not.toContain('3.15.1');
    expect(versions).not.toContain('4.3.1');
  });

  test('browserslist stays above 4.28.6 (4.28.7)', () => {
    const entries = resolved(lock, 'browserslist');
    expect(entries.length).toBeGreaterThan(0);
    for (const { version } of entries) expect(lt('4.28.6', version)).toBe(true);
  });

  test('baseline-browser-mapping stays at or above 2.11.0 (2.11.1)', () => {
    const entries = resolved(lock, 'baseline-browser-mapping');
    expect(entries.length).toBeGreaterThan(0);
    for (const { version } of entries) expect(lt(version, '2.11.0')).toBe(false);
  });

  test('resolved versions stay on their current major lines', () => {
    for (const { version } of resolved(lock, 'browserslist')) expect(parseInt(version, 10)).toBe(4);
    for (const { version } of resolved(lock, 'baseline-browser-mapping')) {
      expect(parseInt(version, 10)).toBe(2);
    }
    for (const { version } of resolved(lock, 'js-yaml')) {
      expect([3, 4]).toContain(parseInt(version, 10));
    }
  });
});

describe('version boundaries', () => {
  test.each([
    ['4.28.7', '4.28.7'],
    ['3.15.2', FIXED[3]],
    ['4.3.2', FIXED[4]],
    ['2.11.1', '2.11.0'],
  ])('fixed %s is not flagged', (v, floor) => {
    expect(lt(v, floor)).toBe(false);
  });

  test.each([
    ['4.28.6', '4.28.7'],
    ['3.15.1', FIXED[3]],
    ['4.3.1', FIXED[4]],
    ['2.10.0', '2.11.0'],
  ])('vulnerable %s is flagged', (v, floor) => {
    expect(lt(v, floor)).toBe(true);
  });
});

describe('package-lock.json', () => {
  const lock = readLock('package-lock.json');

  test('node_modules/@istanbuljs/load-nyc-config/node_modules/js-yaml is 3.15.2', () => {
    expect(
      lock.packages['node_modules/@istanbuljs/load-nyc-config/node_modules/js-yaml'].version,
    ).toBe('3.15.2');
  });
});
