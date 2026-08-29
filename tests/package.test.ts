import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));
const compatibilityPackagePath = fileURLToPath(
  new URL('../compat/pdac-lint/package.json', import.meta.url),
);

describe('package migration', () => {
  it('publishes the canonical package and binary', async () => {
    const pkg = JSON.parse(await readFile(packagePath, 'utf8')) as {
      name: string;
      bin: Record<string, string>;
    };
    expect(pkg.name).toBe('pdac-conformance');
    expect(pkg.bin).toEqual({ 'pdac-conformance': 'dist/bin.js' });
  });

  it('defines exactly one compatibility package that forwards to the canonical package', async () => {
    const pkg = JSON.parse(await readFile(compatibilityPackagePath, 'utf8')) as {
      name: string;
      bin: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(pkg.name).toBe('pdac-lint');
    expect(pkg.bin).toEqual({ 'pdac-lint': 'bin.js' });
    expect(pkg.dependencies['pdac-conformance']).toBe('workspace:^1.0.1');
  });
});
