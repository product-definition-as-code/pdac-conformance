/** The report schema this runner emits under `--format json`. */
export const reportSchema = 'pdac-lint/conformance-report/v0';

/** The report schema `pdac-lint digests` emits under `--format json`. */
export const digestReportSchema = 'pdac-lint/digest-report/v0';

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

export type CaseStatus = 'pass' | 'fail' | 'skip' | 'error';

export interface OrderingViolation {
  index: number;
  before: Diagnostic;
  after: Diagnostic;
}

export interface CaseResult {
  name: string;
  status: CaseStatus;
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
  revision?: string;
  branch?: string;
  dirty?: boolean;
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
  spec: SpecSource;
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
  schema: typeof digestReportSchema;
  spec: SpecSource;
  /** One entry per pinned digest, in case order then path order. */
  pins: PinResult[];
  skipped: SkippedCase[];
  summary: DigestSummary;
}
