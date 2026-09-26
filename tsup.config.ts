import { defineConfig } from 'tsup';

// YAML parsing preserves semantic comparison of archived change frontmatter:
// conforming tools need not choose the same whitespace or key order.
export default defineConfig({
  entry: ['src/bin.ts'],
  format: ['esm'],
  target: 'node24',
  sourcemap: false,
  clean: true,
});
