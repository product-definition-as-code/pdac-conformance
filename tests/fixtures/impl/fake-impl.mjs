#!/usr/bin/env node
// A stand-in implementation CLI for the runner's own tests.
//
// It reads its scripted response from `impl.json` (or `impl-<variant>.json`) inside the fixture
// repository it was run in, prints the recorded stdout verbatim and exits with the recorded code.
// That keeps the runner's tests free of any real implementation, and it writes `ran.txt` so a test
// can prove the command ran against a copy rather than against the corpus itself.
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
// The variant, when given, is the first argument; everything after it is the runner's own flags.
const variant = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
const file = variant ? `impl-${variant}.json` : 'impl.json';

// The runner promises every implementation is invoked with `--format json`.
const formatIndex = args.indexOf('--format');
if (formatIndex === -1 || args[formatIndex + 1] !== 'json') {
  console.error('fake-impl: expected --format json');
  process.exit(2);
}

writeFileSync('ran.txt', `${file}\n`);

let scripted;
try {
  scripted = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`fake-impl: cannot read ${file}: ${error.message}`);
  process.exit(3);
}

if (scripted.stdout !== undefined) process.stdout.write(scripted.stdout);
if (scripted.stderr !== undefined) process.stderr.write(scripted.stderr);
process.exit(scripted.exit ?? 0);
