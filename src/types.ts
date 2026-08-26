/** The producer-owned schema for every JSON report this runner emits. */
export const reportSchema = 'pdac-conformance/report/v1';

/**
 * The fields a runner compares, from the conformance test rules (`conformance/README.md`, "Comparing
 * diagnostics"). `message` is implementation-defined and is deliberately absent.
 */
export const comparedFields = [
  'severity',
  'code',
  'file',
  'artifact',
  'change',
  'field',
  'target',
  'line',
  'entry',
] as const;

export type ComparedField = (typeof comparedFields)[number];

/** A diagnostic reduced to its comparable fields. Fields are optional for subset expectations. */
export interface Diagnostic {
  severity?: string;
  code?: string;
  file?: string;
  artifact?: string;
  change?: string;
  field?: string;
  target?: string;
  line?: number;
  entry?: number;
}

/** One invocation of an implementation command against one fixture. */
export interface CommandRun {
  /** The argv actually spawned, `--format json` included. */
  argv: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Exit codes the specification assigns to implementation commands. */
export type ExpectedExitCode = 0 | 1 | 2 | 3;

/** One configured implementation command that did not return the code a case asserts. */
export interface ExitCodeMismatch {
  argv: string[];
  expected: ExpectedExitCode;
  actual: number;
}

export type CaseStatus = 'pass' | 'fail' | 'skip' | 'error';

export interface OrderingViolation {
  index: number;
  before: Diagnostic;
  after: Diagnostic;
}

export interface CaseResult {
  name: string;
  status: CaseStatus;
  /** The case-level exit code assertion, applied to every configured implementation command. */
  expectedExitCode?: ExpectedExitCode;
  /** Configured commands whose exit code did not satisfy the case-level assertion. */
  exitCodeMismatches: ExitCodeMismatch[];
  /** Why a case was skipped, or what went wrong for an error. */
  reason?: string;
  /** Expected diagnostics with no matching emitted diagnostic. */
  missing: Diagnostic[];
  /** Emitted diagnostics no expected diagnostic accounts for. */
  unexpected: Diagnostic[];
  /** Set when the emitted diagnostics are not in the mandated order. */
  ordering?: OrderingViolation;
  /** One entry per implementation command, in the order configured. */
  runs: CommandRun[];
  /** The retained fixture working copy, when `--keep` was given. */
  workDir?: string;
  /** Mutation exercises that make a pinned zero-diagnostic case evidence-bearing. */
  exercises: ExerciseResult[];
}

export interface ExerciseResult {
  /** The deterministic perturbation used to make the fixture's relevant surface observable. */
  kind: 'citation-pin' | 'artifact-type' | 'graph-reference' | 'unprotected';
  /** The cited Product Artifact deliberately changed in this isolated working copy. */
  target: string;
  /** Citation carrier path, relative to the case directory, with POSIX separators. */
  source: string;
  /** The diagnostic that proves the command observed the changed citation target. */
  expectedCodes: string[];
  status: 'pass' | 'fail' | 'error';
  reason?: string;
  runs: CommandRun[];
}

/** A case the runner did not execute, and why. Reported, never dropped. */
export interface SkippedCase {
  name: string;
  reason: string;
}

export interface SpecSource {
  /** Absolute path to the cases directory the cases were read from. */
  cases: string;
  /** Absolute path to the spec checkout, when one was given. */
  root?: string;
  /** Observed Git revision, or null when the source is not a Git checkout. */
  revision: string | null;
  /** Observed Git branch, or null for a detached or unversioned source. */
  branch: string | null;
  /** Observed Git dirty state, or null when it cannot be observed. */
  dirty: boolean | null;
}

export interface RunnerIdentity {
  name: 'pdac-conformance';
  version: string;
}

export interface ClaimedImplementation {
  name: string | null;
  version: string | null;
  artifactIdentity: string | null;
}

export interface ClaimedSpec {
  version: string | null;
  serializationVersion: string | null;
}

/**
 * Observations are measured by the runner. Claims are caller-supplied labels and are never
 * treated as conformance evidence by the runner.
 */
export interface ReportProvenance {
  observed: {
    runner: RunnerIdentity;
    spec: SpecSource;
  };
  claimed: {
    implementation: ClaimedImplementation;
    spec: ClaimedSpec;
  };
}

export interface ClaimOptions {
  implementationName?: string;
  implementationVersion?: string;
  implementationArtifact?: string;
  specVersion?: string;
  serializationVersion?: string;
}

export interface ReportSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errored: number;
}

export interface Report {
  schema: typeof reportSchema;
  kind: 'conformance';
  provenance: ReportProvenance;
  /** The implementation commands as configured, before `--format json` was appended. */
  commands: string[];
  cases: CaseResult[];
  summary: ReportSummary;
}

/** Where a fixture records a pinned digest: a citation ledger or a Markdown marker block. */
export type PinKind = 'ledger' | 'marker';

/**
 * What was found about one pinned digest. The four sound statuses are `match`,
 * `differs-as-expected` (the case expects stale or tampered), `unresolved-as-expected` and
 * `malformed-as-expected`; the rest are test-case defects.
 */
export type PinStatus =
  | 'match'
  | 'differs-as-expected'
  | 'unresolved-as-expected'
  | 'malformed-as-expected'
  | 'mismatch'
  | 'unexpected-match'
  | 'unresolved'
  | 'malformed';

export interface PinResult {
  case: string;
  /** The file recording the pin, relative to the case directory, with POSIX separators. */
  source: string;
  kind: PinKind;
  /** The cited artifact id, absent when the record does not carry one. */
  id?: string;
  anchor?: string;
  pinned: string;
  /** The digest recomputed from the cited artifact, absent when it could not be recomputed. */
  recomputed?: string;
  status: PinStatus;
}

export interface DigestSummary {
  total: number;
  verified: number;
  failed: number;
  cases: number;
}

export interface DigestReport {
  schema: typeof reportSchema;
  kind: 'digests';
  provenance: ReportProvenance;
  /** One entry per pinned digest, in case order then path order. */
  pins: PinResult[];
  skipped: SkippedCase[];
  summary: DigestSummary;
}
