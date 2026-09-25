import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOperationCase, runOperationCase, type OperationCase } from '../src/operations.js';
import type { TestCase } from '../src/cases.js';
import { discoverCases } from '../src/cases.js';

const temps: string[] = [];
afterEach(async () => {
  for (const path of temps.splice(0)) await rm(path, { recursive: true, force: true });
});

async function fixture(body: string, overrides: Partial<OperationCase> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pdac-operation-test-'));
  temps.push(root);
  const dir = join(root, 'cases', 'example');
  const repoDir = join(dir, 'repo');
  await mkdir(repoDir, { recursive: true });
  await writeFile(join(repoDir, 'model.md'), 'before\n');
  const operation: OperationCase = {
    format: 'pdac-conformance-case/v2',
    operation: 'apply-dry-run',
    change: 'CHG-A',
    exitCode: 0,
    reports: { affectedCitations: { count: 0, records: [] } },
    tree: { unchanged: true },
    ...overrides,
  };
  const testCase: TestCase = {
    name: 'example',
    dir,
    repoDir,
    expected: [],
    expectedExitCode: operation.exitCode,
    operation,
  };
  const adapter = join(root, 'adapter.mjs');
  await writeFile(
    adapter,
    `import fs from 'node:fs'; const request = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--request') + 1], 'utf8')); ${body}`,
  );
  await writeFile(join(dir, 'expected.json'), JSON.stringify({ ...operation, diagnostics: [] }));
  return { root, testCase, command: `"${process.execPath}" "${adapter}"` };
}
const zero =
  'console.log(JSON.stringify({diagnostics: [], affectedCitations: {count: 0, records: []}}));';

