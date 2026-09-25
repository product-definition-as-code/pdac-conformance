import { compareDiagnostics, findOrderingViolation, toComparable } from './compare.js';
import { discoverCases, type TestCase, type DiscoverOptions } from './cases.js';
import { baselineIndex, collectCitationPins, collectFixtureArtifacts } from './digests.js';
import { parseDiagnostics } from './envelope.js';
import { runOperationCase } from './operations.js';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { reportProvenance } from './provenance.js';
import {
  runCommand,
  splitCommand,
  TimeoutError,
  withFixtureCopy,
  withJsonFormat,
} from './execute.js';
import {
  comparedFields,
  reportSchema,
  type CaseResult,
  type ClaimOptions,
  type CommandRun,
  type Diagnostic,
  type ExerciseResult,
  type ExpectedExitCode,
  type Report,
} from './types.js';

/** Two minutes is generous for validating a fixture and short enough to fail a hung CI job. */
export const defaultTimeoutMs = 120_000;

export interface RunOptions extends DiscoverOptions {
  adapterCommand?: string;
  /** Implementation commands, each an unsplit command string. At least one is required. */
  commands: string[];
  keep?: boolean;
  timeoutMs?: number;
  claims?: ClaimOptions;
}

const exerciseCodes = ['PRODUCT061', 'PRODUCT062'] as const;
const invalidType = 'pdac-conformance-invalid-type';
const missingActor = 'ACT-PDAC-CONFORMANCE-MISSING';

interface ExerciseDefinition {
  kind: ExerciseResult['kind'];
  target: string;
  source: string;
  expectedCodes: string[];
  observed: (diagnostics: Diagnostic[]) => boolean;
  failure: string;
  mutate: (work: string) => Promise<void>;
}

/** A changed target must make its citation stale or tampered, never silently remain current. */
function observedExerciseDiagnostic(
  diagnostics: Diagnostic[],
  codes: readonly string[],
  target?: string,
): boolean {
  return diagnostics.some(
    (diagnostic) =>
      diagnostic.code !== undefined &&
      codes.includes(diagnostic.code) &&
      (target === undefined || diagnostic.target === target || diagnostic.artifact === target),
  );
}

async function runExercise(
  testCase: TestCase,
  commands: string[][],
  timeoutMs: number,
  definition: ExerciseDefinition,
): Promise<ExerciseResult> {
  const failed = (reason: string, runs: CommandRun[] = []): ExerciseResult => ({
    kind: definition.kind,
    target: definition.target,
    source: definition.source,
    expectedCodes: definition.expectedCodes,
    status: 'error',
    reason,
    runs,
  });

  return await withFixtureCopy(
    testCase.repoDir,
    `${testCase.name}-exercise`,
    false,
    async (work) => {
      try {
        await definition.mutate(work);
      } catch (error) {
        return failed((error as Error).message);
      }

      const runs: CommandRun[] = [];
      const diagnostics: Diagnostic[] = [];
      for (const argv of commands) {
        let spawned;
        try {
          spawned = await runCommand(argv, work, timeoutMs);
        } catch (error) {
          return failed((error as Error).message, runs);
        }
        const run: CommandRun = { argv, ...spawned };
        runs.push(run);
        const rejected = invocationFailure(run, undefined);
        if (rejected) return failed(rejected, runs);
        try {
          diagnostics.push(...parseDiagnostics(run.stdout));
        } catch (error) {
          return failed(`'${argv.join(' ')}': ${(error as Error).message}`, runs);
        }
      }

      return {
        kind: definition.kind,
        target: definition.target,
        source: definition.source,
        expectedCodes: definition.expectedCodes,
        status: definition.observed(diagnostics) ? 'pass' : 'fail',
        ...(definition.observed(diagnostics) ? {} : { reason: definition.failure }),
        runs,
      };
    },
  );
}

