import { defineConfig } from 'tsup';

// The runner has no runtime dependencies, so the bundle is the source and nothing else. A
// certifier that pulls a supply chain of its own is a certifier nobody can audit in an afternoon.
export default defineConfig({
  entry: ['src/bin.ts'],
  format: ['esm'],
  target: 'node24',
  sourcemap: false,
  clean: true,
});
