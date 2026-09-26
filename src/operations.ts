import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual, promisify } from 'node:util';
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { TestCase } from './cases.js';
import { compareDiagnostics, findOrderingViolation } from './compare.js';
import { parseDiagnostics } from './envelope.js';
import { runCommand, splitCommand } from './execute.js';
import type { CaseResult, ExpectedExitCode } from './types.js';
import { parseDocument } from 'yaml';

export interface OperationCase {
  format: 'pdac-conformance-case/v2';
  operation: 'validate' | 'apply' | 'apply-dry-run' | 'verify-evidence';
  change?: string;
  evidence?: string[];
  currentEvidence?: string[];
  history?: string[];
  exitCode: ExpectedExitCode;
  reports: Record<string, unknown>;
  tree: { unchanged: true } | { after: string; optionalAbsent?: string[] };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function fixturePath(root: string, path: string): string {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes('\\') ||
    path.split('/').some((s) => !s || s === '.' || s === '..' || s === '.git') ||
    path.includes(':')
  ) {
    throw new Error(`invalid fixture-relative path: ${path}`);
  }
  const target = resolve(root, path);
  if (!target.startsWith(resolve(root) + sep)) throw new Error(`path escapes fixture: ${path}`);
  return target;
}

export function parseOperationCase(value: Record<string, unknown>): OperationCase {
  const allowed = [
    'format',
    'operation',
    'change',
    'evidence',
    'currentEvidence',
    'history',
    'diagnostics',
    'exitCode',
    'reports',
    'tree',
  ];
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) throw new Error(`unknown v2 case keys: ${extra.join(', ')}`);
  if (value.format !== 'pdac-conformance-case/v2')
    throw new Error('unsupported operation case version');
  if (!['validate', 'apply', 'apply-dry-run', 'verify-evidence'].includes(String(value.operation)))
    throw new Error('unsupported operation');
  if (![0, 1, 2, 3].includes(value.exitCode as number))
    throw new Error('v2 case requires exitCode 0–3');
  if (!Array.isArray(value.diagnostics) || !value.diagnostics.every(record))
    throw new Error('v2 case requires diagnostic objects');
  if (!record(value.reports)) throw new Error('v2 case requires reports object');
  if (
    value.change !== undefined &&
    (typeof value.change !== 'string' || !/^CHG-[A-Z0-9]+(-[A-Z0-9]+)*$/.test(value.change))
  )
    throw new Error('invalid selected change');
  if (String(value.operation).startsWith('apply') && !value.change)
    throw new Error('apply requires a selected change');
  for (const key of ['history', 'evidence', 'currentEvidence']) {
    if (value[key] === undefined) continue;
    if (!Array.isArray(value[key]) || !value[key].every((p) => typeof p === 'string'))
      throw new Error(`${key} must be a path list`);
    for (const path of value[key] as string[]) fixturePath(tmpdir(), path);
  }
  if (!record(value.tree)) throw new Error('v2 case requires tree assertion');
  if (value.tree.unchanged === true) {
    if (Object.keys(value.tree).length !== 1)
      throw new Error('unchanged tree cannot carry other keys');
  } else {
    if (
      typeof value.tree.after !== 'string' ||
      Object.keys(value.tree).some((k) => !['after', 'optionalAbsent'].includes(k))
    )
      throw new Error('invalid after tree');
    fixturePath(tmpdir(), value.tree.after);
    if (value.tree.optionalAbsent !== undefined) {
      if (
        !Array.isArray(value.tree.optionalAbsent) ||
        !value.tree.optionalAbsent.every((p) => typeof p === 'string')
      )
        throw new Error('invalid optionalAbsent');
      for (const p of value.tree.optionalAbsent as string[]) fixturePath(tmpdir(), p);
    }
  }
  return value as unknown as OperationCase;
}

