import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { CorpusError } from './corpus.js';
import { verifyDigests } from './digests.js';
import { CommandError } from './execute.js';
import { renderDigestJson, renderDigestText, renderJson, renderText } from './report.js';
import { defaultTimeoutMs, runCorpus } from './run.js';

/** The spec's exit codes (spec/validation.md), applied to the runner itself. */
export const exitCodes = {
  success: 0,
  conformanceFailures: 1,
  invalidInvocation: 2,
  internalFailure: 3,
} as const;

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  env: NodeJS.ProcessEnv;
}

export function version(): string {
  const require = createRequire(import.meta.url);
  const pkg = require('../package.json') as { version: string };
  return pkg.version;
}

export const usage = `pdac-lint - conformance runner for Product Definition as Code

Usage:
  pdac-lint run [options]       run the corpus against an implementation
  pdac-lint digests [options]   verify the digests the corpus pins, no implementation needed

Options:
  --spec <path>       spec checkout holding conformance/cases (env: PDAC_SPEC)
  --cases <dir>       corpus directory, overriding --spec
  --command <argv>    implementation command to run against each fixture, repeatable;
                      --format json is appended when absent
  --case <name>       run only this case, repeatable
  --format <fmt>      report format: text (default) or json
  --keep              keep the fixture working copies for inspection
  --timeout <ms>      per-command timeout (default ${defaultTimeoutMs})
  -h, --help          show this help
  -V, --version       show the version

Exit codes:
  0  every case passed (skipped cases are reported, never counted as evidence)
  1  a case failed or errored
  2  invalid invocation, no corpus to run, or no pinned digests to verify
  3  unexpected internal failure

Examples:
  pdac-lint run --spec ./spec --command "prodshape change validate"
  pdac-lint digests --spec ./spec`;

export async function runCli(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        spec: { type: 'string' },
        cases: { type: 'string' },
        command: { type: 'string', multiple: true },
        case: { type: 'string', multiple: true },
        format: { type: 'string' },
        keep: { type: 'boolean' },
        timeout: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'V' },
      },
    });
  } catch (error) {
    io.err(`error: ${(error as Error).message}`);
    io.err(usage);
    return exitCodes.invalidInvocation;
  }

  const { values, positionals } = parsed;
  if (values.help) {
    io.out(usage);
    return exitCodes.success;
  }
  if (values.version) {
    io.out(version());
    return exitCodes.success;
  }

  const [command, ...rest] = positionals;
  if (command === undefined) {
    io.err('error: no command given');
    io.err(usage);
    return exitCodes.invalidInvocation;
  }
  if ((command !== 'run' && command !== 'digests') || rest.length > 0) {
    io.err(`error: unknown command '${[command, ...rest].join(' ')}'`);
    io.err(usage);
    return exitCodes.invalidInvocation;
  }

  const format = values.format ?? 'text';
  if (format !== 'text' && format !== 'json') {
    io.err(`error: unknown format '${format}': expected text or json`);
    return exitCodes.invalidInvocation;
  }

  const spec = values.spec ?? io.env.PDAC_SPEC;
  if (!spec && !values.cases) {
    io.err(
      'error: no corpus given: pass --spec <spec checkout>, --cases <directory>, or PDAC_SPEC',
    );
    io.err(usage);
    return exitCodes.invalidInvocation;
  }

  // The digest check reads the fixtures and nothing else: it needs no implementation, and it must
  // not depend on one, or the corpus would be checking its own integrity through the very thing
  // it exists to judge.
  if (command === 'digests') {
    let digests;
    try {
      digests = await verifyDigests({ spec, cases: values.cases, only: values.case });
    } catch (error) {
      if (error instanceof CorpusError) {
        io.err(`error: ${error.message}`);
        return exitCodes.invalidInvocation;
      }
      throw error;
    }
    io.out(format === 'json' ? renderDigestJson(digests) : renderDigestText(digests));
    // A gate that verified nothing must not read as a gate that passed. Finding no pins is the
    // same kind of outcome as finding no corpus: the command could not do its job, which is exit
    // 2, not a clean bill of health.
    if (digests.summary.total === 0) {
      io.err(`error: no pinned digests found in ${digests.spec.cases}`);
      return exitCodes.invalidInvocation;
    }
    return digests.summary.failed > 0 ? exitCodes.conformanceFailures : exitCodes.success;
  }

  const commands = values.command ?? [];
  if (commands.length === 0) {
    io.err('error: no implementation to run: pass --command "<cli> <subcommand>" at least once');
    io.err(usage);
    return exitCodes.invalidInvocation;
  }

  let timeoutMs = defaultTimeoutMs;
  if (values.timeout !== undefined) {
    timeoutMs = Number(values.timeout);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      io.err(`error: --timeout expects a positive whole number of milliseconds`);
      return exitCodes.invalidInvocation;
    }
  }

  let report;
  try {
    report = await runCorpus({
      spec,
      cases: values.cases,
      only: values.case,
      commands,
      keep: values.keep,
      timeoutMs,
    });
  } catch (error) {
    if (error instanceof CorpusError || error instanceof CommandError) {
      io.err(`error: ${error.message}`);
      return exitCodes.invalidInvocation;
    }
    throw error;
  }

  io.out(format === 'json' ? renderJson(report) : renderText(report));

  const { failed, errored } = report.summary;
  return failed + errored > 0 ? exitCodes.conformanceFailures : exitCodes.success;
}
