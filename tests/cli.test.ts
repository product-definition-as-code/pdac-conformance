import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { exitCodes, runCli } from '../src/cli.js';
import type { DigestReport, Report } from '../src/types.js';

const corpusDir = fileURLToPath(new URL('./fixtures/corpus', import.meta.url));
const digestCorpusDir = fileURLToPath(new URL('./fixtures/digest-corpus', import.meta.url));
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

describe('pdac-lint run', () => {
  it('passes a case whose emitted diagnostics satisfy its expectations', async () => {
    const { code, report: json } = await report(
      'run',
      '--cases',
      corpusDir,
      '--case',
      'pass-case',
      '--command',
      command(),
    );
    expect(code).toBe(exitCodes.success);
    expect(json.summary).toMatchObject({ total: 1, passed: 1, failed: 0, errored: 0 });
    expect(json.cases[0]?.runs[0]?.argv.slice(-2)).toEqual(['--format', 'json']);
  });

  it('fails a case whose expected diagnostic never arrives', async () => {
    const { code, report: json } = await report(
      'run',
      '--cases',
      corpusDir,
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
      corpusDir,
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
      corpusDir,
      '--case',
      'error-bad-json',
      '--command',
      command(),
    );
    expect(code).toBe(exitCodes.conformanceFailures);
    expect(json.cases[0]?.status).toBe('error');
    expect(json.cases[0]?.reason).toMatch(/not JSON/);
  });

  it('unions the diagnostics of every configured command', async () => {
    const one = await report(
      'run',
      '--cases',
      corpusDir,
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
      corpusDir,
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
    const { report: json } = await report('run', '--cases', corpusDir, '--command', command());
    const skipped = json.cases.filter((c) => c.status === 'skip');
    expect(skipped.map((c) => c.name)).toEqual(['skip-extended-format', 'skip-no-expected']);
    expect(json.summary.skipped).toBe(2);
    expect(json.summary.passed + json.summary.failed + json.summary.errored).toBe(5);
  });

  it('runs against a copy, leaving the corpus untouched', async () => {
    await invoke('run', '--cases', corpusDir, '--case', 'pass-case', '--command', command());
    await expect(access(join(corpusDir, 'pass-case', 'repo', 'ran.txt'))).rejects.toThrow();
  });

  it('names the corpus source in the text report', async () => {
    const result = await invoke(
      'run',
      '--cases',
      corpusDir,
      '--case',
      'pass-case',
      '--command',
      command(),
    );
    expect(result.out).toContain('Corpus:');
    expect(result.out).toContain('pass  pass-case');
    expect(result.out).toContain('1 case(s): 1 passed');
  });
});

describe('pdac-lint digests', () => {
  it('verifies a corpus whose pins still hold', async () => {
    const result = await invoke('digests', '--cases', digestCorpusDir, '--case', 'current-pin');
    expect(result.code).toBe(exitCodes.success);
    expect(result.out).toMatch(/1 pinned digest\(s\) verified/);
  });

  it('fails a corpus whose pin no longer matches, naming both digests', async () => {
    const result = await invoke('digests', '--cases', digestCorpusDir, '--case', 'stale-pin');
    expect(result.code).toBe(exitCodes.conformanceFailures);
    expect(result.out).toMatch(/mismatch/);
    expect(result.out).toMatch(/recomputed/);
  });

  it('emits the digest report schema under --format json', async () => {
    const result = await invoke('digests', '--cases', digestCorpusDir, '--format', 'json');
    const json = JSON.parse(result.out) as DigestReport;
    expect(json.schema).toBe('pdac-lint/digest-report/v0');
    expect(json.summary).toMatchObject({ total: 2, verified: 1, failed: 1, cases: 2 });
    expect(json.pins.map((pin) => pin.status)).toEqual(['match', 'mismatch']);
  });

  it('needs no implementation command', async () => {
    const result = await invoke('digests', '--cases', digestCorpusDir, '--case', 'current-pin');
    expect(result.err).not.toMatch(/no implementation to run/);
  });

  it('requires a corpus', async () => {
    const result = await invoke('digests');
    expect(result.code).toBe(exitCodes.invalidInvocation);
    expect(result.err).toMatch(/no corpus given/);
  });

  /**
   * A gate that verified nothing must not read as a gate that passed. Exit 2 is already the code
   * for "there was nothing to run", so finding no pins joins it rather than inventing a status.
   */
  it('refuses to report success when the corpus pins nothing', async () => {
    const result = await invoke('digests', '--cases', corpusDir);
    expect(result.code).toBe(exitCodes.invalidInvocation);
    expect(result.err).toMatch(/no pinned digests/);
  });
});

describe('pdac-lint invocation', () => {
  it('requires a corpus', async () => {
    const result = await invoke('run', '--command', command());
    expect(result.code).toBe(exitCodes.invalidInvocation);
    expect(result.err).toMatch(/no corpus given/);
  });

  it('requires an implementation command', async () => {
    const result = await invoke('run', '--cases', corpusDir);
    expect(result.code).toBe(exitCodes.invalidInvocation);
    expect(result.err).toMatch(/no implementation to run/);
  });

  it('rejects an unknown command and an unknown flag', async () => {
    expect((await invoke('badge')).code).toBe(exitCodes.invalidInvocation);
    expect((await invoke('run', '--nope')).code).toBe(exitCodes.invalidInvocation);
  });

  it('rejects an unknown report format', async () => {
    const result = await invoke('run', '--cases', corpusDir, '--command', 'x', '--format', 'yaml');
    expect(result.code).toBe(exitCodes.invalidInvocation);
    expect(result.err).toMatch(/unknown format/);
  });

  it('reports a command that cannot be started as a configuration fault', async () => {
    const result = await invoke(
      'run',
      '--cases',
      corpusDir,
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
    expect(help.out).toContain('pdac-lint run [options]');

    const version = await invoke('--version');
    expect(version.code).toBe(exitCodes.success);
    expect(version.out).toMatch(/^\d+\.\d+\.\d+/);
  });
});
