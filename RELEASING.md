# Releasing

`pdac-lint` is a single unscoped package published to npm as [`pdac-lint`](https://www.npmjs.com/package/pdac-lint). It needs no npm organization: an organization is only required for a scoped name.

Publishing runs in [`.github/workflows/release.yml`](.github/workflows/release.yml) and nowhere else. `package.json` declares `publishConfig.provenance`, and provenance needs the OIDC token only CI has, so `npm publish` from a developer machine fails by design.

## Required repository configuration

**Secret**

- `NPM_TOKEN` - a granular npm access token with write access, exposed to the workflow as `NODE_AUTH_TOKEN`. Used only as a fallback while a trusted publisher is being configured, and ignored once OIDC is in place. npm cannot scope a token to a package that does not exist, so the bootstrap token is necessarily broader than the steady-state one; give it a short expiry and replace it after the first publish.

**Environment**

- `npm-publish` - a protected environment with required reviewers, created under _Settings then Environments_. The release job runs inside it, so reaching npm takes a human approval.

**npm configuration (npmjs.com)**

- Add a Trusted Publisher to the package: GitHub Actions, repo `product-definition-as-code/pdac-lint`, workflow `release.yml`, environment `npm-publish`. npm has no pending-publisher concept, so this can only be done after the package exists.

## First publish (bootstrap)

1. Enable 2FA on the npm account.
2. Create the granular token, add it as `NPM_TOKEN`, create the `npm-publish` environment.
3. Run the workflow with **dry-run** checked. It builds, runs every check and lists what would ship, without publishing.
4. Run it again with dry-run unchecked. The package now exists, published with provenance.
5. Configure the Trusted Publisher on npmjs.com.
6. Downscope the token to the package, or delete it: from here OIDC authenticates the publish.

## Normal release

1. Bump `version` in `package.json` in a pull request, with the changes it covers.
2. Merge it.
3. Run the Release workflow from the Actions tab and approve the `npm-publish` deployment.

The workflow refuses to run if that version is already on the registry or if its tag already exists, because npm versions are immutable and a republish is not a fix. It verifies the publish against the registry afterwards rather than trusting the exit code, and pushes an annotated `vX.Y.Z` tag, verifying that too.

## Rollback

Publish forward. npm versions are immutable, so a bad release is corrected by deprecating it and shipping a fixed version:

```bash
npm deprecate pdac-lint@X.Y.Z "broken release, use X.Y.Z+1"
```

Unpublishing is available only within 72 hours and breaks anyone who already installed the version. Prefer deprecation.