/** Compare all ordinary files, including untracked outputs; Git administration is separate. */
export async function treeSnapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (dir === root && entry.name === '.git') continue;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`symlinks are unsupported in operation fixtures: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile())
        files[relative(root, path).split(sep).join('/')] = createHash('sha256')
          .update(await readFile(path))
          .digest('hex');
      else throw new Error(`unsupported fixture entry: ${path}`);
    }
  }
  await visit(root);
  return files;
}

const exec = promisify(execFile);
async function git(work: string, args: string[]): Promise<string> {
  const { stdout } = await exec(
    'git',
    ['-c', 'core.autocrlf=false', '-c', 'core.hooksPath=/dev/null', ...args],
    {
      cwd: work,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Conformance',
        GIT_AUTHOR_EMAIL: 'conformance@example.invalid',
        GIT_COMMITTER_NAME: 'Conformance',
        GIT_COMMITTER_EMAIL: 'conformance@example.invalid',
        GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
        GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
      },
    },
  );
  return stdout.trim();
}

async function copySafe(from: string, to: string): Promise<void> {
  if (!(await lstat(from)).isDirectory())
    throw new Error(`fixture tree is not a directory: ${from}`);
  await treeSnapshot(from);
  if ((await readdir(from)).includes('.git'))
    throw new Error('fixtures cannot supply Git administration');
  await cp(from, to, { recursive: true });
}

async function substituteRevisions(root: string, revisions: string[]): Promise<void> {
  const paths = Object.keys(await treeSnapshot(root));
  for (const path of paths) {
    const bytes = await readFile(join(root, path));
    if (!bytes.includes(Buffer.from('{{revision:'))) continue;
    const text = bytes.toString('utf8').replace(/\{\{revision:(\d+)\}\}/g, (_, index: string) => {
      const sha = revisions[Number(index)];
      if (!sha) throw new Error(`unknown revision placeholder ${index}`);
      return sha;
    });
    await writeFile(join(root, path), text);
  }
}

function archivedChange(text: string): unknown {
  const normalized = text.replace(/\r\n?/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) throw new Error('archived change has no frontmatter');
  const document = parseDocument(match[1]!);
  if (document.errors.length) throw new Error('archived change has invalid frontmatter');
  return { frontmatter: document.toJS(), body: match[2] };
}

async function gitState(work: string): Promise<unknown> {
  return {
    head: await git(work, ['symbolic-ref', 'HEAD']),
    refs: await git(work, ['for-each-ref', '--format=%(refname) %(objectname)']),
    index: await git(work, ['ls-files', '--stage']),
  };
}

export async function runOperationCase(
  testCase: TestCase,
  adapter: string | undefined,
  keep: boolean,
  timeoutMs: number,
): Promise<CaseResult> {
  const descriptor = testCase.operation!;
  const result: CaseResult = {
    name: testCase.name,
    status: 'pass',
    expectedExitCode: descriptor.exitCode,
    exitCodeMismatches: [],
    missing: [],
    unexpected: [],
    runs: [],
    exercises: [],
  };
  if (!adapter)
    return {
      ...result,
      status: 'skip',
      reason: 'v2 operation case requires --adapter-command; no partial validation run performed',
    };
  const scratch = await mkdtemp(join(tmpdir(), 'pdac-operation-'));
  const work = join(scratch, 'repo');
  await mkdir(work);
  if (keep) result.workDir = work;
  try {
    await git(work, ['init', '--quiet']);
    const revisions: string[] = [];
    for (const source of descriptor.history ?? []) {
      for (const name of await readdir(work))
        if (name !== '.git') await rm(join(work, name), { recursive: true, force: true });
      await copySafe(fixturePath(testCase.dir, source), work);
      await substituteRevisions(work, revisions);
      await git(work, ['add', '--all']);
      await git(work, [
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '--allow-empty',
        '-m',
        `fixture ${revisions.length}`,
      ]);
      revisions.push(await git(work, ['rev-parse', 'HEAD']));
    }
    await copySafe(testCase.repoDir, work);
    await substituteRevisions(work, revisions);
    const before = await treeSnapshot(work);
    const gitBefore = await gitState(work);
    const request = join(scratch, 'request.json');
    await writeFile(
      request,
      JSON.stringify({
        operation: descriptor.operation,
        change: descriptor.change,
        evidence: descriptor.evidence ?? [],
        currentEvidence: descriptor.currentEvidence ?? [],
        revisions,
      }),
    );
    const argv = [...splitCommand(adapter), '--request', request];
    const spawned = await runCommand(argv, work, timeoutMs);
    result.runs.push({ argv, ...spawned });
    if (spawned.exitCode !== descriptor.exitCode)
      result.exitCodeMismatches.push({
        argv,
        expected: descriptor.exitCode,
        actual: spawned.exitCode,
      });
    const output: unknown = JSON.parse(spawned.stdout);
    if (!record(output) || !Array.isArray(output.diagnostics))
      throw new Error('adapter must return a JSON object with diagnostics');
    const diagnostics = parseDiagnostics(spawned.stdout);
    const comparison = compareDiagnostics(testCase.expected, diagnostics);
    result.missing = comparison.missing;
    result.unexpected = comparison.unexpected;
    result.ordering = findOrderingViolation(diagnostics);
    const failures: string[] = [];
    for (const [key, expected] of Object.entries(descriptor.reports)) {
      // A null expectation asserts absence, distinguishing a blocked gate from evaluated zero.
      if (expected === null ? key in output : !isDeepStrictEqual(output[key], expected))
        failures.push(`report '${key}' differs`);
    }
    let expectedTree = before;
    if ('after' in descriptor.tree) {
      const after = join(scratch, 'expected');
      await copySafe(fixturePath(testCase.dir, descriptor.tree.after), after);
      await substituteRevisions(after, revisions);
      expectedTree = await treeSnapshot(after);
    }
    const actualTree = await treeSnapshot(work);
    if ('after' in descriptor.tree) {
      // Optional generated product diffs are permitted by the spec. An adapter
      // identifies and decodes them; no other extra output is exempted.
      if (output.persistedProductDiffs !== undefined) {
        if (!Array.isArray(output.persistedProductDiffs))
          throw new Error('invalid persisted product diff observations');
        for (const observation of output.persistedProductDiffs) {
          if (
            !record(observation) ||
            typeof observation.file !== 'string' ||
            !Array.isArray(descriptor.reports.productDiff)
          )
            throw new Error('unverifiable persisted product diff');
          fixturePath(work, observation.file);
          if (
            observation.file in before ||
            observation.file in expectedTree ||
            !(observation.file in actualTree) ||
            observation.file.includes('/changes/')
          )
            throw new Error('persisted diff path overlaps canonical or existing content');
          if (!isDeepStrictEqual(observation.productDiff, descriptor.reports.productDiff))
            failures.push('persisted product diff differs');
          else delete actualTree[observation.file];
        }
      }
      const afterRoot = join(scratch, 'expected');
      for (const path of Object.keys(expectedTree)) {
        if (!(path in actualTree) || before[path] === expectedTree[path]) continue;
        const expectedBytes = await readFile(join(afterRoot, path));
        const actualBytes = await readFile(join(work, path));
        const normalize = (bytes: Buffer): string =>
          bytes.toString('latin1').replace(/\r\n?/g, '\n');
        // Apply does not prescribe YAML formatting for the archived change.
        const equal = /\/changes\/completed\/[^/]+\/change\.md$/.test(path)
          ? isDeepStrictEqual(
              archivedChange(actualBytes.toString('utf8')),
              archivedChange(expectedBytes.toString('utf8')),
            )
          : normalize(actualBytes) === normalize(expectedBytes);
        if (equal) actualTree[path] = expectedTree[path]!;
      }
      for (const path of descriptor.tree.optionalAbsent ?? []) {
        if (!(path in expectedTree))
          throw new Error(`optionalAbsent does not name an expected file: ${path}`);
        if (!(path in actualTree)) delete expectedTree[path];
      }
    }
    if (!isDeepStrictEqual(actualTree, expectedTree))
      failures.push('working tree differs from required result');
    if (!isDeepStrictEqual(await gitState(work), gitBefore))
      failures.push('operation changed Git refs or staged files');
    if (failures.length) result.reason = failures.join('; ');
    if (
      failures.length ||
      result.exitCodeMismatches.length ||
      result.missing.length ||
      result.unexpected.length ||
      result.ordering
    )
      result.status = 'fail';
  } catch (error) {
    result.status = 'error';
    result.reason = (error as Error).message;
  } finally {
    if (!keep) await rm(scratch, { recursive: true, force: true });
  }
  return result;
}
