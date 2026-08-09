import {
  comparedFields,
  type ComparedField,
  type Diagnostic,
  type OrderingViolation,
} from './types.js';

/** A diagnostic key an expected entry may not assert, because the conformance test rules never compare it. */
export class UncomparableFieldError extends Error {
  constructor(readonly fields: string[]) {
    super(
      `expected.json asserts ${fields.map((f) => `'${f}'`).join(', ')}, which the conformance test rules do not compare (compared fields: ${comparedFields.join(', ')})`,
    );
    this.name = 'UncomparableFieldError';
  }
}

const compared = new Set<string>(comparedFields);

/** Reduce a diagnostic to the compared fields, dropping `message` and anything else. */
export function toComparable(diagnostic: Diagnostic): Diagnostic {
  const result: Diagnostic = {};
  for (const field of comparedFields) {
    const value = diagnostic[field];
    if (value !== undefined) result[field] = value;
  }
  return result;
}

/**
 * Validate a case's expectations: each may assert any subset of the compared fields and nothing
 * else. An entry asserting `message` would demand something the spec leaves to the implementation,
 * so it is an error in the test case rather than a failure of the implementation under test.
 */
export function assertExpectedShape(expected: Diagnostic[]): void {
  const offenders = new Set<string>();
  for (const diagnostic of expected) {
    for (const key of Object.keys(diagnostic)) {
      if (!compared.has(key)) offenders.add(key);
    }
  }
  if (offenders.size > 0) throw new UncomparableFieldError([...offenders].sort());
}

/**
 * The deterministic order the spec mandates: by file, then code, then target. An absent field
 * sorts first, so a diagnostic with no target precedes one that shares its file and code.
 */
export function orderKey(diagnostic: Diagnostic): [string, string, string] {
  return [diagnostic.file ?? '', diagnostic.code ?? '', diagnostic.target ?? ''];
}

function compareByOrderKey(a: Diagnostic, b: Diagnostic): number {
  const left = orderKey(a);
  const right = orderKey(b);
  for (let i = 0; i < left.length; i += 1) {
    // Ordering is over identifiers and POSIX paths, so plain code-unit comparison is the
    // platform-independent one. Locale collation is neither stable nor portable.
    const l = left[i] as string;
    const r = right[i] as string;
    if (l < r) return -1;
    if (l > r) return 1;
  }
  return 0;
}

export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(compareByOrderKey);
}

/**
 * Does an emitted diagnostic satisfy an expected one? Only the fields the expected entry carries
 * are asserted; a field absent from the expectation is not asserted at all.
 */
export function matches(expected: Diagnostic, actual: Diagnostic): boolean {
  for (const field of Object.keys(expected) as ComparedField[]) {
    if (expected[field] !== actual[field]) return false;
  }
  return true;
}

/**
 * Find the first place a list of diagnostics breaks the mandated order. Diagnostics that tie on
 * all three keys may appear in any relative order, so only a strict decrease is a violation.
 */
export function findOrderingViolation(actual: Diagnostic[]): OrderingViolation | undefined {
  for (let i = 1; i < actual.length; i += 1) {
    const before = actual[i - 1] as Diagnostic;
    const after = actual[i] as Diagnostic;
    if (compareByOrderKey(before, after) > 0) return { index: i, before, after };
  }
  return undefined;
}

export interface Comparison {
  missing: Diagnostic[];
  unexpected: Diagnostic[];
}

/**
 * Pair expectations with emitted diagnostics, maximally.
 *
 * Because an expectation asserts only some fields, one emitted diagnostic can satisfy several
 * expectations and vice versa, so claiming greedily could report a mismatch where a valid pairing
 * exists. This is the augmenting-path search for a maximum bipartite matching: each expectation
 * tries every candidate it satisfies and asks an already-paired expectation to move aside. Lists
 * are a handful of entries long, so the quadratic cost is irrelevant next to being exact.
 */
function matchPairs(expected: Diagnostic[], actual: Diagnostic[]): Map<number, number> {
  const pairedTo = new Map<number, number>(); // actual index -> expected index

  const augment = (expectedIndex: number, visited: Set<number>): boolean => {
    const expectation = expected[expectedIndex] as Diagnostic;
    for (let i = 0; i < actual.length; i += 1) {
      if (visited.has(i) || !matches(expectation, actual[i] as Diagnostic)) continue;
      visited.add(i);
      const incumbent = pairedTo.get(i);
      if (incumbent === undefined || augment(incumbent, visited)) {
        pairedTo.set(i, expectedIndex);
        return true;
      }
    }
    return false;
  };

  for (let i = 0; i < expected.length; i += 1) augment(i, new Set<number>());
  return pairedTo;
}

/**
 * Compare emitted diagnostics against a case's expectations.
 *
 * Both lists are sorted by the mandated key first, so the report reads in case order. What is
 * left unpaired is the failure: expectations nothing satisfied are missing, emitted diagnostics no
 * expectation accounts for are unexpected.
 */
export function compareDiagnostics(expected: Diagnostic[], actual: Diagnostic[]): Comparison {
  assertExpectedShape(expected);

  const sortedExpected = sortDiagnostics(expected);
  const sortedActual = sortDiagnostics(actual.map(toComparable));
  const pairedTo = matchPairs(sortedExpected, sortedActual);
  const pairedExpected = new Set(pairedTo.values());

  return {
    missing: sortedExpected.filter((_, i) => !pairedExpected.has(i)),
    unexpected: sortedActual.filter((_, i) => !pairedTo.has(i)),
  };
}
