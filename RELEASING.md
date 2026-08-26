# Releasing

The canonical package is [`pdac-conformance`](https://www.npmjs.com/package/pdac-conformance). Its canonical repository is `product-definition-as-code/pdac-conformance`. Repository rename, npm publication and npm deprecation are human-gated external actions and are not performed by this repository checkout.

## Transition release

Release exactly one `pdac-lint` transition package alongside the first `pdac-conformance` release. It depends on the matching canonical version, its `pdac-lint` command writes `pdac-lint is deprecated; use pdac-conformance.`, then forwards all arguments to the new binary. No further feature or compatibility releases are planned for `pdac-lint`.

The required publication sequence is:

1. Rename the GitHub repository to `product-definition-as-code/pdac-conformance`, then verify the redirect from the former repository URL.
2. Configure the protected `npm-publish` environment and a short-lived `NPM_TOKEN` that can bootstrap both packages. npm cannot configure a Trusted Publisher for a package that does not exist.
3. Run the release workflow in dry-run mode. It must pass type checking, linting, formatting, unit tests, command checks and both package-content checks.
4. Publish `pdac-conformance@1.0.0` from CI with provenance and verify the registry package and tarball.
5. Publish the matching `pdac-lint@1.0.0` transition package from the same CI release, then install it in a clean directory and verify that `pdac-lint --help` warns and forwards.
6. Configure the npm Trusted Publisher for both packages against the renamed repository's `release.yml` workflow and protected `npm-publish` environment. Downscope or remove the bootstrap token.
7. Deprecate all earlier `pdac-lint` versions with `npm deprecate pdac-lint@'<1.0.0' "renamed to pdac-conformance; install pdac-conformance"`.
8. After the stated transition window, deprecate `pdac-lint@1.0.0` with `npm deprecate pdac-lint@1.0.0 "transition complete; install pdac-conformance"`. Do not publish a replacement compatibility version.

## Release controls

Publishing runs only in [`.github/workflows/release.yml`](.github/workflows/release.yml). The protected `npm-publish` environment requires human approval. npm versions are immutable, so a defect is corrected by publishing forward rather than replacing a tarball.

Before publication, check that both package names and target versions remain available. After publication, verify each package from a clean temporary installation and record its tarball digest and npm URL in the release handoff.
