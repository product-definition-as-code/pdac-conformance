import { compareDiagnostics, findOrderingViolation, toComparable } from './compare.js';
import { discoverCases, type TestCase, type DiscoverOptions } from './cases.js';
import { parseDiagnostics } from './envelope.js';
import {
  runCommand,
  splitCommand,
  TimeoutError,
  withFixtureCopy,
  withJsonFormat,
} from './execute.js';
import {
  reportSchema,
  type CaseResult,
  type CommandRun,
  type Diagnostic,
  type Report,
} from './types.js';

/** Two minutes is generous for validating a fixture and short enough to fail a hung CI job. */
export const defaultTimeoutMs = 120_000;

export interface RunOptions extends DiscoverOptions {
  /** Implementation commands, each an unsplit command string. At least one is required. */
  commands: string[];
  keep?: boolean;
  timeoutMs?: number;
}

/** Identify a diagnostic by its compared fields, so the union across commands does not double up. */
function fingerprint(diagnostic: Diagnostic): string {
  const c = toComparable(diagnostic);
  return JSON.stringify([c.severity, c.code, c.file, c.artifact, c.field, c.target]);
}

/**
 * Exit `1` means the implementation found errors, which for a fixture designed to contain them is
 * the correct outcome. `2` and `3` are the spec's invocation and internal-failure codes: the run
 * itself did not happen, so the case is an error rather than a failure.
 */
function invocationFailure(run: CommandRun): string | undefined {
  if (run.exitCode === 2) return `'${run.argv.join(' ')}' rejected the invocation (exit 2)`;
  if (run.exitCode >= 3) return `'${run.argv.join(' ')}' failed (exit ${run.exitCode})`;
  return undefined;
}

async function runCase(
  testCase: TestCase,
  commands: string[][],
  options: RunOptions,
): Promise<CaseResult> {
  const result: CaseResult = {
    name: testCase.name,
    status: 'pass',
    missing: [],
    unexpected: [],
    runs: [],
  };

  await withFixtureCopy(testCase.repoDir, testCase.name, options.keep ?? false, async (work) => {
    if (options.keep) result.workDir = work;

    const seen = new Set<string>();
    const union: Diagnostic[] = [];

    for (const argv of commands) {
      let spawned;
      try {
        spawned = await runCommand(argv, work, options.timeoutMs ?? defaultTimeoutMs);
      } catch (error) {
        // A command that hung is a verdict on the implementation. A command that could not be
        // started at all is a verdict on the configuration, so that one keeps travelling.
        if (!(error instanceof TimeoutError)) throw error;
        result.status = 'error';
        result.reason = (error as Error).message;
        return;
      }
      const run: CommandRun = { argv, ...spawned };
      result.runs.push(run);

      const rejected = invocationFailure(run);
      if (rejected) {
        result.status = 'error';
        result.reason = rejected;
        return;
      }

      let diagnostics: Diagnostic[];
      try {
        diagnostics = parseDiagnostics(run.stdout);
      } catch (error) {
        result.status = 'error';
        result.reason = `'${argv.join(' ')}': ${(error as Error).message}`;
        return;
      }

      // Ordering is asserted per command: each invocation must emit its own diagnostics in the
      // mandated order. Concatenating two commands' outputs says nothing about either.
      const violation = findOrderingViolation(diagnostics);
      if (violation && !result.ordering) result.ordering = violation;

      for (const diagnostic of diagnostics) {
        const key = fingerprint(diagnostic);
        if (seen.has(key)) continue;
        seen.add(key);
        union.push(diagnostic);
      }
    }

    try {
      const comparison = compareDiagnostics(testCase.expected, union);
      result.missing = comparison.missing;
      result.unexpected = comparison.unexpected;
    } catch (error) {
      result.status = 'error';
      result.reason = (error as Error).message;
      return;
    }

    if (result.missing.length > 0 || result.unexpected.length > 0 || result.ordering) {
      result.status = 'fail';
    }
  });

  return result;
}

/**
 * Run the conformance tests and produce the report. Throws only on a conformance-tests or
 * command-configuration fault.
 */
export async function runCases(options: RunOptions): Promise<Report> {
  const commands = options.commands.map((command) => withJsonFormat(splitCommand(command)));
  const discovered = await discoverCases(options);

  const cases: CaseResult[] = [];
  for (const testCase of discovered.cases) {
    cases.push(await runCase(testCase, commands, options));
  }
  for (const skip of discovered.skipped) {
    cases.push({
      name: skip.name,
      status: 'skip',
      reason: skip.reason,
      missing: [],
      unexpected: [],
      runs: [],
    });
  }
  cases.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const count = (status: CaseResult['status']): number =>
    cases.filter((entry) => entry.status === status).length;

  return {
    schema: reportSchema,
    spec: discovered.source,
    commands: options.commands,
    cases,
    summary: {
      total: cases.length,
      passed: count('pass'),
      failed: count('fail'),
      skipped: count('skip'),
      errored: count('error'),
    },
  };
}
