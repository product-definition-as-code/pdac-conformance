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
process.exit(code);
