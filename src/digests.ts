import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { discoverCases, type TestCase, type DiscoverOptions } from './cases.js';
import { reportProvenance } from './provenance.js';
import {
  reportSchema,
  type ClaimOptions,
  type Diagnostic,
  type DigestReport,
  type PinResult,
} from './types.js';

/** A well-formed content digest, as `spec/validation.md` renders one. */
const digestPattern = /^sha256:[0-9a-f]{64}$/;

/** A citation marker block and its attributes. */
const markerPattern = /<!--\s*pdac:cite\s+([\s\S]*?)-->/g;
const attributePattern = /([\w-]+)\s*=\s*"([^"]*)"/g;

/** The keys a citation record carries (`spec/citation-contract.md`, "Citation record"). */
const ledgerKeys = new Set(['id', 'digest', 'anchor']);

/** Baseline artifacts live here; a change proposal's artifacts deliberately do not count. */
const modelRelative = join('docs', 'product', 'model');

/** Statuses that mean the pin is sound. Everything else is a test-case defect. */
const sound = new Set<PinResult['status']>([
  'match',
  'differs-as-expected',
  'unresolved-as-expected',
  'malformed-as-expected',
]);

/**
 * The content digest of these bytes.
 *
 * SHA-256 over the bytes with CRLF and CR normalized to LF, per
 * [Validation](https://github.com/product-definition-as-code/spec/blob/main/spec/validation.md).
 * The normalization is what makes a digest identical across operating systems and Git
 * line-ending configurations, so a Windows checkout verifies the same pins as a Linux one.
 * `latin1` round-trips arbitrary bytes, so this normalizes without decoding as text.
 */
export function digestBytes(data: Buffer): string {
  const normalized = data.toString('latin1').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return `sha256:${createHash('sha256').update(Buffer.from(normalized, 'latin1')).digest('hex')}`;
}

export function digestText(text: string): string {
  return digestBytes(Buffer.from(text, 'utf8'));
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/**
 * Read the citation records of a ledger.
 *
 * The specification fixes the citation record shape and not a serialization, so this reads the
 * shape the conformance tests use and refuses anything else. A ledger this cannot read is reported as a
 * skipped case rather than silently contributing no pins, because a ledger that looks checked
 * and is not is worse than one that is openly skipped.
 */
export function parseLedger(text: string, where: string): Record<string, string>[] {
  const records: Record<string, string>[] = [];
  let current: Record<string, string> | undefined;
  let lineNumber = 0;

  for (const raw of text.split(/\r?\n/)) {
    lineNumber += 1;
    let line = raw.trim();
    if (line === '' || line.startsWith('#') || line === 'citations:') continue;
    if (line.startsWith('- ')) {
      if (current) records.push(current);
      current = {};
      line = line.slice(2).trim();
    }
    if (!current || !line.includes(':')) {
      throw new LedgerError(
        `${where}:${lineNumber}: unexpected line ${JSON.stringify(raw)}: expected a citation record entry ('- id: ...', 'digest: ...', 'anchor: ...')`,
      );
    }
    const separator = line.indexOf(':');
    const key = line.slice(0, separator).trim();
    if (!ledgerKeys.has(key)) {
      throw new LedgerError(
        `${where}:${lineNumber}: unexpected key ${JSON.stringify(key)}: a citation record carries id, digest and, optionally, anchor`,
      );
    }
    current[key] = line.slice(separator + 1).trim();
  }
  if (current) records.push(current);
  return records;
}

/** Every file under a directory, in a stable order. */
async function files(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .sort();
  } catch {
    return [];
  }
}

/** The `id` declared in a file's YAML frontmatter, or undefined when it declares none. */
export function frontmatterId(text: string): string | undefined {
  if (!text.startsWith('---')) return undefined;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return undefined;
  for (const line of text.slice(3, end).split('\n')) {
    const found = /^id:\s*(\S+)\s*$/.exec(line);
    if (found) return found[1];
  }
  return undefined;
}

/**
 * Index the baseline artifacts of a fixture by id.
 *
 * Scoped to `docs/product/model` on purpose. A Product Change's `proposed/` tree holds artifacts
 * carrying the same ids as the baseline, and a citation resolves against the accepted definition,
 * so indexing both would let a proposal's content decide whether a baseline pin still holds.
 */
export async function baselineIndex(repoDir: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  for (const path of await files(join(repoDir, modelRelative))) {
    if (!path.endsWith('.md')) continue;
    const id = frontmatterId(await readFile(path, 'utf8'));
    if (id && !index.has(id)) index.set(id, path);
  }
  return index;
}

export interface CitationPin {
  path: string;
  kind: PinResult['kind'];
  id?: string;
  digest: string;
  anchor?: string;
}

