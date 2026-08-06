import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CorpusError, describeSpec, discoverCorpus } from '../src/corpus.js';

const corpusDir = fileURLToPath(new URL('./fixtures/corpus', import.meta.url));

describe('discoverCorpus', () => {
  it('loads runnable cases and records why the others were skipped', async () => {
    const corpus = await discoverCorpus({ cases: corpusDir });

    expect(corpus.cases.map((c) => c.name)).toEqual([
      'error-bad-json',
      'fail-missing',
      'fail-unexpected',
      'pass-case',
      'union-case',
    ]);
    expect(Object.fromEntries(corpus.skipped.map((s) => [s.name, s.reason]))).toEqual({
      'skip-no-expected': 'no expected.json',
      'skip-extended-format': expect.stringContaining('unknown keys: invocation, exitCode'),
    });
  });

  it('reads the expectations of a case', async () => {
    const corpus = await discoverCorpus({ cases: corpusDir, only: ['pass-case'] });
    expect(corpus.cases).toHaveLength(1);
    expect(corpus.cases[0]?.expected).toEqual([
      {
        severity: 'warning',
        code: 'PRODUCT108',
        file: 'docs/product/changes/active/chg-example/change.md',
        artifact: 'CHG-EXAMPLE',
      },
    ]);
  });

  it('rejects a case name the corpus does not have', async () => {
    await expect(discoverCorpus({ cases: corpusDir, only: ['no-such-case'] })).rejects.toThrow(
      /no such case/,
    );
  });

  it('rejects a directory that holds no corpus', async () => {
    await expect(discoverCorpus({ cases: `${corpusDir}/nowhere` })).rejects.toThrow(CorpusError);
  });

  it('requires a corpus location', async () => {
    await expect(discoverCorpus({})).rejects.toThrow(/no corpus given/);
  });
});

describe('describeSpec', () => {
  it('reports a directory outside any Git work tree without a revision', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'pdac-lint-nogit-'));
    try {
      const source = await describeSpec(outside, corpusDir);
      expect(source).toEqual({ cases: corpusDir, root: outside });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('names the revision of a Git checkout', async () => {
    const source = await describeSpec(fileURLToPath(new URL('..', import.meta.url)), corpusDir);
    expect(source.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof source.dirty).toBe('boolean');
  });
});
