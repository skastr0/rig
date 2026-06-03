# Publishing

rig publishes only after an explicit human gate. Do not publish npm packages, push release tags, create GitHub Releases, dispatch publish workflows, or flip repository visibility from a local machine without an intentional release decision.

## Public Promise

rig is experimental. It is useful for local system-configuration workflows, but the CLI behavior, configuration schema, install-source set, TUI behavior, package surface, and release channels may change while the project is in `0.y.z`.

## Package And Release Map

| Artifact                    | Status    | Channel                                              |
| --------------------------- | --------- | ---------------------------------------------------- |
| `@skastr0/rig`              | published | npm wrapper package with Node launcher               |
| `@skastr0/rig-darwin-arm64` | published | npm platform binary package                          |
| `@skastr0/rig-darwin-x64`   | published | npm platform binary package                          |
| `@skastr0/rig-linux-arm64`  | published | npm platform binary package                          |
| `@skastr0/rig-linux-x64`    | published | npm platform binary package                          |
| `rig-darwin-arm64`          | tag-ready | GitHub Release binary                                |
| `rig-darwin-x64`            | tag-ready | GitHub Release binary                                |
| `rig-linux-arm64`           | tag-ready | GitHub Release binary                                |
| `rig-linux-x64`             | tag-ready | GitHub Release binary                                |
| Homebrew formula            | deferred  | after the first GitHub Release asset shape is stable |

The npm package supports `npx`, `bunx`, and `pnpm dlx` by publishing `@skastr0/rig` as a small Node launcher with exact optional dependencies on the four platform packages. The platform packages contain the Bun-compiled standalone binaries. GitHub Releases remain the direct-download binary lane, and Homebrew remains deferred until the first release asset shape is stable.

`0.1.0` was bootstrapped from the local npm CLI after explicit maintainer approval so npm package names could be claimed and trusted publishing could be configured. Future npm publishes should run through `.github/workflows/npm-publish.yml` with npm trusted publishing and the protected `release` environment.

## Hold-Back Blockers

Before publishing a new public artifact, confirm these are complete:

- keep the current tracked `system-config.json` public-safe; historical private config in existing commits is an accepted risk for this repository
- remove any local `release.md`; it is a temporary coordination file and must not be present before release validation is cleared
- re-run local validation and package dry-runs after public-surface changes
- run and manually review the latest `publish-scan` output directory
- confirm current source, docs, and examples are safe to publish, with original git history accepted for rig
- enable GitHub secret scanning, push protection, dependency graph, Dependabot alerts, and private vulnerability reporting where supported by the repository plan
- update the GitHub repository description and topics
- configure npm trusted publishing for `@skastr0/rig` and all four `@skastr0/rig-*` platform packages against `npm-publish.yml`
- create and protect the GitHub `release` environment with maintainer approval and release-tag restrictions
- configure main-branch protection or a ruleset once repository visibility and the GitHub plan allow it

## Local Preflight

```bash
bun install --frozen-lockfile --cpu='*' --os='*'
bun run validate
bun run test
bun run build
bun run pack:dry-run
bun audit
publish-scan .
```

Or use the combined gate:

```bash
bun run release:check
```

`publish-scan` output is private evidence and may include sensitive snippets. Review the output directory locally; do not paste raw scan output into public issues or release notes.

## npm Trusted Publishing Setup

Before dispatching `.github/workflows/npm-publish.yml` for a new version, confirm npm trusted publishing is configured for each npm package:

- `@skastr0/rig`
- `@skastr0/rig-darwin-arm64`
- `@skastr0/rig-darwin-x64`
- `@skastr0/rig-linux-arm64`
- `@skastr0/rig-linux-x64`

Use repository `skastr0/rig`, workflow filename `npm-publish.yml`, and environment name `release`. npm asks for the filename only, not the full `.github/workflows/` path. Keep the GitHub `release` environment protected for the first public release.

Trusted publishing requires a GitHub-hosted runner, `permissions.id-token: write`, Node `22.14.0` or newer, and npm `11.5.1` or newer. npm generates provenance automatically for public packages published from public repositories through trusted publishing.

The npm workflow publishes platform packages first, then the `@skastr0/rig` wrapper package. It skips package versions that already exist so a rerun can resume a partially successful first release.

```bash
for package in \
  @skastr0/rig-darwin-arm64 \
  @skastr0/rig-darwin-x64 \
  @skastr0/rig-linux-arm64 \
  @skastr0/rig-linux-x64 \
  @skastr0/rig
do
  npm trust github "$package" \
    --repo skastr0/rig \
    --file npm-publish.yml \
    --env release \
    --allow-publish \
    --yes

  npm trust list "$package"
done
```

## GitHub Release Setup

Before dispatching `.github/workflows/release-binaries.yml`:

- confirm the current tracked `system-config.json` is still public-safe
- confirm the release tag exists and points at the reviewed commit
- confirm `CHANGELOG.md` has the intended release notes
- confirm the GitHub `release` environment requires approval
- inspect `dist/rig-*` and `dist/SHA256SUMS` before publishing a draft release

The workflow builds `darwin-x64`, `darwin-arm64`, `linux-x64`, and `linux-arm64` standalone binaries and creates a draft GitHub Release with `SHA256SUMS`.

## Release Order

`0.1.0` npm packages are already live. For the remaining `0.1.0` GitHub Release binary lane, push `v0.1.0`, approve the protected release workflows, inspect the draft release assets and checksums, then publish the draft release.

1. Confirm the current tracked `system-config.json` is public-safe; existing private history is accepted for rig.
2. Run `bun run release:check` and inspect the npm dry-run package contents.
3. Configure GitHub repository security settings and the protected `release` environment.
4. Configure npm trusted publishing for all five npm packages.
5. Make the repository public only after public files and security settings are ready.
6. Push the reviewed release tag or manually dispatch the release workflows after confirmation.
7. Verify the npm package, provenance, GitHub Release assets, checksums, and install instructions.
8. Add Homebrew tap/formula work only after the first release asset shape is stable.

## Rollback Notes

npm versions should be treated as permanent. Prefer publishing a fixed version or deprecating a bad version over relying on unpublish. GitHub Release assets can be replaced, but users may already have downloaded them.