/** Every digest a fixture pins, from its ledgers and from its marker blocks. */
export async function collectCitationPins(repoDir: string): Promise<CitationPin[]> {
  const pins: CitationPin[] = [];
  for (const path of await files(repoDir)) {
    if (path.endsWith('.citations.yml')) {
      const text = await readFile(path, 'utf8');
      for (const record of parseLedger(text, path)) {
        if (record.digest !== undefined) {
          pins.push({
            path,
            kind: 'ledger',
            id: record.id,
            digest: record.digest,
            anchor: record.anchor,
          });
        }
      }
      continue;
    }
    if (!path.endsWith('.md')) continue;
    const text = await readFile(path, 'utf8');
    for (const match of text.matchAll(markerPattern)) {
      const block = match[1];
      if (block === undefined) continue;
      const attributes = new Map(
        [...block.matchAll(attributePattern)].map(([, key, value]) => [key, value]),
      );
      const digest = attributes.get('digest');
      if (digest !== undefined) {
        pins.push({
          path,
          kind: 'marker',
          id: attributes.get('id'),
          digest,
          anchor: attributes.get('anchor'),
        });
      }
    }
  }
  return pins;
}

/**
 * Whether a case expects one of these codes against this artifact.
 *
 * Read per artifact, never per case: a case that expects a stale citation for one requirement
 * says nothing about a pin against another, and treating the expectation as case-wide would
 * excuse exactly the drift this check exists to find. Both `artifact` and `target` are consulted
 * because an unresolved citation names its target where a stale one names the artifact.
 *
 * A pin carrying no id is never excused. `undefined === undefined` is true, so without the guard
 * an expectation naming no artifact and no target would match a pin naming nothing, and a citation
 * this check never verified would be reported as sound.
 */
function expects(expected: Diagnostic[], id: string | undefined, codes: string[]): boolean {
  if (id === undefined) return false;
  return expected.some(
    (diagnostic) =>
      diagnostic.code !== undefined &&
      codes.includes(diagnostic.code) &&
      (diagnostic.artifact === id || diagnostic.target === id),
  );
}

async function judge(
  testCase: TestCase,
  pin: CitationPin,
  index: Map<string, string>,
): Promise<PinResult> {
  const result: PinResult = {
    case: testCase.name,
    source: relative(testCase.dir, pin.path).split(sep).join('/'),
    kind: pin.kind,
    id: pin.id,
    anchor: pin.anchor,
    pinned: pin.digest,
    status: 'match',
  };

  if (!digestPattern.test(pin.digest)) {
    return expects(testCase.expected, pin.id, ['PRODUCT042'])
      ? { ...result, status: 'malformed-as-expected' }
      : { ...result, status: 'malformed' };
  }

  const target = pin.id === undefined ? undefined : index.get(pin.id);
  if (target === undefined) {
    return expects(testCase.expected, pin.id, ['PRODUCT060'])
      ? { ...result, status: 'unresolved-as-expected' }
      : { ...result, status: 'unresolved' };
  }

  const recomputed = digestBytes(await readFile(target));
  const mustDiffer = expects(testCase.expected, pin.id, ['PRODUCT061', 'PRODUCT062']);
  if (mustDiffer) {
    return recomputed === pin.digest
      ? { ...result, recomputed, status: 'unexpected-match' }
      : { ...result, recomputed, status: 'differs-as-expected' };
  }
  return recomputed === pin.digest
    ? { ...result, recomputed, status: 'match' }
    : { ...result, recomputed, status: 'mismatch' };
}

/**
 * Verify every digest the conformance tests pin.
 *
 * A pin is expected to match the artifact it cites, except where the case exists because it does
 * not: a case expecting `PRODUCT061` or `PRODUCT062` pins a digest that must differ, and this
 * asserts the difference instead of excusing it, so an edit that accidentally makes a tampered
 * fixture faithful is caught rather than quietly destroying the case.
 */
export async function verifyDigests(
  options: DiscoverOptions & { claims?: ClaimOptions },
): Promise<DigestReport> {
  const discovered = await discoverCases(options);
  const pins: PinResult[] = [];
  const skipped = [...discovered.skipped];

  for (const testCase of discovered.cases) {
    const index = await baselineIndex(testCase.repoDir);
    let collected: CitationPin[];
    try {
      collected = await collectCitationPins(testCase.repoDir);
    } catch (error) {
      skipped.push({ name: testCase.name, reason: (error as Error).message });
      continue;
    }
    for (const pin of collected) {
      pins.push(await judge(testCase, pin, index));
    }
  }

  const failed = pins.filter((pin) => !sound.has(pin.status)).length;
  return {
    schema: reportSchema,
    kind: 'digests',
    provenance: reportProvenance(discovered.source, options.claims),
    pins,
    skipped,
    summary: {
      total: pins.length,
      verified: pins.length - failed,
      failed,
      cases: discovered.cases.length,
    },
  };
}
