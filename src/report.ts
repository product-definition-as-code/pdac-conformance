import type {
  CaseResult,
  Diagnostic,
  DigestReport,
  PinStatus,
  Report,
  SpecSource,
} from './types.js';

/** Render one diagnostic as the fields it actually carries, in the spec's field order. */
export function formatDiagnostic(diagnostic: Diagnostic): string {
  const head = [diagnostic.severity ?? '?', diagnostic.code ?? '?'].join(' ');
  const location = diagnostic.artifact
    ? `${diagnostic.file ?? '?'} [${diagnostic.artifact}]`
    : (diagnostic.file ?? '?');
  const relation =
    diagnostic.field || diagnostic.target
      ? ` (${[diagnostic.field, diagnostic.target].filter(Boolean).join(' -> ')})`
      : '';
  return `${head} ${location}${relation}`;
}

/** Name the spec source: a revision when there is one, the path when there is not. */
export function formatSource(spec: SpecSource): string {
  if (!spec.revision) return `${spec.cases} (unversioned)`;
  const details = [spec.revision.slice(0, 7)];
  if (spec.branch) details.push(spec.branch);
  if (spec.dirty) details.push('dirty');
  return `${spec.root ?? spec.cases} @ ${details.join(', ')}`;
}

function truncate(text: string, limit = 2000): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}\n... (truncated)` : trimmed;
}

function caseDetail(result: CaseResult, lines: string[]): void {
  if (result.reason) lines.push(`    ${result.reason}`);
  for (const diagnostic of result.missing) {
    lines.push(`    missing:    ${formatDiagnostic(diagnostic)}`);
  }
  for (const diagnostic of result.unexpected) {
    lines.push(`    unexpected: ${formatDiagnostic(diagnostic)}`);
  }
  if (result.ordering) {
    lines.push(
      `    out of order at index ${result.ordering.index}: ${formatDiagnostic(result.ordering.before)} precedes ${formatDiagnostic(result.ordering.after)}`,
    );
  }
  if (result.status === 'error') {
    // More than one command may have run before the case errored; name the one each stream
    // belongs to, or the reader is left matching output to commands by guesswork.
    for (const run of result.runs) {
      const command = run.argv.join(' ');
      if (run.stderr.trim()) lines.push(`    stderr of '${command}': ${truncate(run.stderr)}`);
      if (run.stdout.trim()) lines.push(`    stdout of '${command}': ${truncate(run.stdout)}`);
    }
  }
  if (result.workDir) lines.push(`    kept: ${result.workDir}`);
}

/** The human report: one line per case, details under the ones that did not pass. */
export function renderText(report: Report): string {
  const lines: string[] = [];
  lines.push(`Conformance: ${formatSource(report.spec)}`);
  for (const command of report.commands) lines.push(`Implementation: ${command}`);
  lines.push('');

  for (const result of report.cases) {
    lines.push(`  ${result.status.padEnd(5)} ${result.name}`);
    if (result.status !== 'pass') caseDetail(result, lines);
  }

  const { total, passed, failed, skipped, errored } = report.summary;
  lines.push('');
  lines.push(
    `${total} case(s): ${passed} passed, ${failed} failed, ${skipped} skipped, ${errored} errored`,
  );
  if (skipped > 0) {
    lines.push('Skipped cases are not conformance evidence; they were not run.');
  }
  return lines.join('\n');
}

/** The machine report, key-ordered so identical runs produce identical bytes. */
export function renderJson(report: Report): string {
  return JSON.stringify(report, null, 2);
}

/** Statuses that need no explanation in the human report. */
const quiet = new Set<PinStatus>(['match', 'differs-as-expected']);

/**
 * The human digest report: the failures in full, the sound pins as a count.
 *
 * A pin that holds is not news. A pin that does not needs both digests on screen, because the
 * next action is deciding whether the artifact moved or the pin was never right.
 */
export function renderDigestText(report: DigestReport): string {
  const lines: string[] = [];
  lines.push(`Conformance: ${formatSource(report.spec)}`);
  lines.push('');

  for (const pin of report.pins) {
    if (quiet.has(pin.status)) continue;
    lines.push(`  ${pin.status} in ${pin.case}`);
    lines.push(`    source     ${pin.source}${pin.anchor ? ` (anchor ${pin.anchor})` : ''}`);
    lines.push(`    artifact   ${pin.id ?? '(none recorded)'}`);
    lines.push(`    pinned     ${pin.pinned}`);
    if (pin.recomputed) lines.push(`    recomputed ${pin.recomputed}`);
  }

  for (const skipped of report.skipped) {
    lines.push(`  skipped ${skipped.name}: ${skipped.reason}`);
  }

  const { total, verified, failed, cases } = report.summary;
  if (lines.at(-1) !== '') lines.push('');
  lines.push(
    failed > 0
      ? `${failed} of ${total} pinned digest(s) failed across ${cases} case(s)`
      : `${verified} pinned digest(s) verified across ${cases} case(s)`,
  );
  return lines.join('\n');
}

export function renderDigestJson(report: DigestReport): string {
  return JSON.stringify(report, null, 2);
}
