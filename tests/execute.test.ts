import { describe, expect, it } from 'vitest';
import { CommandError, resolveExecutable, splitCommand, withJsonFormat } from '../src/execute.js';

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
