import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { exitCodes, runCli } from '../src/cli.js';
import { digestText } from '../src/digests.js';
import type { DigestReport, Report } from '../src/types.js';

const casesDir = fileURLToPath(new URL('./fixtures/cases', import.meta.url));
const digestCasesDir = fileURLToPath(new URL('./fixtures/digest-cases', import.meta.url));
const fakeImpl = fileURLToPath(new URL('./fixtures/impl/fake-impl.mjs', import.meta.url));

/** The scripted implementation, quoted so a path with spaces survives the split. */
function command(variant?: string): string {
  return `"${process.execPath}" "${fakeImpl}"${variant ? ` ${variant}` : ''}`;
}

interface Invocation {
  code: number;
  out: string;
  err: string;
}

async function invoke(...argv: string[]): Promise<Invocation> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    env: {},
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

async function report(...argv: string[]): Promise<{ code: number; report: Report }> {
  const result = await invoke(...argv, '--format', 'json');
  return { code: result.code, report: JSON.parse(result.out) as Report };
}

const exerciseArtifact = `---
id: FR-EXERCISE-001
type: functional-requirement
---

## Requirement

The product MUST exercise this citation.
`;

async function zeroDiagnosticCase(): Promise<{
  cases: string;
  detectMutation: string;
  ignoreMutation: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'pdac-conformance-exercise-'));
  const caseDir = join(root, 'pinned-zero-diagnostic');
  const model = join(caseDir, 'repo', 'docs', 'product', 'model', 'requirements', 'functional');
  const specs = join(caseDir, 'repo', 'specs');
  await mkdir(model, { recursive: true });
  await mkdir(specs, { recursive: true });
  await writeFile(join(model, 'fr-exercise-001.md'), exerciseArtifact);
  await writeFile(
    join(specs, 'feature.citations.yml'),
    `citations:\n  - id: FR-EXERCISE-001\n    digest: ${digestText(exerciseArtifact)}\n`,
  );
  await writeFile(join(caseDir, 'expected.json'), '{ "diagnostics": [] }\n');

  const script = join(root, 'implementation.mjs');
  await writeFile(
    script,
    `import { readFile } from 'node:fs/promises';
const target = await readFile('docs/product/model/requirements/functional/fr-exercise-001.md', 'utf8');
const diagnostics = process.argv.includes('--detect') && target.includes('pdac-conformance exercise')
  ? [{ code: 'PRODUCT061', target: 'FR-EXERCISE-001' }]
  : [];
process.stdout.write(JSON.stringify({ diagnostics }) + '\\n');
process.exit(diagnostics.length ? 1 : 0);
`,
  );
  return {
    cases: root,
    detectMutation: `"${process.execPath}" "${script}" --detect`,
    ignoreMutation: `"${process.execPath}" "${script}"`,
  };
}

const noDiagnostics = '{"diagnostics":[]}';

it('preserves identical authored occurrences within a command while unioning commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pdac-occurrences-'));
  const dir = join(root, 'cases', 'occurrences');
  await mkdir(join(dir, 'repo'), { recursive: true });
  const diagnostic = {
    severity: 'error',
    code: 'PRODUCT006',
    file: 'lc.md',
    artifact: 'LC-A',
    field: 'transitions[].governed-by',
    target: 'BR-MISSING',
  };
  await writeFile(
    join(dir, 'expected.json'),
    JSON.stringify({ diagnostics: [diagnostic, diagnostic], exitCode: 1 }),
  );
  const adapter = join(root, 'occurrences.mjs');
  await writeFile(
    adapter,
    `console.log(${JSON.stringify(JSON.stringify({ diagnostics: [diagnostic, diagnostic] }))}); process.exitCode = 1;`,
  );
  const argv = `"${process.execPath}" "${adapter}"`;
  const result = await report(
    'run',
    '--cases',
    join(root, 'cases'),
    '--command',
    argv,
    '--command',
    argv,
  );
  expect(result.report.summary.passed).toBe(1);
  expect(result.report.cases[0]?.missing).toEqual([]);
  expect(result.report.cases[0]?.unexpected).toEqual([]);
});

async function writeZeroDiagnosticCase(
  cases: string,
  name: string,
  files: Record<string, string>,
): Promise<void> {
  const repo = join(cases, name, 'repo');
  await mkdir(repo, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const destination = join(repo, path);
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, content);
  }
  await writeFile(join(cases, name, 'expected.json'), '{"diagnostics":[]}\n');
  await writeFile(join(repo, 'impl.json'), `{"stdout":${JSON.stringify(noDiagnostics)}}\n`);
}

