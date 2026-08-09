import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Diagnostic, SkippedCase, SpecSource } from './types.js';

export type { SkippedCase } from './types.js';

const run = promisify(execFile);

/** The conformance tests live at this path inside a spec checkout. */
export const casesRelative = join('conformance', 'cases');

export interface TestCase {
  name: string;
  dir: string;
  /** The fixture repository to run the implementation against. */
  repoDir: string;
  expected: Diagnostic[];
}

export interface CaseSet {
  source: SpecSource;
  cases: TestCase[];
  skipped: SkippedCase[];
}

export class CasesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CasesError';
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run('git', args, { cwd, windowsHide: true });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * Name the revision the conformance tests came from, so a result is attributable to a spec state
 * rather than to "whatever was on disk". A checkout that is not a Git working tree still runs; it is
 * simply reported without a revision, and no caller should mistake it for a pinned one.
 */
export async function describeSpec(root: string, casesDir: string): Promise<SpecSource> {
  const source: SpecSource = { cases: casesDir, root };
  const inTree = await git(root, ['rev-parse', '--is-inside-work-tree']);
  if (inTree !== 'true') return source;

  source.revision = await git(root, ['rev-parse', 'HEAD']);
  const branch = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch && branch !== 'HEAD') source.branch = branch;
  const status = await git(root, ['status', '--porcelain']);
  source.dirty = status !== undefined && status.length > 0;
  return source;
}

/**
 * Load one case directory.
 *
 * A case this runner cannot execute is skipped by name and reason, never dropped. `expected.json`
 * carrying anything beyond `diagnostics` is the case reaching for the case-format extension the
 * apply cases need (an apply invocation, an expected exit code, a working-tree outcome); running
 * such a case on the diagnostics rules alone would report a pass for half a case.
 */
async function loadCase(dir: string, name: string): Promise<TestCase | SkippedCase> {
  const repoDir = join(dir, 'repo');
  const expectedFile = join(dir, 'expected.json');

  if (!(await isDirectory(repoDir))) return { name, reason: 'no repo/ fixture' };

  let raw: string;
  try {
    raw = await readFile(expectedFile, 'utf8');
  } catch {
    return { name, reason: 'no expected.json' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { name, reason: `expected.json is not JSON: ${(error as Error).message}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { name, reason: 'expected.json is not an object' };
  }

  const keys = Object.keys(parsed);
  const unknown = keys.filter((key) => key !== 'diagnostics');
  if (unknown.length > 0) {
    return {
      name,
      reason: `expected.json uses a case format this runner does not support (unknown keys: ${unknown.join(', ')})`,
    };
  }

  const diagnostics = (parsed as { diagnostics?: unknown }).diagnostics;
  if (!Array.isArray(diagnostics)) {
    return { name, reason: "expected.json has no 'diagnostics' array" };
  }

  return { name, dir, repoDir, expected: diagnostics as Diagnostic[] };
}

export interface DiscoverOptions {
  /** A spec checkout; the conformance tests are read from its conformance/cases directory. */
  spec?: string;
  /** An explicit conformance tests directory, which wins over `spec`. */
  cases?: string;
  /** Run only these case names. */
  only?: string[];
}

/** Discover the conformance tests, in directory order, which is their own stable order. */
export async function discoverCases(options: DiscoverOptions): Promise<CaseSet> {
  const casesDir = options.cases
    ? resolve(options.cases)
    : options.spec
      ? join(resolve(options.spec), casesRelative)
      : undefined;

  if (!casesDir) {
    throw new CasesError(
      'no conformance tests given: pass --spec <spec checkout> or --cases <directory>',
    );
  }
  if (!(await isDirectory(casesDir))) {
    throw new CasesError(`no conformance tests at ${casesDir}`);
  }

  const entries = (await readdir(casesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (options.only && options.only.length > 0) {
    const missing = options.only.filter((name) => !entries.includes(name));
    if (missing.length > 0) {
      throw new CasesError(`no such case in ${casesDir}: ${missing.join(', ')}`);
    }
  }

  const selected = options.only?.length
    ? entries.filter((n) => options.only?.includes(n))
    : entries;

  const cases: TestCase[] = [];
  const skipped: SkippedCase[] = [];
  for (const name of selected) {
    const loaded = await loadCase(join(casesDir, name), name);
    if ('reason' in loaded) skipped.push(loaded);
    else cases.push(loaded);
  }

  const source = options.spec
    ? await describeSpec(resolve(options.spec), casesDir)
    : { cases: casesDir };

  return { source, cases, skipped };
}
