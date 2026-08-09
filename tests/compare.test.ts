import { describe, expect, it } from 'vitest';
import {
  compareDiagnostics,
  findOrderingViolation,
  matches,
  sortDiagnostics,
  toComparable,
  UncomparableFieldError,
} from '../src/compare.js';
import type { Diagnostic } from '../src/types.js';

const warning: Diagnostic = {
  severity: 'warning',
  code: 'PRODUCT108',
  file: 'docs/product/changes/active/chg-example/change.md',
  artifact: 'CHG-EXAMPLE',
};

describe('toComparable', () => {
  it('keeps the compared fields and drops everything else', () => {
    const reduced = toComparable({ ...warning, message: 'implementation-defined' } as Diagnostic);
    expect(reduced).toEqual(warning);
  });
});

describe('matches', () => {
  it('asserts only the fields the expectation carries', () => {
    expect(matches({ code: 'PRODUCT108' }, warning)).toBe(true);
    expect(matches({ code: 'PRODUCT108', artifact: 'CHG-OTHER' }, warning)).toBe(false);
  });

  it('treats an asserted field as absent-sensitive', () => {
    // An expectation that names a target is not satisfied by a diagnostic without one.
    expect(matches({ code: 'PRODUCT108', target: 'FR-X-001' }, warning)).toBe(false);
  });
});

describe('sortDiagnostics', () => {
  it('orders by file, then code, then target', () => {
    const sorted = sortDiagnostics([
      { code: 'PRODUCT006', file: 'b.md', target: 'FR-B-001' },
      { code: 'PRODUCT006', file: 'a.md', target: 'FR-Z-001' },
      { code: 'PRODUCT005', file: 'b.md' },
      { code: 'PRODUCT006', file: 'b.md', target: 'FR-A-001' },
    ]);
    expect(sorted.map((d) => [d.file, d.code, d.target])).toEqual([
      ['a.md', 'PRODUCT006', 'FR-Z-001'],
      ['b.md', 'PRODUCT005', undefined],
      ['b.md', 'PRODUCT006', 'FR-A-001'],
      ['b.md', 'PRODUCT006', 'FR-B-001'],
    ]);
  });
});

describe('findOrderingViolation', () => {
  it('accepts the mandated order', () => {
    expect(
      findOrderingViolation([
        { code: 'PRODUCT005', file: 'a.md' },
        { code: 'PRODUCT006', file: 'a.md', target: 'FR-A-001' },
        { code: 'PRODUCT006', file: 'b.md' },
      ]),
    ).toBeUndefined();
  });

  it('accepts diagnostics that tie on all three keys in either order', () => {
    expect(
      findOrderingViolation([
        { code: 'PRODUCT005', file: 'a.md', artifact: 'ACT-B' },
        { code: 'PRODUCT005', file: 'a.md', artifact: 'ACT-A' },
      ]),
    ).toBeUndefined();
  });

  it('reports the first strict decrease', () => {
    const violation = findOrderingViolation([
      { code: 'PRODUCT006', file: 'b.md' },
      { code: 'PRODUCT005', file: 'a.md' },
    ]);
    expect(violation?.index).toBe(1);
    expect(violation?.before.file).toBe('b.md');
    expect(violation?.after.file).toBe('a.md');
  });
});

describe('compareDiagnostics', () => {
  it('passes when the emitted diagnostic satisfies a partial expectation', () => {
    const result = compareDiagnostics([{ code: 'PRODUCT108' }], [warning]);
    expect(result).toEqual({ missing: [], unexpected: [] });
  });

  it('never compares message', () => {
    const emitted = { ...warning, message: 'anything at all' } as Diagnostic;
    const result = compareDiagnostics([warning], [emitted]);
    expect(result.missing).toEqual([]);
    expect(result.unexpected).toEqual([]);
  });

  it('reports a missing expectation', () => {
    const result = compareDiagnostics([warning], []);
    expect(result.missing).toEqual([warning]);
    expect(result.unexpected).toEqual([]);
  });

  it('reports an unexpected diagnostic', () => {
    const result = compareDiagnostics([], [warning]);
    expect(result.missing).toEqual([]);
    expect(result.unexpected).toEqual([warning]);
  });

  it('pairs duplicates one to one', () => {
    const result = compareDiagnostics([{ code: 'PRODUCT005' }, { code: 'PRODUCT005' }], [warning]);
    expect(result.missing).toHaveLength(2);
    expect(result.unexpected).toEqual([warning]);
  });

  it('finds a valid pairing a greedy match would miss', () => {
    // The looser expectation sorts first and could claim the only diagnostic the stricter one
    // accepts. A maximum matching pairs both, so this is a pass and not two spurious failures.
    const expected: Diagnostic[] = [
      { file: 'a.md', code: 'PRODUCT006' },
      { file: 'a.md', code: 'PRODUCT006', target: 'FR-A-001' },
    ];
    const actual: Diagnostic[] = [
      { file: 'a.md', code: 'PRODUCT006', target: 'FR-A-001' },
      { file: 'a.md', code: 'PRODUCT006', target: 'FR-B-001' },
    ];
    expect(compareDiagnostics(expected, actual)).toEqual({ missing: [], unexpected: [] });
  });

  it('rejects an expectation asserting a field the conformance test rules never compare', () => {
    expect(() => compareDiagnostics([{ ...warning, message: 'nope' } as Diagnostic], [])).toThrow(
      UncomparableFieldError,
    );
  });
});
