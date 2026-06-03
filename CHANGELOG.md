# Changelog

All notable changes to rig will be documented in this file.

The project follows Semantic Versioning for the declared public CLI and package surfaces. While rig is in `0.y.z`, command behavior and configuration contracts may still change, but user-visible breaking changes should be called out here.

## [Unreleased]

### Added

- Public package metadata for the experimental `@skastr0/rig` CLI package.
- Node launcher and npm platform packages for `npx`, `bunx`, and `pnpm dlx` support.
- Public repository files for license, security reporting, contributing, support, and publishing gates.
- CI workflow for install, validation, tests, and build.
- Gated release workflows for npm publishing and draft binary releases.

### Changed

- Replaced the tracked default `system-config.json` with a public-safe sample configuration.
- Switched the first npm package plan from a Bun-only source entrypoint to a launcher plus prebuilt platform binaries.
- Sanitized server-profile documentation examples so they remain copyable without exposing private operator setup.
- Tightened the npm package file allowlist by removing non-runtime visual assets.
- Release validation now has a `release:check` script covering verification, npm dry-run packing, dependency audit, and publish scan.

## [0.1.0] - 2026-05-29

### Added

- Experimental rig CLI for declarative, idempotent macOS/Linux system configuration.
- Interactive TUI and headless `--ci --profile` execution modes.
- Local, HTTPS, and GitHub shorthand configuration sources with remote review-first behavior.
- Structured install sources for Homebrew, Git clones, directories, symlinks, skills, and scripts.
- Validation, tests, and multi-platform binary build scripts.
