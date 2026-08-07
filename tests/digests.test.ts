import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { digestBytes, digestText, verifyDigests } from '../src/digests.js';
import type { Diagnostic } from '../src/types.js';

const artifact = `---
id: FR-EXAMPLE-001
type: functional-requirement
title: An example requirement
status: active
derived-from:
  - UC-EXAMPLE-001
verification:
  - id: S1
    scenario: Something observable happens.
---

## Requirement

The product MUST do the thing.

## Rationale

Because the thing matters.
`;

const currentDigest = digestText(artifact);
const wrongDigest = `sha256:${'0'.repeat(64)}`;

interface CaseOptions {
  pinned: string;
  /** Record the pin in a marker block instead of a ledger. */
  marker?: boolean;
  expected?: Diagnostic[];
  citedId?: string;
  /** Also write the artifact under a Product Change's proposed/ tree, at this content. */
  proposed?: string;
}

/** Write one synthetic corpus with a single case, and return the corpus directory. */
async function corpusWith(options: CaseOptions): Promise<string> {
  const cases = await mkdtemp(join(tmpdir(), 'pdac-lint-digests-'));
  const caseDir = join(cases, 'synthetic-case');
  const model = join(caseDir, 'repo', 'docs', 'product', 'model', 'requirements', 'functional');
  const specs = join(caseDir, 'repo', 'specs');
  await mkdir(model, { recursive: true });
  await mkdir(specs, { recursive: true });
  await writeFile(join(model, 'fr-example-001.md'), artifact);

  if (options.proposed) {
    const proposed = join(
      caseDir,
      'repo',
      'docs',
      'product',
      'changes',
      'active',
      'chg-example',
      'proposed',
      'requirements',
      'functional',
    );
    await mkdir(proposed, { recursive: true });
    await writeFile(join(proposed, 'fr-example-001.md'), options.proposed);
  }

  const citedId = options.citedId ?? 'FR-EXAMPLE-001';
  if (options.marker) {
    await writeFile(
      join(specs, 'feature.md'),
      `# Consumer\n\n<!-- pdac:cite id="${citedId}" digest="${options.pinned}" -->\n${artifact}<!-- /pdac:cite -->\n`,
    );
  } else {
    await writeFile(
      join(specs, 'feature.citations.yml'),
      `# Citation ledger\ncitations:\n  - id: ${citedId}\n    digest: ${options.pinned}\n    anchor: S1\n`,
    );
  }

  await writeFile(
    join(caseDir, 'expected.json'),
    `${JSON.stringify({ diagnostics: options.expected ?? [] }, null, 2)}\n`,
  );
  return cases;
}

