# pdac-lint

Independent conformance runner for the [Product Definition as Code specification](https://github.com/product-definition-as-code/spec).

It runs the spec's versioned conformance corpus against any implementation CLI and compares the diagnostics that implementation emits against what the corpus says it must produce. The corpus is the authority; this runner only carries out its comparison rules. Nothing here reads an implementation's internals, so conformance stops being self-referential.

## Install

```bash
npm install --global pdac-lint
```

Node 24 or later. The runner has no runtime dependencies.

## Usage

Two commands: `run` measures an implementation against the corpus, and `digests` checks the corpus against itself.

Point `run` at a spec checkout and tell it how to invoke the implementation under test:

```bash
git clone --depth 1 https://github.com/product-definition-as-code/spec.git
pdac-lint run --spec ./spec --command "prodshape validate" --command "prodshape change validate"
```

```text
Corpus: /work/spec @ e75643e, main
Implementation: prodshape validate
Implementation: prodshape change validate

  pass  change-open-questions
  pass  citation-current
  fail  citation-tampered-and-stale
    missing:    error PRODUCT062 specs/feature-x.md [FR-VALIDATE-001]
  pass  greenfield-first-increment

4 case(s): 3 passed, 1 failed, 0 skipped, 0 errored
```

That failure is real and is the point of the tool. The corpus requires a citation whose embedded projection was hand-edited and whose target also moved to report `PRODUCT062` alone; the reference implementation reports it as `stale` instead, and no command it offers exposes citation diagnostics in the machine-readable envelope. A runner that hid either fact would be a badge that certifies nothing.

### Options

| Option             | Meaning                                                                     |
| ------------------ | --------------------------------------------------------------------------- |
| `--spec <path>`    | spec checkout holding `conformance/cases` (env: `PDAC_SPEC`)                |
| `--cases <dir>`    | corpus directory, overriding `--spec`                                       |
| `--command <argv>` | implementation command, repeatable; `--format json` is appended when absent |
| `--case <name>`    | run only this case, repeatable                                              |
| `--format <fmt>`   | report format: `text` (default) or `json`                                   |
| `--keep`           | keep the fixture working copies for inspection                              |
| `--timeout <ms>`   | per-command timeout                                                         |

Exit codes follow the spec's table: `0` every case passed, `1` a case failed or errored, `2` invalid invocation or no corpus to run, `3` unexpected internal failure.

To pin a conformance claim to a spec version, clone the spec at that ref and point `--spec` at it. The report names the revision it read the corpus from, so a result is attributable to a spec state rather than to whatever happened to be on disk.

### Verifying the digests the corpus pins

The corpus pins content digests: a citation ledger or a Markdown marker block records the digest of the artifact it cites. Nothing else recomputes them, so editing a fixture artifact silently invalidates the citation a case describes while the case keeps asserting its expected diagnostics. `digests` recomputes every pin, under the normalization `spec/validation.md` mandates, and needs no implementation at all:

```bash
pdac-lint digests --spec ./spec
```

```text
Corpus: /work/spec @ d18339e, main

4 pinned digest(s) verified across 5 case(s)
```

A pin is expected to match the artifact it cites, except in a case that exists because it does not. A case expecting `PRODUCT061` or `PRODUCT062` for an artifact pins a digest that must differ from that artifact's current content, and this asserts the difference rather than excusing it, so an edit that accidentally makes a tampered fixture faithful is reported instead of quietly voiding the case. The same holds for `PRODUCT060` and `PRODUCT042`. The expectation is read per artifact, never per case: a stale citation against one requirement says nothing about a pin against another.

Resolution is scoped to `docs/product/model`. A Product Change's `proposed/` tree carries artifacts with the same ids as the baseline, and a citation resolves against the accepted definition, so indexing both would let a proposal decide whether a baseline pin still holds.

`--spec`, `--cases`, `--case` and `--format` apply as above. `--command`, `--keep` and `--timeout` do not: there is no implementation to run.

### More than one command

A single implementation command rarely covers the whole spec. The reference implementation reports Product Change overlay diagnostics from `change validate` and baseline diagnostics from `validate`, so a run that means to check both passes both:

```bash
pdac-lint run --spec ./spec --command "prodshape validate" --command "prodshape change validate"
```

Diagnostics from every command are unioned and deduplicated before the comparison. Each command is still required to emit its own diagnostics in the mandated order.

## What a case must satisfy

Each case is a directory under `conformance/cases/` holding a fixture repository (`repo/`), the diagnostics an implementation must produce (`expected.json`), and prose citing the clause under test (`case.md`).

For every case the runner copies `repo/` to a scratch directory, runs each configured command there with `--format json`, and compares. The corpus is never written to: an implementation that refreshes generated outputs would otherwise change the fixture it was measured against.

The comparison is the corpus's own, from `conformance/README.md`:

- `severity`, `code`, `file`, `artifact`, `field` and `target` are compared;
- `message` is implementation-defined and is never compared;
- a field absent from an expected diagnostic is not asserted;
- expected and emitted diagnostics are paired maximally, so an expectation naming only a code is satisfied by any emitted diagnostic carrying it, and each emitted diagnostic answers at most one expectation. Whatever is left unpaired is reported: expectations nothing satisfied are **missing**, emitted diagnostics nothing expected are **unexpected**;
- diagnostics must be emitted in the order the spec mandates, by file then code then target, which is checked per command.

An implementation exiting `1` is normal: it means the fixture legitimately contains errors. Exit `2` or `3`, output that is not JSON, or a command that hangs makes the case an **error** rather than a failure, because the run produced no verdict.

A case this runner cannot execute is reported as **skipped**, with the reason, and never counted as evidence. That includes any `expected.json` reaching beyond `diagnostics`, which is how the corpus will express an apply invocation, an expected exit code and a working-tree outcome once that case format exists.

## Scope

This runner covers cases expressible as a fixture repository plus expected diagnostics. It does not yet cover the two apply cases (`apply-not-approved`, `apply-baseline-drift`), which need a case format the spec deferred until a runner existed. This is that runner, so that discussion is now unblocked.

There is no GitHub Action and no badge yet. Corpus first, runner second, badge last. When a badge ships it will state exactly what was checked, spec version, conformance level and profile, never a bare "PDaC conformant".

If the organization profile or any page says otherwise, that page is wrong and [we want to know](https://github.com/product-definition-as-code/spec/issues).

## Development

```bash
pnpm install
pnpm test
```

The tests run against a miniature corpus and a scripted stand-in implementation under `tests/fixtures/`, so they need neither a spec checkout nor any real implementation installed.

Releases are published from CI only; see [RELEASING.md](RELEASING.md).

## License

Apache-2.0.
