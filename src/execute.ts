import { spawn } from 'node:child_process';
import { access, constants, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, extname, isAbsolute, join, resolve } from 'node:path';

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

/** A command that never finished. Distinct from a misconfigured one: this command did run. */
export class TimeoutError extends CommandError {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Split a configured command into argv.
 *
 * Single and double quotes group a token; a backslash is never an escape, because on Windows it is
 * a path separator and `--command "node C:\tools\impl.js"` has to mean what it looks like.
 */
export function splitCommand(command: string): string[] {
  const argv: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let started = false;

  for (const char of command) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) argv.push(current);
      current = '';
      started = false;
      continue;
    }
    current += char;
    started = true;
  }

  if (quote) throw new CommandError(`unbalanced ${quote} in command: ${command}`);
  if (started) argv.push(current);
  if (argv.length === 0) throw new CommandError('empty command');
  return argv;
}

/** Every diagnostics-emitting invocation is a `--format json` one; add it when it is missing. */
export function withJsonFormat(argv: string[]): string[] {
  const hasFormat = argv.some((arg) => arg === '--format' || arg.startsWith('--format='));
  return hasFormat ? [...argv] : [...argv, '--format', 'json'];
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function windowsExtensions(): string[] {
  const pathext = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD';
  return pathext.split(';').filter(Boolean);
}

/**
 * Locate the executable a command names, without handing the string to a shell.
 *
 * The reference implementation installs on Windows as `prodshape.cmd`, a name `spawn` cannot
 * execute directly and PATH lookup alone will not find. Resolving it here keeps `shell: true` and
 * its quoting hazards out of a tool whose whole job is running other people's commands verbatim.
 */
export async function resolveExecutable(file: string): Promise<string | undefined> {
  const isWindows = process.platform === 'win32';
  const candidates: string[] = [];

  const expand = (base: string): void => {
    candidates.push(base);
    if (isWindows && extname(base) === '') {
      for (const ext of windowsExtensions()) candidates.push(base + ext);
    }
  };

  if (file.includes('/') || file.includes('\\') || isAbsolute(file)) {
    expand(resolve(file));
  } else {
    for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
      expand(join(dir, file));
    }
  }

  for (const candidate of candidates) {
    if (await isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}

function quoteForCmd(value: string): string {
  return /[\s"&|<>^()]/.test(value) || value.length === 0
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Spawn a command in `cwd` and collect its output. */
export async function runCommand(
  argv: string[],
  cwd: string,
  timeoutMs: number,
): Promise<SpawnResult> {
  const [file, ...args] = argv as [string, ...string[]];
  const resolved = (await resolveExecutable(file)) ?? file;
  const isBatch = process.platform === 'win32' && ['.cmd', '.bat'].includes(extname(resolved));

  // A .cmd shim is a script for the command interpreter, so it is run through cmd.exe explicitly
  // with arguments quoted here. `shell: true` would join the arguments unquoted instead.
  const [spawnFile, spawnArgs, verbatim] = isBatch
    ? [
        process.env.COMSPEC ?? 'cmd.exe',
        ['/d', '/s', '/c', `"${[resolved, ...args].map(quoteForCmd).join(' ')}"`],
        true,
      ]
    : [resolved, args, false];

  return await new Promise<SpawnResult>((resolvePromise, rejectPromise) => {
    const child = spawn(spawnFile, spawnArgs, {
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: verbatim,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.on('data', (chunk: string) => (stderr += chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      rejectPromise(new CommandError(`cannot run '${argv.join(' ')}': ${error.message}`));
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        rejectPromise(new TimeoutError(`'${argv.join(' ')}' timed out after ${timeoutMs}ms`));
        return;
      }
      // A killed process has no exit code; report it as an internal failure rather than success.
      resolvePromise({ exitCode: code ?? (signal ? 3 : 0), stdout, stderr });
    });
  });
}

/**
 * Copy a fixture to a scratch directory and run `body` there.
 *
 * The conformance tests are read-only input: an implementation that writes generated outputs (the reference
 * one refreshes `.product/generated/` on every validate) would otherwise dirty the spec checkout
 * it was pointed at, and the second run would no longer test the same fixture as the first.
 */
export async function withFixtureCopy<T>(
  repoDir: string,
  name: string,
  keep: boolean,
  body: (workDir: string) => Promise<T>,
): Promise<T> {
  const workDir = await mkdtemp(join(tmpdir(), `pdac-lint-${name}-`));
  try {
    await cp(repoDir, workDir, { recursive: true });
    return await body(workDir);
  } finally {
    if (!keep) await rm(workDir, { recursive: true, force: true });
  }
}
