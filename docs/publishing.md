# Publishing

rig publishes only after an explicit human gate. Do not publish npm packages, push release tags, create GitHub Releases, dispatch publish workflows, or flip repository visibility from a local machine without an intentional release decision.

## Public Promise

rig is experimental. It is useful for local system-configuration workflows, but the CLI behavior, configuration schema, install-source set, TUI behavior, package surface, and release channels may change while the project is in `0.y.z`.

## Package And Release Map

| Artifact           | Status            | Channel                                              |
| ------------------ | ----------------- | ---------------------------------------------------- |
| `@skastr0/rig`     | prepared, blocked | npm Bun-native CLI package                           |
| `rig-darwin-arm64` | prepared, blocked | GitHub Release binary                                |
| `rig-darwin-x64`   | prepared, blocked | GitHub Release binary                                |
| `rig-linux-arm64`  | prepared, blocked | GitHub Release binary                                |
| `rig-linux-x64`    | prepared, blocked | GitHub Release binary                                |
| Homebrew formula   | deferred          | after the first GitHub Release asset shape is stable |

The npm package is intentionally Bun-native. Its executable entrypoint uses the repository's `#!/usr/bin/env bun` TypeScript source entrypoint, and the package declares `engines.bun`.

## Hold-Back Blockers

Do not make the repository public or publish artifacts until these are complete:

- clean or replace `system-config.json`; it is a private operator configuration and is not safe as-is for public repository visibility
- re-run local validation and package dry-runs after `system-config.json` cleanup
- run and manually review the latest `publish-scan` output directory
- confirm source, docs, examples, and history are safe to publish
- enable GitHub secret scanning, push protection, dependency graph, Dependabot alerts, and private vulnerability reporting
- update the GitHub repository description and topics
- configure npm trusted publishing for `@skastr0/rig` against `npm-publish.yml`
- create and protect the GitHub `release` environment with maintainer approval and release-tag restrictions
- configure main-branch protection or a ruleset once repository visibility and the GitHub plan allow it

## Local Preflight

```bash
bun install --frozen-lockfile
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

Before dispatching `.github/workflows/npm-publish.yml`, configure npm trusted publishing for `@skastr0/rig`.

Use repository `skastr0/rig`, workflow filename `npm-publish.yml`, and environment name `release`. npm asks for the filename only, not the full `.github/workflows/` path. Keep the GitHub `release` environment protected for the first public release.

Trusted publishing requires a GitHub-hosted runner, `permissions.id-token: write`, Node `22.14.0` or newer, and npm `11.5.1` or newer. npm generates provenance automatically for public packages published from public repositories through trusted publishing.

## GitHub Release Setup

Before dispatching `.github/workflows/release-binaries.yml`:

- confirm `system-config.json` has been cleaned or replaced
- confirm the release tag exists and points at the reviewed commit
- confirm `CHANGELOG.md` has the intended release notes
- confirm the GitHub `release` environment requires approval
- inspect `dist/rig-*` and `dist/SHA256SUMS` before publishing a draft release

The workflow builds `darwin-x64`, `darwin-arm64`, `linux-x64`, and `linux-arm64` standalone binaries and creates a draft GitHub Release with `SHA256SUMS`.

## Release Order

1. Clean `system-config.json` and any private history before public visibility.
2. Run `bun run release:check` and inspect the npm dry-run package contents.
3. Configure GitHub repository security settings and the protected `release` environment.
4. Configure npm trusted publishing for `@skastr0/rig`.
5. Make the repository public only after public files and security settings are ready.
6. Push the reviewed release tag or manually dispatch the release workflows after confirmation.
7. Verify the npm package, provenance, GitHub Release assets, checksums, and install instructions.
8. Add Homebrew tap/formula work only after the first release asset shape is stable.

## Rollback Notes

npm versions should be treated as permanent. Prefer publishing a fixed version or deprecating a bad version over relying on unpublish. GitHub Release assets can be replaced, but users may already have downloaded them.