function artifact(id: string, type: string, extra = ''): string {
  return `---
id: ${id}
type: ${type}
${extra}---

## Fixture

An artifact used to exercise the conformance runner.
`;
}

/** Six compact analogues of the frozen suite's zero-diagnostic fixture families. */
async function sixZeroDiagnosticCases(): Promise<string> {
  const cases = await mkdtemp(join(tmpdir(), 'pdac-conformance-six-zero-'));
  const cited = artifact('FR-CITATION-001', 'functional-requirement');
  const citedDigest = digestText(cited);
  for (const name of ['citation-current', 'digest-bytes-not-text', 'greenfield-first-increment']) {
    await writeZeroDiagnosticCase(cases, name, {
      'docs/product/model/requirements/functional/fr-citation-001.md': cited,
      'specs/feature.citations.yml': `citations:\n  - id: FR-CITATION-001\n    digest: ${citedDigest}\n`,
    });
  }

  const kinds = [
    ['ACT-ALL-KINDS', 'actor'],
    ['JRN-ALL-KINDS', 'journey'],
    ['UC-ALL-KINDS', 'use-case'],
    ['BR-ALL-KINDS', 'business-rule'],
    ['BC-ALL-KINDS', 'bounded-context'],
    ['TERM-ALL-KINDS', 'domain-term'],
    ['FR-ALL-KINDS', 'functional-requirement'],
    ['QR-ALL-KINDS', 'quality-requirement'],
    ['CON-ALL-KINDS', 'constraint'],
  ] as const;
  const allKinds = Object.fromEntries(
    kinds.map(([id, type]) => [
      `docs/product/model/${id.toLowerCase()}.md`,
      artifact(id, type, type === 'journey' ? 'primary-actor: ACT-ALL-KINDS\n' : ''),
    ]),
  );
  await writeZeroDiagnosticCase(cases, 'artifact-kinds-valid', allKinds);

  await writeZeroDiagnosticCase(cases, 'configuration-custom-root', {
    '.product/config.yaml': 'version: v1alpha1\nproduct-root: product\n',
    'product/model/actors/act-config-reader.md': artifact('ACT-CONFIG-READER', 'actor'),
  });

  await writeZeroDiagnosticCase(cases, 'dedicated-topology', {
    'docs/product/model/actors/act-validator.md': artifact('ACT-VALIDATOR', 'actor'),
    'docs/product/model/journeys/jrn-validate.md': artifact(
      'JRN-VALIDATE',
      'journey',
      'primary-actor: ACT-VALIDATOR\n',
    ),
    'docs/product/model/use-cases/uc-validate.md': artifact('UC-VALIDATE', 'use-case'),
    'docs/product/model/requirements/functional/fr-validate.md': artifact(
      'FR-VALIDATE',
      'functional-requirement',
    ),
  });
  return cases;
}

