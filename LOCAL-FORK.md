# Orca without OpenClaw

This fork is based on upstream `v1.4.224`. It removes OpenClaw session discovery
on local, WSL, and SSH hosts, its state-directory environment forwarding, its
automation-file readers and commands, and its agent picker and detection entries.
Persisted agent identifiers and transcript parsers remain readable for compatibility.
Other agents and Hermes automations remain supported.

Cisco Secure Endpoint quarantined several upstream JavaScript files under the
`OpenClaw.Tool.OpenclawStateDir.UNOFFICIAL` detection. This fork removes the
integration's behavior. It does not change endpoint protection or configure exclusions.

## Build and run locally

Use Node 24 and the repository's locked dependencies:

```sh
pnpm install --frozen-lockfile
pnpm run build:cli
pnpm run build:relay
pnpm run build:electron-vite
node config/scripts/launch-without-openclaw.mjs
```

The launcher runs the development app from the built files, with no development
server required. Its separate profile is named `orca-without-openclaw` under the
platform's application-data directory. The original Orca profile is preserved.
Set `ORCA_DEV_USER_DATA_PATH` to select a different profile. Accounts may need
to be connected in this profile. Development builds do not auto-update to upstream.

For automation, set `ORCA_BACKGROUND_LAUNCH=1` to keep windows hidden.

## Verification

Type checking, lint on changed files, and the session-history and automation
regression suites pass (1,971 tests, one skipped). Main and relay build outputs
contain no OpenClaw state-directory environment or filesystem lookup literals.
The synthetic merged-root test fixture preserves generic search-index coverage
without restoring OpenClaw discovery in the application.
