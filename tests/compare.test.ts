import { describe, expect, it } from 'vitest';
import {
  compareDiagnostics,
  findOrderingViolation,
  matches,
  orderKey,
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
    const diagnostic: Diagnostic = {
      ...warning,
      change: 'CHG-OTHER',
      field: 'operations.modify',
      target: 'FR-X-001',
      line: 12,
      entry: 3,
    };
    const reduced = toComparable({
      ...diagnostic,
      message: 'implementation-defined',
    } as Diagnostic);
    expect(reduced).toEqual(diagnostic);
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

  it('compares change and numeric locations when an expectation asserts them', () => {
    const actual = { ...warning, change: 'CHG-EXAMPLE', line: 12, entry: 3 };
    expect(matches({ change: 'CHG-EXAMPLE', line: 12, entry: 3 }, actual)).toBe(true);
    expect(matches({ line: 2 }, actual)).toBe(false);
    expect(matches({ entry: 2 }, actual)).toBe(false);
  });
});

describe('sortDiagnostics', () => {
  it('builds the final eight-field order key', () => {
    expect(
      orderKey({
        file: 'a.md',
        line: 12,
        entry: 3,
        code: 'PRODUCT060',
        field: 'citations',
        target: 'FR-A-001',
        artifact: 'FR-B-001',
        change: 'CHG-A',
      }),
    ).toEqual(['a.md', 12, 3, 'PRODUCT060', 'citations', 'FR-A-001', 'FR-B-001', 'CHG-A']);
  });

  it('orders by file, line, entry, code, field, target, artifact, then change', () => {
    const base: Diagnostic = {
      file: 'same.md',
      line: 1,
      entry: 1,
      code: 'PRODUCT100',
      field: 'field-b',
      target: 'TARGET-B',
      artifact: 'ART-B',
      change: 'CHG-B',
    };
    const pairs: [Diagnostic, Diagnostic][] = [
      [
        { ...base, file: 'a.md' },
        { ...base, file: 'b.md' },
      ],
      [
        { ...base, line: undefined },
        { ...base, line: 1 },
      ],
      [
        { ...base, line: 2 },
        { ...base, line: 10 },
      ],
      [
        { ...base, entry: undefined },
        { ...base, entry: 1 },
      ],
      [
        { ...base, entry: 2 },
        { ...base, entry: 10 },
      ],
      [
        { ...base, code: 'PRODUCT099' },
        { ...base, code: 'PRODUCT100' },
      ],
      [
        { ...base, field: 'field-a' },
        { ...base, field: 'field-b' },
      ],
      [
        { ...base, target: 'TARGET-A' },
        { ...base, target: 'TARGET-B' },
      ],
      [
        { ...base, artifact: 'ART-A' },
        { ...base, artifact: 'ART-B' },
      ],
      [
        { ...base, change: 'CHG-A' },
        { ...base, change: 'CHG-B' },
      ],
    ];

    for (const [earlier, later] of pairs) {
      expect(sortDiagnostics([later, earlier])).toEqual([earlier, later]);
    }
  });

  it('compares strings by Unicode code point rather than UTF-16 code unit', () => {
    const bmp = { file: '\ue000.md' };
    const astral = { file: '\u{10000}.md' };
    expect(sortDiagnostics([astral, bmp])).toEqual([bmp, astral]);
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

  it('accepts diagnostics that tie on all eight keys in either order', () => {
    expect(
      findOrderingViolation([
        { severity: 'warning', code: 'PRODUCT005', file: 'a.md', artifact: 'ACT-A' },
        { severity: 'error', code: 'PRODUCT005', file: 'a.md', artifact: 'ACT-A' },
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
