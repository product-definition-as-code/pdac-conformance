import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CommandError,
  resolveExecutable,
  runCommand,
  splitCommand,
  withJsonFormat,
} from '../src/execute.js';

const fakeBatch = fileURLToPath(new URL('./fixtures/impl/fake-impl.cmd', import.meta.url));
const fixtureRepo = fileURLToPath(new URL('./fixtures/cases/pass-case/repo', import.meta.url));

describe('splitCommand', () => {
  it('splits on whitespace', () => {
    expect(splitCommand('prodshape change validate')).toEqual(['prodshape', 'change', 'validate']);
  });

  it('groups quoted tokens and keeps backslashes literal', () => {
    expect(splitCommand('node "C:\\Program Files\\impl\\bin.js" validate')).toEqual([
      'node',
      'C:\\Program Files\\impl\\bin.js',
      'validate',
    ]);
  });

  it('accepts single quotes and an empty quoted argument', () => {
    expect(splitCommand("impl --label 'two words' ''")).toEqual([
      'impl',
      '--label',
      'two words',
      '',
    ]);
  });

  it('rejects an unbalanced quote', () => {
    expect(() => splitCommand('impl "unterminated')).toThrow(CommandError);
  });

  it('rejects an empty command', () => {
    expect(() => splitCommand('   ')).toThrow(CommandError);
  });
});

describe('withJsonFormat', () => {
  it('appends the JSON format flag', () => {
    expect(withJsonFormat(['prodshape', 'validate'])).toEqual([
      'prodshape',
      'validate',
      '--format',
      'json',
    ]);
  });

  it('leaves an explicit format alone', () => {
    expect(withJsonFormat(['impl', '--format=json'])).toEqual(['impl', '--format=json']);
    expect(withJsonFormat(['impl', '--format', 'json'])).toEqual(['impl', '--format', 'json']);
  });
});

describe('resolveExecutable', () => {
  it('finds an interpreter on PATH', async () => {
    expect(await resolveExecutable('node')).toBeDefined();
  });

  it('returns nothing for a name that is not installed', async () => {
    expect(await resolveExecutable('pdac-lint-no-such-executable')).toBeUndefined();
  });
});

describe('Windows command invocation', () => {
  it.runIf(process.platform === 'win32')(
    'runs an npm-style .cmd shim without a shell',
    async () => {
      const work = await mkdtemp(join(tmpdir(), 'pdac-conformance-windows-'));
      try {
        await cp(fixtureRepo, work, { recursive: true });
        const result = await runCommand([fakeBatch, '--format', 'json'], work, 10_000);
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toHaveProperty('diagnostics');
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    },
  );
});
