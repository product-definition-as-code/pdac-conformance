import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CasesError, describeSpec, discoverCases } from '../src/cases.js';

const casesDir = fileURLToPath(new URL('./fixtures/cases', import.meta.url));

describe('discoverCases', () => {
  it('loads runnable cases and records why the others were skipped', async () => {
    const discovered = await discoverCases({ cases: casesDir });

    expect(discovered.cases.map((c) => c.name)).toEqual([
      'error-bad-json',
      'expected-exit-code',
      'fail-missing',
      'fail-unexpected',
      'pass-case',
      'union-case',
    ]);
    expect(Object.fromEntries(discovered.skipped.map((s) => [s.name, s.reason]))).toEqual({
      'skip-no-expected': 'no expected.json',
      'skip-extended-format': expect.stringContaining('unknown keys: invocation, workingTree'),
      'skip-invalid-exit-code': "expected.json 'exitCode' must be an integer from 0 to 3",
    });
  });

  it('reads the expectations of a case', async () => {
    const discovered = await discoverCases({ cases: casesDir, only: ['pass-case'] });
    expect(discovered.cases).toHaveLength(1);
    expect(discovered.cases[0]?.expectedExitCode).toBe(0);
    expect(discovered.cases[0]?.expected).toEqual([
      {
        severity: 'warning',
        code: 'PRODUCT108',
        file: 'docs/product/changes/active/chg-example/change.md',
        artifact: 'CHG-EXAMPLE',
      },
    ]);
  });

  it('loads a supported expected exit code', async () => {
    const discovered = await discoverCases({ cases: casesDir, only: ['expected-exit-code'] });
    expect(discovered.cases[0]?.expectedExitCode).toBe(2);
    expect(discovered.skipped).toEqual([]);
  });

  it('rejects a case name the conformance tests do not have', async () => {
    await expect(discoverCases({ cases: casesDir, only: ['no-such-case'] })).rejects.toThrow(
      /no such case/,
    );
  });

  it('rejects a directory that holds no conformance tests', async () => {
    await expect(discoverCases({ cases: `${casesDir}/nowhere` })).rejects.toThrow(CasesError);
  });

  it('requires a conformance tests location', async () => {
    await expect(discoverCases({})).rejects.toThrow(/no conformance tests given/);
  });
});

describe('describeSpec', () => {
  it('reports a directory outside any Git work tree without a revision', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'pdac-lint-nogit-'));
    try {
      const source = await describeSpec(outside, casesDir);
      expect(source).toEqual({
        cases: casesDir,
        root: outside,
        revision: null,
        branch: null,
        dirty: null,
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('names the revision of a Git checkout', async () => {
    const source = await describeSpec(fileURLToPath(new URL('..', import.meta.url)), casesDir);
    expect(source.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof source.dirty).toBe('boolean');
  });
});