describe('pdac-conformance run', () => {
  it('passes a case whose emitted diagnostics satisfy its expectations', async () => {
    const { code, report: json } = await report(
      'run',
      '--cases',
      casesDir,
      '--case',
      'pass-case',
      '--command',
      command(),
    );
    expect(code).toBe(exitCodes.success);
    expect(json.summary).toMatchObject({ total: 1, passed: 1, failed: 0, errored: 0 });
    expect(json.cases[0]?.runs[0]?.argv.slice(-2)).toEqual(['--format', 'json']);
  });

  it('records stable claimed and observed provenance without treating claims as observations', async () => {
    const { report: json } = await report(
      'run',
      '--cases',
      casesDir,
      '--case',
      'pass-case',
      '--command',
      command(),
      '--implementation-name',
      'ProductShape',
      '--implementation-version',
      '0.14.0',
      '--implementation-artifact',
      'sha256:example',
      '--spec-version',
      '0.2.0',
      '--serialization-version',
      'v1alpha1',
    );
    expect(json.schema).toBe('pdac-conformance/report/v1');
    expect(json.kind).toBe('conformance');
    expect(json.provenance).toMatchObject({
      observed: {
        runner: { name: 'pdac-conformance', version: '1.0.1' },
        spec: { cases: casesDir, revision: null, branch: null, dirty: null },
      },
      claimed: {
        implementation: {
          name: 'ProductShape',
          version: '0.14.0',
          artifactIdentity: 'sha256:example',
        },
        spec: { version: '0.2.0', serializationVersion: 'v1alpha1' },
      },
    });
  });

  it('requires a pinned zero-diagnostic case to observe a controlled target mutation', async () => {
    const fixture = await zeroDiagnosticCase();
    const { code, report: json } = await report(
      'run',
      '--cases',
      fixture.cases,
      '--command',
      fixture.detectMutation,
    );
    expect(code).toBe(exitCodes.success);
    expect(json.cases[0]?.exercises).toMatchObject([
      { target: 'FR-EXERCISE-001', status: 'pass', expectedCodes: ['PRODUCT061', 'PRODUCT062'] },
    ]);
  });

  it('fails a pinned zero-diagnostic case when a command ignores its controlled target mutation', async () => {
    const fixture = await zeroDiagnosticCase();
    const { code, report: json } = await report(
      'run',
      '--cases',
      fixture.cases,
      '--command',
      fixture.ignoreMutation,
    );
    expect(code).toBe(exitCodes.conformanceFailures);
    expect(json.cases[0]).toMatchObject({ status: 'fail' });
    expect(json.cases[0]?.exercises[0]?.reason).toMatch(/exercised nothing/);
  });

  it('fails all six frozen-suite zero-diagnostic case families for a no-op implementation', async () => {
    const cases = await sixZeroDiagnosticCases();
    const { code, report: json } = await report('run', '--cases', cases, '--command', command());
    expect(code).toBe(exitCodes.conformanceFailures);
    expect(json.summary).toMatchObject({ total: 6, passed: 0, failed: 6, errored: 0 });
    expect(json.cases.map((entry) => entry.name)).toEqual([
      'artifact-kinds-valid',
      'citation-current',
      'configuration-custom-root',
      'dedicated-topology',
      'digest-bytes-not-text',
      'greenfield-first-increment',
    ]);
    expect(json.cases.every((entry) => entry.status === 'fail')).toBe(true);
  });

  it('passes all six frozen-suite zero-diagnostic case families for an implementation that observes each mutation', async () => {
    const cases = await sixZeroDiagnosticCases();
    const { code, report: json } = await report(
      'run',
      '--cases',
      cases,
      '--command',
      command('soundness'),
    );
    expect(code).toBe(exitCodes.success);
    expect(json.summary).toMatchObject({ total: 6, passed: 6, failed: 0, errored: 0 });
    expect(
      json.cases
        .find((entry) => entry.name === 'artifact-kinds-valid')
        ?.exercises.filter((exercise) => exercise.kind === 'artifact-type'),
    ).toHaveLength(9);
    expect(
      json.cases.find((entry) => entry.name === 'configuration-custom-root')?.exercises,
    ).toMatchObject([{ kind: 'artifact-type', target: 'ACT-CONFIG-READER', status: 'pass' }]);
    expect(
      json.cases.find((entry) => entry.name === 'dedicated-topology')?.exercises,
    ).toContainEqual(expect.objectContaining({ kind: 'graph-reference', status: 'pass' }));
  });

  it('refuses a zero-diagnostic fixture with no deterministic positive-evidence probe', async () => {
    const cases = await mkdtemp(join(tmpdir(), 'pdac-conformance-unprotected-'));
    await writeZeroDiagnosticCase(cases, 'unprotected', {});
    const { code, report: json } = await report('run', '--cases', cases, '--command', command());
    expect(code).toBe(exitCodes.conformanceFailures);
    expect(json.cases[0]?.status).toBe('error');
    expect(json.cases[0]?.exercises).toMatchObject([
      { kind: 'unprotected', status: 'error', reason: expect.stringMatching(/positive evidence/) },
    ]);
  });

  it('fails a case whose expected diagnostic never arrives', async () => {
    const { code, report: json } = await report(
      'run',
      '--cases',
      casesDir,
      '--case',
      'fail-missing',
      '--command',
      command(),
    );
    expect(code).toBe(exitCodes.conformanceFailures);
    expect(json.cases[0]?.status).toBe('fail');
    expect(json.cases[0]?.missing).toEqual([
      {
        severity: 'error',
        code: 'PRODUCT006',
        file: 'docs/product/model/use-cases/uc-example-001.md',
        target: 'FR-ABSENT-001',
      },
    ]);
  });

  it('fails a case that emits a diagnostic nothing expected', async () => {
    const { code, report: json } = await report(
      'run',
      '--cases',
      casesDir,
      '--case',
      'fail-unexpected',
      '--command',
      command(),
    );
    expect(code).toBe(exitCodes.conformanceFailures);
    expect(json.cases[0]?.status).toBe('fail');
    expect(json.cases[0]?.unexpected).toHaveLength(1);
    // Exit 1 from the implementation is the correct outcome for a fixture that has errors.
    expect(json.cases[0]?.runs[0]?.exitCode).toBe(1);
  });

  it('errors, rather than fails, when the implementation emits no JSON', async () => {
    const { code, report: json } = await report(
      'run',
      '--cases',
      casesDir,
      '--case',
      'error-bad-json',
      '--command',
      command(),
    );
    expect(code).toBe(exitCodes.conformanceFailures);
    expect(json.cases[0]?.status).toBe('error');
    expect(json.cases[0]?.reason).toMatch(/not JSON/);
  });

  it('accepts an asserted exit 2 while still comparing diagnostics', async () => {
    const { code, report: json } = await report(
      'run',
      '--cases',
      casesDir,
      '--case',
      'expected-exit-code',
      '--command',
      command(),
    );
    expect(code).toBe(exitCodes.success);
    expect(json.cases[0]).toMatchObject({
      status: 'pass',
      expectedExitCode: 2,
      exitCodeMismatches: [],
      missing: [],
      unexpected: [],
    });
    expect(json.cases[0]?.runs[0]?.exitCode).toBe(2);
  });

  it('fails an asserted exit-code mismatch without discarding matched diagnostics', async () => {
    const { code, report: json } = await report(
      'run',
      '--cases',
      casesDir,
      '--case',
      'expected-exit-code',
      '--command',
      command('wrong-exit'),
    );
    expect(code).toBe(exitCodes.conformanceFailures);
    expect(json.cases[0]).toMatchObject({
      status: 'fail',
      expectedExitCode: 2,
      exitCodeMismatches: [{ expected: 2, actual: 1 }],
      missing: [],
      unexpected: [],
    });
  });

  it('applies the asserted exit code to every configured command', async () => {
    const { code, report: json } = await report(
      'run',
      '--cases',
      casesDir,
      '--case',
      'expected-exit-code',
      '--command',
      command(),
      '--command',
      command('wrong-exit'),
    );
    expect(code).toBe(exitCodes.conformanceFailures);
    expect(json.cases[0]?.runs).toHaveLength(2);
    expect(json.cases[0]?.exitCodeMismatches).toEqual([
      expect.objectContaining({ expected: 2, actual: 1 }),
    ]);
    expect(json.cases[0]?.missing).toEqual([]);
    expect(json.cases[0]?.unexpected).toEqual([]);
  });

  it('still reports missing diagnostics when the asserted exit code matches', async () => {
    const { code, report: json } = await report(
      'run',
      '--cases',
      casesDir,
      '--case',
      'expected-exit-code',
      '--command',
      command('missing-diagnostic'),
    );
    expect(code).toBe(exitCodes.conformanceFailures);
    expect(json.cases[0]?.exitCodeMismatches).toEqual([]);
    expect(json.cases[0]?.missing).toHaveLength(1);
  });

  it('renders an expected exit-code mismatch in the text report', async () => {
    const result = await invoke(
      'run',
      '--cases',
      casesDir,
      '--case',
      'expected-exit-code',
      '--command',
      command('wrong-exit'),
    );
    expect(result.out).toMatch(/exit code:\s+expected 2, got 1/);
  });

  it('names the command each relayed stream came from under an errored case', async () => {
    const result = await invoke(
      'run',
      '--cases',
      casesDir,
      '--case',
      'error-bad-json',
      '--command',
      command(),
    );
    expect(result.out).toMatch(/stderr of '.+fake-impl/);
    expect(result.out).toMatch(/stdout of '.+fake-impl/);
  });

  it('unions the diagnostics of every configured command', async () => {
    const one = await report(
      'run',
      '--cases',
      casesDir,
      '--case',
      'union-case',
      '--command',
      command(),
    );
    expect(one.code).toBe(exitCodes.conformanceFailures);
    expect(one.report.cases[0]?.missing).toHaveLength(1);

    const both = await report(
      'run',
      '--cases',
      casesDir,
      '--case',
      'union-case',
      '--command',
      command(),
      '--command',
      command('citations'),
    );
    expect(both.code).toBe(exitCodes.success);
    expect(both.report.cases[0]?.status).toBe('pass');
    expect(both.report.cases[0]?.runs).toHaveLength(2);
  });

  it('reports skipped cases by name and reason, and never as passes', async () => {
    const { report: json } = await report('run', '--cases', casesDir, '--command', command());
    const skipped = json.cases.filter((c) => c.status === 'skip');
    expect(skipped.map((c) => c.name)).toEqual([
      'skip-extended-format',
      'skip-invalid-exit-code',
      'skip-no-expected',
    ]);
    expect(json.summary.skipped).toBe(3);
    expect(json.summary.passed + json.summary.failed + json.summary.errored).toBe(6);
  });

  it('runs against a copy, leaving the conformance tests untouched', async () => {
    await invoke('run', '--cases', casesDir, '--case', 'pass-case', '--command', command());
    await expect(access(join(casesDir, 'pass-case', 'repo', 'ran.txt'))).rejects.toThrow();
  });

  it('names the spec source in the text report', async () => {
    const result = await invoke(
      'run',
      '--cases',
      casesDir,
      '--case',
      'pass-case',
      '--command',
      command(),
    );
    expect(result.out).toContain('Conformance:');
    expect(result.out).toContain('pass  pass-case');
    expect(result.out).toContain('1 case(s): 1 passed');
  });
});

describe('pdac-conformance digests', () => {
  it('verifies conformance tests whose pins still hold', async () => {
    const result = await invoke('digests', '--cases', digestCasesDir, '--case', 'current-pin');
    expect(result.code).toBe(exitCodes.success);
    expect(result.out).toMatch(/1 pinned digest\(s\) verified/);
  });

  it('fails conformance tests whose pin no longer matches, naming both digests', async () => {
    const result = await invoke('digests', '--cases', digestCasesDir, '--case', 'stale-pin');
    expect(result.code).toBe(exitCodes.conformanceFailures);
    expect(result.out).toMatch(/mismatch/);
    expect(result.out).toMatch(/recomputed/);
  });

  it('emits the digest report schema under --format json', async () => {
    const result = await invoke('digests', '--cases', digestCasesDir, '--format', 'json');
    const json = JSON.parse(result.out) as DigestReport;
    expect(json.schema).toBe('pdac-conformance/report/v1');
    expect(json.kind).toBe('digests');
    expect(json.summary).toMatchObject({ total: 2, verified: 1, failed: 1, cases: 2 });
    expect(json.pins.map((pin) => pin.status)).toEqual(['match', 'mismatch']);
  });

  it('needs no implementation command', async () => {
    const result = await invoke('digests', '--cases', digestCasesDir, '--case', 'current-pin');
    expect(result.err).not.toMatch(/no implementation to run/);
  });

  it('requires conformance tests', async () => {
    const result = await invoke('digests');
    expect(result.code).toBe(exitCodes.invalidInvocation);
    expect(result.err).toMatch(/no conformance tests given/);
  });

  /**
   * A gate that verified nothing must not read as a gate that passed. Exit 2 is already the code
   * for "there was nothing to run", so finding no pins joins it rather than inventing a status.
   */
  it('refuses to report success when the conformance tests pin nothing', async () => {
    const result = await invoke('digests', '--cases', casesDir);
    expect(result.code).toBe(exitCodes.invalidInvocation);
    expect(result.err).toMatch(/no pinned digests/);
  });
});

describe('pdac-conformance invocation', () => {
  it('requires conformance tests', async () => {
    const result = await invoke('run', '--command', command());
    expect(result.code).toBe(exitCodes.invalidInvocation);
    expect(result.err).toMatch(/no conformance tests given/);
  });

  it('requires an implementation command', async () => {
    const result = await invoke('run', '--cases', casesDir);
    expect(result.code).toBe(exitCodes.invalidInvocation);
    expect(result.err).toMatch(/no implementation to run/);
  });

  it('rejects an unknown command and an unknown flag', async () => {
    const unknown = await invoke('badge');
    expect(unknown.code).toBe(exitCodes.invalidInvocation);
    expect(unknown.err).toMatch(/expected 'run' or 'digests'/);
    expect((await invoke('run', '--nope')).code).toBe(exitCodes.invalidInvocation);
  });

  it('rejects an unknown report format', async () => {
    const result = await invoke('run', '--cases', casesDir, '--command', 'x', '--format', 'yaml');
    expect(result.code).toBe(exitCodes.invalidInvocation);
    expect(result.err).toMatch(/unknown format/);
  });

  it('reports a command that cannot be started as a configuration fault', async () => {
    const result = await invoke(
      'run',
      '--cases',
      casesDir,
      '--case',
      'pass-case',
      '--command',
      'pdac-lint-no-such-executable validate',
    );
    expect(result.code).toBe(exitCodes.invalidInvocation);
    expect(result.err).toMatch(/cannot run/);
  });

  it('prints help and a version', async () => {
    const help = await invoke('--help');
    expect(help.code).toBe(exitCodes.success);
    expect(help.out).toContain('pdac-conformance run [options]');

    const version = await invoke('--version');
    expect(version.code).toBe(exitCodes.success);
    expect(version.out).toMatch(/^\d+\.\d+\.\d+/);
  });
});
