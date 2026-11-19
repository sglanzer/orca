# Orca Local

This fork is based on upstream `v1.4.264`. It removes OpenClaw session discovery
on local, WSL, and SSH hosts, its state-directory environment forwarding, its
automation-file readers and commands, and its agent picker and detection entries.
Persisted agent identifiers and transcript parsers remain readable for compatibility.
Other agents remain supported. External automation managers are disabled; upstream no longer provides the Hermes automation manager.

Cisco Secure Endpoint quarantined several upstream JavaScript files under the
`OpenClaw.Tool.OpenclawStateDir.UNOFFICIAL` detection. This fork removes the
integration's behavior. It does not change endpoint protection or configure exclusions.

## Build and run locally

Use Node 24 and the repository's locked dependencies:

```sh
pnpm install --frozen-lockfile
pnpm run build:cli
pnpm run build:wsl-guest
pnpm run build:electron-vite
node config/scripts/launch-orca-local.mjs
```

The launcher runs the development app from the built files, with no development
server required. Its separate profile is named `orca-local` under the
platform's application-data directory. The original Orca profile is preserved.
Set `ORCA_DEV_USER_DATA_PATH` to select a different profile. Accounts may need
to be connected in this profile. Development builds do not auto-update to upstream.

For automation, set `ORCA_BACKGROUND_LAUNCH=1` to keep windows hidden.

## Updating this fork

The local fork is on upstream v1.4.264, including Cursor and GitHub Copilot structured chat. Development builds require a manual source update and rebuild.

Keep the disabled scanner source, agent picker/detection exclusions, external-automation discovery/action guards, and profile recovery launcher when updating. Existing saved agent identifiers and transcript parsers remain readable.

Use the Node 24 runtime and the pnpm version pinned in package.json. The profile recovery code takes SQLite backups and preserves saved conversations before a build switch. Keep profile backups outside the live profile.

## Verification

Run the scanner, session search, agent selection, automation, native-chat sleep and sidebar visibility regression suites; typecheck and build the main, renderer, CLI and WSL guest outputs. Verify built outputs contain no OpenClaw state-directory environment or filesystem lookup literals.
