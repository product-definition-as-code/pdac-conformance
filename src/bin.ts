#!/usr/bin/env node
import { exitCodes, runCli } from './cli.js';

let code: number = exitCodes.internalFailure;
try {
  code = await runCli(process.argv.slice(2), {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    env: process.env,
  });
} catch (error) {
  console.error(`internal error: ${(error as Error).stack ?? String(error)}`);
}
// Let the process end on its own: process.exit() discards whatever the pipe has not flushed,
// and a 44-case JSON report is large enough to lose its tail on a piped stdout.
process.exitCode = code;
