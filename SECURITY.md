# Security Policy

## Supported Status

rig is experimental and solo-maintained. Security reports are reviewed on a best-effort basis, without a formal response SLA.

## Reporting A Vulnerability

Please do not open a public issue for suspected vulnerabilities. Report privately through GitHub private vulnerability reporting for this repository. If that is not enabled, repository visibility is not ready for public release; open only a minimal public issue asking for a private reporting path, without vulnerability details.

Include:

- affected version or commit
- reproduction steps
- impact
- relevant logs or proof of concept

## Scope

The CLI, configuration parser, remote configuration loading, GitHub shorthand resolution, integrity verification, installation preview/apply behavior, backup handling, release binaries, and npm package installation path are in scope.

User-authored configuration files, commands executed by a user's own configuration, third-party package managers, local machine policy, and private system setup data are out of scope unless rig directly mishandles them.
