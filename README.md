# pdac-conformance

Independent conformance runner for the [Product Definition as Code specification](https://github.com/product-definition-as-code/spec).

The working branch adds `pdac-conformance-case/v2` operation cases for the v0.3.0 specification candidate. This is not a new published package version yet.

For those cases, supply `--adapter-command "<trusted adapter>"` alongside ordinary `--command` invocations for flat cases. The runner creates real fixture Git history, passes `--request <json-file>` to the adapter in an isolated working copy, compares diagnostics and normalized semantic reports, and checks the complete resulting tree. A missing adapter is an explicit named skip. See the coordinated specification's [operation protocol](https://github.com/product-definition-as-code/spec/blob/implement/v0.3.0/conformance/operations.md) for request fields, report normalization and the boundary between fixture integrity and observed implementation conformance. Fixtures cannot supply commands.

Operation cases permit semantically equivalent YAML formatting of archived change frontmatter and the specification's optional omission of archived proposed files. An adapter may identify and decode a permitted persisted product diff; its contents are compared before the extra file is allowed. A persisted citation forecast is not permitted. Git refs and staged content must stay unchanged. YAML parsing is the one runtime dependency added for this semantic comparison.

The baseline-only `digests` command explicitly skips operation cases: their evidence, acknowledgment and prospective pins are checked by the versioned spec fixture audit. Flat command unions retain repeated identical diagnostics within a command, while avoiding double-counting the same population reported by multiple commands.

`pdac-conformance` is the canonical repository, npm package and command. The former `pdac-lint` package is a one-release transition package: its command warns and forwards to `pdac-conformance`. Update scripts and CI before that transition package is deprecated.

It checks whether a PDaC implementation follows the specification. It does not validate an ordinary product repository and it does not verify a delivery document's recorded citations against the canonical model — those are `prodshape validate` and `prodshape citations verify`, two commands of [ProductShape](https://github.com/juangcarmona/productshape), the reference implementation of Product Definition as Code: what the runner measures, not what it is. No tool decides whether product claims are true; people do.

It runs the spec's conformance tests against any implementation's CLI. The tests are versioned with the spec. Each test says which diagnostics an implementation must emit, and the runner compares what the implementation actually emits against that. The conformance tests are the authority; the runner only applies their comparison rules. It never reads an implementation's internals, so an implementation cannot vouch for itself.

## Install

```bash
npm install --global pdac-conformance
```

Node 24 or later. The runner uses the YAML package for semantic comparison of archived change frontmatter.

## Usage

Two commands: `run` measures an implementation against the conformance tests, and `digests` checks the conformance tests against themselves. The transcripts below are illustrative examples, not the live case list.

Point `run` at a spec checkout and tell it how to invoke the implementation under test:

```bash
git clone --depth 1 https://github.com/product-definition-as-code/spec.git
pdac-conformance run --spec ./spec --command "prodshape validate" --command "prodshape change validate" --command "prodshape citations verify ."
```

```text
Conformance: /work/spec @ 034d1f4, main
Implementation: prodshape validate
Implementation: prodshape change validate
Implementation: prodshape citations verify .

  pass  artifact-kinds-valid
  pass  change-open-questions
  pass  citation-current
  pass  citation-tampered-and-stale
  pass  dedicated-topology
  pass  greenfield-first-increment

6 case(s): 6 passed, 0 failed, 0 skipped, 0 errored
```

A pass is only as honest as the run behind it, and the runner does not excuse a surface that was never exercised. Leave the citation command out and the citation case fails instead of passing by silence:

```bash
pdac-conformance run --spec ./spec --command "prodshape validate" --command "prodshape change validate"
```

```text
  fail  citation-tampered-and-stale
    missing:    error PRODUCT062 specs/feature-x.md [target FR-VALIDATE-001]

6 case(s): 5 passed, 1 failed, 0 skipped, 0 errored
```

`PRODUCT062` only ever comes from citation verification, so a command set that cannot emit it does not get credit for it. A runner that hid that would be a badge that certifies nothing.

### Options

| Option             | Meaning                                                                     |
| ------------------ | --------------------------------------------------------------------------- |
| `--spec <path>`    | spec checkout holding `conformance/cases` (env: `PDAC_SPEC`)                |
| `--cases <dir>`    | conformance tests directory, overriding `--spec`                            |
| `--command <argv>` | implementation command, repeatable; `--format json` is appended when absent |
| `--case <name>`    | run only this case, repeatable                                              |
| `--format <fmt>`   | report format: `text` (default) or `json`                                   |
| `--keep`           | keep the fixture working copies for inspection                              |
| `--timeout <ms>`   | per-command timeout                                                         |

Exit codes follow the spec's table: `0` every case passed, `1` a case failed or errored, `2` invalid invocation or no conformance tests to run, `3` unexpected internal failure.

To pin a conformance claim to a spec version, clone the spec at that ref and point `--spec` at it. The report names the revision it read the conformance tests from, so a result is attributable to a spec state rather than to whatever happened to be on disk.

### Verifying the digests the conformance tests pin

The conformance tests pin content digests: a citation ledger or a Markdown marker block records the digest of the artifact it cites. Nothing else recomputes them, so editing a fixture artifact silently invalidates the citation a case describes while the case keeps asserting its expected diagnostics. `digests` recomputes every pin, under the normalization `spec/validation.md` mandates, and needs no implementation at all:

```bash
pdac-conformance digests --spec ./spec
```

```text
Conformance: /work/spec @ 034d1f4, main

4 pinned digest(s) verified across 6 case(s)
```

A pin is expected to match the artifact it cites, except in a case that exists because it does not. A case expecting `PRODUCT061` or `PRODUCT062` for an artifact pins a digest that must differ from that artifact's current content, and this asserts the difference rather than excusing it, so an edit that accidentally makes a tampered fixture faithful is reported instead of quietly voiding the case. The same holds for `PRODUCT060` and `PRODUCT042`. The expectation is read per artifact, never per case: a stale citation against one requirement says nothing about a pin against another.

Resolution is scoped to `docs/product/model`. A Product Change's `proposed/` tree carries artifacts with the same ids as the baseline, and a citation resolves against the accepted definition, so indexing both would let a proposal decide whether a baseline pin still holds.

A pin carrying no id is never excused by an expectation, whatever that expectation names. A citation record with a digest and no target is unverifiable by construction, and reporting it as sound would be the check lying about its own coverage.

Finding no pins at all exits `2`, not `0`. A gate that verified nothing must not read as a gate that passed, and exit `2` already means the command could not do its job.

`--spec`, `--cases`, `--case` and `--format` apply as above. `--command`, `--keep` and `--timeout` do not: there is no implementation to run.

### Provenance in JSON reports

Both commands emit `pdac-conformance/report/v1`. Each report separates `provenance.observed` from `provenance.claimed`: the runner records its installed identity and version, plus the supplied spec checkout's Git revision and dirty state. The caller may record an implementation name, version and artifact identity, and a specification and serialization version using `--implementation-name`, `--implementation-version`, `--implementation-artifact`, `--spec-version` and `--serialization-version`.

Claimed values are labels supplied by the caller. The runner does not verify or infer them, and they are not conformance evidence. This keeps the report useful for release records without imposing an implementation-specific evidence serialization.

### Sound zero-diagnostic cases

For a zero-diagnostic fixture with a valid citation pin, the runner mutates each cited baseline artifact and runs every configured command again. The mutation must produce an attributed `PRODUCT061` or `PRODUCT062`. For a fixture without pins, it mutates every discovered artifact's `type` to an unknown value and requires `PRODUCT003`; where the fixture has a `primary-actor` edge, it also breaks that edge and requires `PRODUCT006` for the missing target. A command that discovers no citation, artifact or graph edge cannot pass by silence. The recorded exercise results are included in the JSON report.

The frozen suite's six zero-diagnostic cases are all protected: the three citation cases use pin mutations; `artifact-kinds-valid` and `configuration-custom-root` use per-artifact type mutations; and `dedicated-topology` also uses a broken graph-edge mutation. A future zero-diagnostic fixture with neither a valid pin nor a typed Product Artifact is reported as unprotected and cannot pass. These checks use ordinary specification diagnostics and do not impose an implementation-specific report envelope.

### More than one command

A single implementation command rarely covers the whole spec. The reference implementation reports baseline diagnostics from `validate`, Product Change overlay diagnostics from `change validate`, and citation diagnostics from `citations verify`, so a run that means to check all three passes all three, exactly as the usage above does. Diagnostics from every command are unioned and deduplicated before the comparison. Each command is still required to emit its own diagnostics in the mandated order.

## What a case must satisfy

Each case is a directory under `conformance/cases/` holding a fixture repository (`repo/`), the diagnostics an implementation must produce and any asserted exit code (`expected.json`), and prose citing the clause under test (`case.md`).

For every case the runner copies `repo/` to a scratch directory, runs each configured command there with `--format json`, and compares. The conformance tests are never written to: an implementation that refreshes generated outputs would otherwise change the fixture it was measured against.

The comparison follows the spec's own rules, from `conformance/README.md`:

- `severity`, `code`, `file`, `artifact`, `change`, `field`, `target`, `line` and `entry` are compared;
- `message` is implementation-defined and is never compared;
- a field absent from an expected diagnostic is not asserted;
- expected and emitted diagnostics are paired maximally, so an expectation naming only a code is satisfied by any emitted diagnostic carrying it, and each emitted diagnostic answers at most one expectation. Whatever is left unpaired is reported: expectations nothing satisfied are **missing**, emitted diagnostics nothing expected are **unexpected**;
- diagnostics must be emitted in the order the spec mandates: `file`, `line`, `entry`, `code`, `field`, `target`, `artifact`, then `change`. Absent numeric locations sort before present ones, numbers sort numerically and strings sort by Unicode code point. Ordering is checked per command.

Diagnostics from multiple commands are deduplicated only when all nine compared fields are equal. `line` and `entry` are numeric and identify, respectively, a one-based payload line and a one-based sidecar citation entry.

An `expected.json` may assert `exitCode` from the specification's `0`-`3` table. The assertion applies independently to every configured implementation command, and a mismatch fails the case without suppressing diagnostic parsing, ordering or maximum matching. When no code is asserted, exit `0` or `1` is a normal validation verdict; exit `2` or `3` makes the case an **error**. Output that is not JSON or a command that hangs is always an error because the run produced no diagnostic verdict.

A case this runner cannot execute is reported as **skipped**, with the reason, and never counted as evidence. Unsupported case versions and missing operation adapters are named skips; supported v2 cases execute their complete invocation, report and tree assertions.

## Scope

This runner supports flat diagnostics/exit-code cases and versioned operation cases with invocation, Git history, semantic reports and working-tree outcomes. The latter require an explicitly configured trusted adapter.

There is no GitHub Action and no badge yet. Conformance tests first, runner second, badge last. When a badge ships it will state exactly what was checked, spec version, conformance level and profile, never a bare "PDaC conformant".

If the organization profile or any page says otherwise, that page is wrong and [we want to know](https://github.com/product-definition-as-code/spec/issues).

## Development

```bash
pnpm install
pnpm test
```

The tests run against a miniature set of test cases and a scripted stand-in implementation under `tests/fixtures/`, so they need neither a spec checkout nor any real implementation installed.

Releases are published from CI only; see [RELEASING.md](RELEASING.md).

## License

Apache-2.0.