async function exercisePin(
  testCase: TestCase,
  commands: string[][],
  timeoutMs: number,
  pin: Awaited<ReturnType<typeof collectCitationPins>>[number],
): Promise<ExerciseResult> {
  const source = relative(testCase.dir, pin.path).split(sep).join('/');
  if (!pin.id) {
    return {
      kind: 'citation-pin',
      target: '(none recorded)',
      source,
      expectedCodes: [...exerciseCodes],
      status: 'error',
      reason: 'cannot exercise a citation pin without a target id',
      runs: [],
    };
  }

  return await runExercise(testCase, commands, timeoutMs, {
    kind: 'citation-pin',
    target: pin.id,
    source,
    expectedCodes: [...exerciseCodes],
    observed: (diagnostics) => observedExerciseDiagnostic(diagnostics, exerciseCodes, pin.id),
    failure: 'exercised nothing: mutation produced no stale or tampered diagnostic',
    mutate: async (work) => {
      const target = (await baselineIndex(work)).get(pin.id!);
      if (!target) {
        throw new Error('cannot exercise a citation pin whose target does not resolve');
      }

      // A Markdown comment changes the exact artifact bytes without changing its PDaC meaning. It is
      // intentionally fixed so the mutation is reproducible and belongs to the runner, not a case.
      await appendFile(target, '\n<!-- pdac-conformance exercise -->\n');
    },
  });
}

async function exerciseArtifactType(
  testCase: TestCase,
  commands: string[][],
  timeoutMs: number,
  artifact: Awaited<ReturnType<typeof collectFixtureArtifacts>>[number],
): Promise<ExerciseResult> {
  const source = relative(testCase.dir, artifact.path).split(sep).join('/');
  const pathInRepo = relative(testCase.repoDir, artifact.path);
  return await runExercise(testCase, commands, timeoutMs, {
    kind: 'artifact-type',
    target: artifact.id,
    source,
    expectedCodes: ['PRODUCT003'],
    observed: (diagnostics) => observedExerciseDiagnostic(diagnostics, ['PRODUCT003']),
    failure: 'exercised nothing: invalid artifact type produced no PRODUCT003 diagnostic',
    mutate: async (work) => {
      const path = join(work, pathInRepo);
      const original = await readFile(path, 'utf8');
      const changed = original.replace(/^type:\s*\S+\s*$/m, `type: ${invalidType}`);
      if (changed === original)
        throw new Error('cannot exercise an artifact without a scalar type');
      await writeFile(path, changed);
    },
  });
}

async function exerciseGraphReference(
  testCase: TestCase,
  commands: string[][],
  timeoutMs: number,
  artifact: Awaited<ReturnType<typeof collectFixtureArtifacts>>[number],
): Promise<ExerciseResult> {
  const source = relative(testCase.dir, artifact.path).split(sep).join('/');
  const pathInRepo = relative(testCase.repoDir, artifact.path);
  return await runExercise(testCase, commands, timeoutMs, {
    kind: 'graph-reference',
    target: missingActor,
    source,
    expectedCodes: ['PRODUCT006'],
    observed: (diagnostics) =>
      observedExerciseDiagnostic(diagnostics, ['PRODUCT006'], missingActor),
    failure: 'exercised nothing: broken graph reference produced no PRODUCT006 diagnostic',
    mutate: async (work) => {
      const path = join(work, pathInRepo);
      const original = await readFile(path, 'utf8');
      const changed = original.replace(
        /^primary-actor:\s*\S+\s*$/m,
        `primary-actor: ${missingActor}`,
      );
      if (changed === original)
        throw new Error('cannot exercise a fixture without a primary-actor relationship');
      await writeFile(path, changed);
    },
  });
}

/**
 * A zero-diagnostic case with citation pins can otherwise pass when an implementation discovers
 * no citations at all. Re-run each pin against one controlled target mutation as observable
 * evidence, without imposing an implementation-specific report envelope.
 */
async function exerciseZeroDiagnosticCase(
  testCase: TestCase,
  commands: string[][],
  timeoutMs: number,
): Promise<ExerciseResult[]> {
  if (testCase.expected.length > 0) return [];
  let pins;
  try {
    pins = await collectCitationPins(testCase.repoDir);
  } catch (error) {
    return [
      {
        kind: 'citation-pin',
        target: '(unreadable)',
        source: '(unreadable)',
        expectedCodes: [...exerciseCodes],
        status: 'error',
        reason: (error as Error).message,
        runs: [],
      },
    ];
  }
  if (pins.length > 0) {
    return await Promise.all(pins.map((pin) => exercisePin(testCase, commands, timeoutMs, pin)));
  }

  let artifacts;
  try {
    artifacts = await collectFixtureArtifacts(testCase.repoDir);
  } catch (error) {
    return [
      {
        kind: 'unprotected',
        target: '(unreadable)',
        source: '(unreadable)',
        expectedCodes: [],
        status: 'error',
        reason: (error as Error).message,
        runs: [],
      },
    ];
  }
  if (artifacts.length === 0) {
    return [
      {
        kind: 'unprotected',
        target: '(none)',
        source: '(none)',
        expectedCodes: [],
        status: 'error',
        reason:
          'cannot establish positive evidence for a zero-diagnostic fixture without a pin or Product Artifact',
        runs: [],
      },
    ];
  }
  const artifactExercises = await Promise.all(
    artifacts.map((artifact) => exerciseArtifactType(testCase, commands, timeoutMs, artifact)),
  );
  const graphSource = artifacts.find((artifact) => artifact.primaryActor !== undefined);
  if (!graphSource) return artifactExercises;
  return [
    ...artifactExercises,
    await exerciseGraphReference(testCase, commands, timeoutMs, graphSource),
  ];
}

