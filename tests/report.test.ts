import { describe, expect, it } from 'vitest';
import { formatDiagnostic } from '../src/report.js';

describe('formatDiagnostic', () => {
  it('renders every comparable detail in diagnostic field order', () => {
    expect(
      formatDiagnostic({
        severity: 'error',
        code: 'PRODUCT025',
        file: 'docs/product/changes/active/chg-a/change.md',
        artifact: 'FR-A-001',
        change: 'CHG-A',
        field: 'operations.modify',
        target: 'FR-B-001',
        line: 12,
        entry: 3,
      }),
    ).toBe(
      'error PRODUCT025 docs/product/changes/active/chg-a/change.md [artifact FR-A-001] [change CHG-A] [field operations.modify] [target FR-B-001] [line 12] [entry 3]',
    );
  });
});