describe('digest normalization', () => {
  it('renders the digest as the spec prescribes', () => {
    expect(digestText('anything\n')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('normalizes CRLF and CR to LF', () => {
    const lf = digestBytes(Buffer.from('one\ntwo\n'));
    expect(digestBytes(Buffer.from('one\r\ntwo\r\n'))).toBe(lf);
    expect(digestBytes(Buffer.from('one\rtwo\r'))).toBe(lf);
  });

  it('treats the trailing newline as content', () => {
    expect(digestText('one\n')).not.toBe(digestText('one'));
  });

  it('digests bytes, not decoded text', () => {
    // A digest over a lossy decode would collapse these two.
    expect(digestBytes(Buffer.from([0xc3, 0xa9]))).not.toBe(
      digestBytes(Buffer.from([0xef, 0xbf, 0xbd])),
    );
  });
});

describe('ledger pins', () => {
  it('verifies a pin that matches', async () => {
    const report = await verifyDigests({ cases: await corpusWith({ pinned: currentDigest }) });
    expect(report.summary).toMatchObject({ total: 1, verified: 1, failed: 0 });
    expect(report.pins[0]).toMatchObject({ status: 'match', kind: 'ledger', id: 'FR-EXAMPLE-001' });
  });

  it('reports a pin that no longer matches, with both digests', async () => {
    const report = await verifyDigests({ cases: await corpusWith({ pinned: wrongDigest }) });
    expect(report.summary).toMatchObject({ verified: 0, failed: 1 });
    expect(report.pins[0]).toMatchObject({
      status: 'mismatch',
      pinned: wrongDigest,
      recomputed: currentDigest,
    });
  });

  it('reports a malformed pin', async () => {
    const report = await verifyDigests({
      cases: await corpusWith({ pinned: 'sha256:NOTADIGEST' }),
    });
    expect(report.pins.map((p) => p.status)).toEqual(['malformed']);
  });

  it('reports a pin whose target does not resolve', async () => {
    const report = await verifyDigests({
      cases: await corpusWith({ pinned: currentDigest, citedId: 'FR-ABSENT-001' }),
    });
    expect(report.pins.map((p) => p.status)).toEqual(['unresolved']);
  });

  it('accepts an unresolved target when the case expects PRODUCT060', async () => {
    const report = await verifyDigests({
      cases: await corpusWith({
        pinned: currentDigest,
        citedId: 'FR-ABSENT-001',
        expected: [{ code: 'PRODUCT060', target: 'FR-ABSENT-001' }],
      }),
    });
    expect(report.summary.failed).toBe(0);
  });

  it('resolves the baseline artifact, never a change proposal carrying the same id', async () => {
    const report = await verifyDigests({
      cases: await corpusWith({
        pinned: currentDigest,
        proposed: artifact.replace('MUST do the thing', 'MUST do the other thing'),
      }),
    });
    expect(report.pins.map((p) => p.status)).toEqual(['match']);
  });
});

describe('marker-block pins', () => {
  it('checks a pin recorded in a marker block', async () => {
    const report = await verifyDigests({
      cases: await corpusWith({ pinned: wrongDigest, marker: true }),
    });
    expect(report.pins[0]).toMatchObject({ status: 'mismatch', kind: 'marker' });
    expect(report.pins[0]?.source).toContain('feature.md');
  });
});

describe('pins a case needs to differ', () => {
  it('accepts a differing pin when the case expects tampered', async () => {
    const report = await verifyDigests({
      cases: await corpusWith({
        pinned: wrongDigest,
        marker: true,
        expected: [{ code: 'PRODUCT062', artifact: 'FR-EXAMPLE-001' }],
      }),
    });
    expect(report.pins.map((p) => p.status)).toEqual(['differs-as-expected']);
    expect(report.summary.failed).toBe(0);
  });

  it('reports a pin that matches where the case needs it to differ', async () => {
    const report = await verifyDigests({
      cases: await corpusWith({
        pinned: currentDigest,
        marker: true,
        expected: [{ code: 'PRODUCT062', artifact: 'FR-EXAMPLE-001' }],
      }),
    });
    expect(report.pins.map((p) => p.status)).toEqual(['unexpected-match']);
    expect(report.summary.failed).toBe(1);
  });

  it('reads the expectation per artifact, not per case', async () => {
    const report = await verifyDigests({
      cases: await corpusWith({
        pinned: wrongDigest,
        expected: [{ code: 'PRODUCT062', artifact: 'FR-SOMETHING-ELSE' }],
      }),
    });
    expect(report.pins.map((p) => p.status)).toEqual(['mismatch']);
  });
});

describe('a pin carrying no id', () => {
  /**
   * `undefined === undefined` is true. A pin with no id must not be excused by an expectation
   * that names no artifact and no target, or a citation nothing verified reads as verified.
   */
  it('is reported even when the case expects PRODUCT060 against nothing in particular', async () => {
    const cases = await mkdtemp(join(tmpdir(), 'pdac-lint-digests-'));
    const caseDir = join(cases, 'no-id-case');
    const model = join(caseDir, 'repo', 'docs', 'product', 'model', 'requirements', 'functional');
    const specs = join(caseDir, 'repo', 'specs');
    await mkdir(model, { recursive: true });
    await mkdir(specs, { recursive: true });
    await writeFile(join(model, 'fr-example-001.md'), artifact);
    await writeFile(
      join(specs, 'feature.citations.yml'),
      `citations:\n  - digest: ${currentDigest}\n`,
    );
    await writeFile(
      join(caseDir, 'expected.json'),
      `${JSON.stringify({ diagnostics: [{ code: 'PRODUCT060', file: 'specs/feature.md' }] }, null, 2)}\n`,
    );
    const report = await verifyDigests({ cases });
    expect(report.pins.map((p) => p.status)).toEqual(['unresolved']);
    expect(report.summary.failed).toBe(1);
  });
});

describe('a corpus with nothing to verify', () => {
  it('does not report success for having checked nothing', async () => {
    const cases = await mkdtemp(join(tmpdir(), 'pdac-lint-digests-'));
    const caseDir = join(cases, 'pinless-case');
    await mkdir(join(caseDir, 'repo'), { recursive: true });
    await writeFile(join(caseDir, 'expected.json'), '{ "diagnostics": [] }\n');
    const report = await verifyDigests({ cases });
    expect(report.pins).toEqual([]);
    expect(report.summary.total).toBe(0);
  });
});

describe('report shape', () => {
  it('carries the schema, the corpus source and a stable pin order', async () => {
    const report = await verifyDigests({ cases: await corpusWith({ pinned: currentDigest }) });
    expect(report.schema).toBe('pdac-lint/digest-report/v0');
    expect(report.spec.cases).toContain('pdac-lint-digests-');
    expect(report.summary.cases).toBe(1);
  });

  it('skips a case it cannot read an expectation for, and says so', async () => {
    const cases = await mkdtemp(join(tmpdir(), 'pdac-lint-digests-'));
    await mkdir(join(cases, 'no-expectations', 'repo'), { recursive: true });
    const report = await verifyDigests({ cases });
    expect(report.pins).toEqual([]);
    expect(report.skipped).toEqual([{ name: 'no-expectations', reason: 'no expected.json' }]);
  });
});