describe('operation case execution', () => {
  it('executes the adapter and requires evaluated zero', async () => {
    const f = await fixture(zero);
    expect((await runOperationCase(f.testCase, f.command, false, 10000)).status).toBe('pass');
    expect(await readFile(join(f.testCase.repoDir, 'model.md'), 'utf8')).toBe('before\n');
  });
  it('does not pass a missing report as an evaluated zero', async () => {
    const f = await fixture('console.log(JSON.stringify({diagnostics: []}));');
    expect((await runOperationCase(f.testCase, f.command, false, 10000)).status).toBe('fail');
  });
  it('rejects writes by dry run, including an untracked forecast file', async () => {
    const f = await fixture(`fs.writeFileSync('forecast.json', '{}'); ${zero}`);
    const r = await runOperationCase(f.testCase, f.command, false, 10000);
    expect(r.status).toBe('fail');
    expect(r.reason).toContain('working tree');
  });
  it('checks failed-gate exit code, unchanged tree and absence of forecast', async () => {
    const f = await fixture(
      'console.log(JSON.stringify({diagnostics: []})); process.exitCode = 1;',
      { exitCode: 1, reports: { affectedCitations: null } },
    );
    expect((await runOperationCase(f.testCase, f.command, false, 10000)).status).toBe('pass');
    const bad = await fixture(`${zero} process.exitCode = 1;`, {
      exitCode: 1,
      reports: { affectedCitations: null },
    });
    expect((await runOperationCase(bad.testCase, bad.command, false, 10000)).status).toBe('fail');
  });
  it('compares record order and preserves duplicate occurrences', async () => {
    const expected = {
      count: 2,
      records: [
        { file: 'a', line: 1, target: 'FR-A', status: 'stale' },
        { file: 'a', line: 2, target: 'FR-A', status: 'stale' },
      ],
    };
    const f = await fixture(
      `console.log(JSON.stringify({diagnostics: [], affectedCitations: ${JSON.stringify({ ...expected, records: [...expected.records].reverse() })}}));`,
      { reports: { affectedCitations: expected } },
    );
    expect((await runOperationCase(f.testCase, f.command, false, 10000)).status).toBe('fail');
  });
  it('materializes a real baseline commit and resolves its placeholder', async () => {
    const f = await fixture(
      `if (!/^[0-9a-f]{40}$/.test(request.revisions[0]) || fs.readFileSync('change.md', 'utf8') !== request.revisions[0]) throw Error('bad revision'); ${zero}`,
      { history: ['history/base'] },
    );
    await mkdir(join(f.testCase.dir, 'history/base'), { recursive: true });
    await writeFile(join(f.testCase.dir, 'history/base/model.md'), 'old\n');
    await writeFile(join(f.testCase.repoDir, 'change.md'), '{{revision:0}}');
    expect((await runOperationCase(f.testCase, f.command, false, 10000)).status).toBe('pass');
  });
  it('checks the complete after tree and permits only declared optional absence', async () => {
    const f = await fixture(`fs.writeFileSync('model.md', 'after\\n'); ${zero}`, {
      operation: 'apply',
      tree: { after: 'after', optionalAbsent: ['archive/proposed.md'] },
    });
    await mkdir(join(f.testCase.dir, 'after/archive'), { recursive: true });
    await writeFile(join(f.testCase.dir, 'after/model.md'), 'after\n');
    await writeFile(join(f.testCase.dir, 'after/archive/proposed.md'), 'proposal');
    expect((await runOperationCase(f.testCase, f.command, false, 10000)).status).toBe('pass');
    f.testCase.operation!.tree = { after: 'after' };
    expect((await runOperationCase(f.testCase, f.command, false, 10000)).status).toBe('fail');
  });
  it('skips missing adapters by name rather than running flat validation', async () => {
    const f = await fixture(zero);
    const result = await runOperationCase(f.testCase, undefined, false, 10000);
    expect(result.status).toBe('skip');
    expect(result.runs).toEqual([]);
    expect(
      (await discoverCases({ cases: join(f.root, 'cases') })).cases[0]?.operation?.operation,
    ).toBe('apply-dry-run');
  });

  it('permits equivalent archived YAML but rejects an altered rationale', async () => {
    const path = 'docs/product/changes/completed/chg-a/change.md';
    const f = await fixture(
      `fs.mkdirSync('docs/product/changes/completed/chg-a', {recursive: true}); fs.writeFileSync('${path}', '---\\nstatus: applied\\nid: CHG-A\\n---\\nRationale.\\n'); ${zero}`,
      { operation: 'apply', tree: { after: 'after' } },
    );
    await mkdir(join(f.testCase.dir, 'after', 'docs/product/changes/completed/chg-a'), {
      recursive: true,
    });
    await writeFile(join(f.testCase.dir, 'after/model.md'), 'before\n');
    await writeFile(
      join(f.testCase.dir, 'after', path),
      '---\nid: CHG-A\nstatus: applied\n---\nRationale.\n',
    );
    expect((await runOperationCase(f.testCase, f.command, false, 10000)).status).toBe('pass');
    await writeFile(
      join(f.testCase.dir, 'after', path),
      '---\nid: CHG-A\nstatus: applied\n---\nDifferent rationale.\n',
    );
    expect((await runOperationCase(f.testCase, f.command, false, 10000)).status).toBe('fail');
  });

  it('allows only observed generated diffs that match the asserted product diff', async () => {
    const f = await fixture(
      `fs.writeFileSync('diff.json', '[]'); console.log(JSON.stringify({diagnostics: [], productDiff: [], persistedProductDiffs: [{file: 'diff.json', productDiff: []}]}));`,
      { operation: 'apply', reports: { productDiff: [] }, tree: { after: 'after' } },
    );
    await mkdir(join(f.testCase.dir, 'after'));
    await writeFile(join(f.testCase.dir, 'after/model.md'), 'before\n');
    expect((await runOperationCase(f.testCase, f.command, false, 10000)).status).toBe('pass');
    f.testCase.operation!.reports.productDiff = [{ id: 'FR-A', kind: 'removed' }];
    expect((await runOperationCase(f.testCase, f.command, false, 10000)).status).toBe('fail');
  });
  it('rejects fixture commands, traversal and malformed trees', () => {
    const base = {
      format: 'pdac-conformance-case/v2',
      operation: 'validate',
      exitCode: 0,
      diagnostics: [],
      reports: {},
      tree: { unchanged: true },
    };
    expect(() => parseOperationCase({ ...base, command: 'anything' })).toThrow('unknown');
    expect(() => parseOperationCase({ ...base, history: ['../escape'] })).toThrow('path');
    expect(() => parseOperationCase({ ...base, tree: { unchanged: true, after: 'x' } })).toThrow(
      'other keys',
    );
  });
});
