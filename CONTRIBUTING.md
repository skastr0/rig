# Contributing

rig is an experimental, solo-maintained project. The most useful outside help is clear evidence: reproducible bugs, documentation corrections, and scoped proposals that explain the maintenance cost.

## What Helps

- Reproducible bug reports
- Documentation corrections
- Small fixes tied to an accepted issue, with tests or clear verification notes
- Scoped proposals before implementation work starts

## What Is Out Of Scope

- Large rewrites without prior discussion
- Broad feature work that changes the maintenance burden substantially
- Public security reports; use the private reporting path in SECURITY.md

## Local Workflow

Install dependencies with Bun, then run the same validation gates used by CI:

```bash
bun install --frozen-lockfile --cpu='*' --os='*'
bun run validate
bun run test
bun run build
```

Before sending a code change for review, include the relevant verification commands and results.

## Code Changes

External code changes are not the default support path. Small changes connected to a confirmed issue may be reviewed, but they can still be declined for scope, maintenance cost, compatibility risk, or product direction even when the implementation is technically sound.

By contributing, you agree that your contribution is licensed under the MIT license used by this project.
