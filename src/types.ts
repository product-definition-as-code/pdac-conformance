/** The report schema this runner emits under `--format json`. */
export const reportSchema = 'pdac-lint/conformance-report/v0';

/**
 * The fields a runner compares, from the corpus rules (`conformance/README.md`, "Comparing
 * diagnostics"). `message` is implementation-defined and is deliberately absent.
 */
export const comparedFields = ['severity', 'code', 'file', 'artifact', 'field', 'target'] as const;

export type ComparedField = (typeof comparedFields)[number];

/** A diagnostic reduced to its comparable fields. Every field is optional but `severity`/`code`. */
export interface Diagnostic {
  severity?: string;
  code?: string;
  file?: string;
  artifact?: string;
  field?: string;
  target?: string;
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

export interface SpecSource {
  /** Absolute path to the corpus directory the cases were read from. */
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
