import { describe, expect, it } from 'vitest';
import { EnvelopeError, parseDiagnostics } from '../src/envelope.js';

describe('parseDiagnostics', () => {
  it('reads the reference implementation envelope and drops message', () => {
    const stdout = JSON.stringify({
      schema: 'product-definition-as-code/diagnostics/v1alpha1',
      diagnostics: [
        {
          severity: 'warning',
          code: 'PRODUCT108',
          message: 'open questions remain',
          file: 'change.md',
          artifact: 'CHG-EXAMPLE',
        },
      ],
      summary: { errors: 0, warnings: 1 },
    });
    expect(parseDiagnostics(stdout)).toEqual([
      { severity: 'warning', code: 'PRODUCT108', file: 'change.md', artifact: 'CHG-EXAMPLE' },
    ]);
  });

  it('accepts a bare array', () => {
    expect(parseDiagnostics('[{"severity":"error","code":"PRODUCT005","file":"a.md"}]')).toEqual([
      { severity: 'error', code: 'PRODUCT005', file: 'a.md' },
    ]);
  });

  it('accepts an empty diagnostics list', () => {
    expect(parseDiagnostics('{"diagnostics": []}')).toEqual([]);
  });

  it('rejects empty output', () => {
    expect(() => parseDiagnostics('   ')).toThrow(EnvelopeError);
  });

  it('rejects text output', () => {
    expect(() => parseDiagnostics('0 error(s), 0 warning(s)')).toThrow(/not JSON/);
  });

  it('rejects JSON without a diagnostics array', () => {
    expect(() => parseDiagnostics('{"summary":{"errors":0}}')).toThrow(/no 'diagnostics' array/);
  });

  it('rejects a non-string compared field', () => {
    expect(() => parseDiagnostics('{"diagnostics":[{"code":108}]}')).toThrow(/non-string 'code'/);
  });
});
