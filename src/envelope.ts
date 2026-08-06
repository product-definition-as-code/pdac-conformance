import { comparedFields, type Diagnostic } from './types.js';

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read one diagnostic, keeping the compared fields and discarding everything else. A non-string
 * value where the spec defines a string is a defect worth naming, not something to coerce.
 */
function readDiagnostic(value: unknown, index: number): Diagnostic {
  if (!isRecord(value)) {
    throw new EnvelopeError(`diagnostic ${index} is not an object`);
  }
  const diagnostic: Diagnostic = {};
  for (const field of comparedFields) {
    const raw = value[field];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string') {
      throw new EnvelopeError(`diagnostic ${index} has a non-string '${field}'`);
    }
    diagnostic[field] = raw;
  }
  return diagnostic;
}

/**
 * Parse the diagnostics an implementation printed under `--format json`.
 *
 * The spec fixes the diagnostic fields, not the envelope around them, so this accepts the
 * `{ schema, diagnostics, summary }` object the reference implementation emits, a bare array, and
 * ignores every key it does not need. Trailing text after the JSON document is rejected: a runner
 * that guesses at where the payload ends certifies its own guess.
 */
export function parseDiagnostics(stdout: string): Diagnostic[] {
  const text = stdout.trim();
  if (text.length === 0) throw new EnvelopeError('no output on stdout');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new EnvelopeError(`stdout is not JSON: ${(error as Error).message}`);
  }

  const list = Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.diagnostics : undefined;
  if (!Array.isArray(list)) {
    throw new EnvelopeError("JSON output has no 'diagnostics' array");
  }
  return list.map(readDiagnostic);
}