/** Identify a diagnostic by its compared fields, so the union across commands does not double up. */
function fingerprint(diagnostic: Diagnostic): string {
  const c = toComparable(diagnostic);
  return JSON.stringify(comparedFields.map((field) => c[field]));
}

/**
 * Without an explicit assertion, exit `1` is a normal validation verdict while `2` and `3` mean the
 * run itself did not happen. An asserted code supersedes these defaults, but never diagnostic
 * parsing or comparison: the exit code and diagnostics are independent parts of the verdict.
 */
function invocationFailure(
  run: CommandRun,
  expectedExitCode: ExpectedExitCode | undefined,
): string | undefined {
  if (expectedExitCode !== undefined) return undefined;
  if (run.exitCode === 2)
    return `'${run.argv.join(' ')}' rejected the invocation (exit 2); expected exit 0 or 1 with JSON diagnostics on stdout`;
  if (run.exitCode >= 3)
    return `'${run.argv.join(' ')}' failed (exit ${run.exitCode}); expected exit 0 or 1 with JSON diagnostics on stdout`;
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
    ...(testCase.expectedExitCode === undefined
      ? {}
      : { expectedExitCode: testCase.expectedExitCode }),
    exitCodeMismatches: [],
    missing: [],
    unexpected: [],
    runs: [],
    exercises: [],
  };

  await withFixtureCopy(testCase.repoDir, testCase.name, options.keep ?? false, async (work) => {
    if (options.keep) result.workDir = work;

    const seen = new Map<string, number>();
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

      const rejected = invocationFailure(run, testCase.expectedExitCode);
      if (rejected) {
        result.status = 'error';
        result.reason = rejected;
        return;
      }

      if (testCase.expectedExitCode !== undefined && run.exitCode !== testCase.expectedExitCode) {
        result.exitCodeMismatches.push({
          argv: run.argv,
          expected: testCase.expectedExitCode,
          actual: run.exitCode,
        });
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

      const occurrences = new Map<string, number>();
      for (const diagnostic of diagnostics) {
        const key = fingerprint(diagnostic);
        const count = (occurrences.get(key) ?? 0) + 1;
        occurrences.set(key, count);
        if (count <= (seen.get(key) ?? 0)) continue;
        seen.set(key, count);
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

    if (
      result.exitCodeMismatches.length > 0 ||
      result.missing.length > 0 ||
      result.unexpected.length > 0 ||
      result.ordering
    ) {
      result.status = 'fail';
    }

    if (result.status === 'pass') {
      result.exercises = await exerciseZeroDiagnosticCase(
        testCase,
        commands,
        options.timeoutMs ?? defaultTimeoutMs,
      );
      if (result.exercises.some((exercise) => exercise.status === 'error')) result.status = 'error';
      else if (result.exercises.some((exercise) => exercise.status === 'fail'))
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
    cases.push(
      testCase.operation
        ? await runOperationCase(
            testCase,
            options.adapterCommand,
            options.keep ?? false,
            options.timeoutMs ?? defaultTimeoutMs,
          )
        : commands.length
          ? await runCase(testCase, commands, options)
          : {
              name: testCase.name,
              status: 'skip',
              reason: 'flat case requires --command',
              exitCodeMismatches: [],
              missing: [],
              unexpected: [],
              runs: [],
              exercises: [],
            },
    );
  }
  for (const skip of discovered.skipped) {
    cases.push({
      name: skip.name,
      status: 'skip',
      reason: skip.reason,
      exitCodeMismatches: [],
      missing: [],
      unexpected: [],
      runs: [],
      exercises: [],
    });
  }
  cases.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const count = (status: CaseResult['status']): number =>
    cases.filter((entry) => entry.status === status).length;

  return {
    schema: reportSchema,
    kind: 'conformance',
    provenance: reportProvenance(discovered.source, options.claims),
    commands: options.adapterCommand
      ? [...options.commands, options.adapterCommand]
      : options.commands,
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
