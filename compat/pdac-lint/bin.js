#!/usr/bin/env node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

console.error('pdac-lint is deprecated; use pdac-conformance.');

const require = createRequire(import.meta.url);
const runner = require.resolve('pdac-conformance/dist/bin.js');
await import(pathToFileURL(runner).href);
