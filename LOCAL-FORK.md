# Orca Local

This fork is based on upstream `v1.4.224`. It removes OpenClaw session discovery
on local, WSL, and SSH hosts, its state-directory environment forwarding, its
automation-file readers and commands, and its agent picker and detection entries.
Persisted agent identifiers and transcript parsers remain readable for compatibility.
Other agents and Hermes automations remain supported.

Cisco Secure Endpoint quarantined several upstream JavaScript files under the
`OpenClaw.Tool.OpenclawStateDir.UNOFFICIAL` detection. This fork removes the
integration's behavior. It does not change endpoint protection or configure exclusions.

## Build and run locally

Use Node 24, pnpm, and the platform's native build tools (Xcode Command Line
Tools on macOS). Clone the branch containing this fork and use its locked dependencies:

```sh
git clone --single-branch --branch orca-local \
  https://github.com/sglanzer/orca.git orca-local
cd orca-local
pnpm install --frozen-lockfile
pnpm run build:cli
pnpm run build:relay
pnpm run build:electron-vite
node config/scripts/launch-orca-local.mjs
```

The launcher runs the development app from the built files, with no development
server required. Its separate profile is named `orca-local` under the
platform's application-data directory. The original Orca profile is preserved.
Set `ORCA_DEV_USER_DATA_PATH` to select a different profile. Accounts may need
to be connected in this profile. Development builds do not auto-update to upstream.

For automation, set `ORCA_BACKGROUND_LAUNCH=1` to keep windows hidden.

## Keep a launcher in the macOS Dock

After building, run this once from the checkout:

```sh
node config/scripts/install-local-dock-launcher.mjs
```

This creates `~/Applications/Orca Local Launcher.app`. Drag that file from Finder
into the Dock. Clicking it starts the built fork with the same profile and recovery
watcher as the terminal command; no terminal window needs to remain open. The launcher
keeps the Node supervisor alive while Orca runs.

Pin the generated launcher: the development app's stock Electron Dock icon does not
remember the source checkout or launch arguments. The running app may have a separate
Dock icon.

Keep the checkout in a permanent location. If you move it or replace the Node executable,
rerun the installer from that checkout using Node 24. It refreshes only its own launcher
and preserves the selected profile. If using `ORCA_DEV_USER_DATA_PATH` or
`ORCA_FORK_RECOVERY_ROOT`, set those variables when installing the launcher; it remembers
their values. Launch errors are written to `logs/source-launcher.log` inside the profile.

## Settings, conversations, and recovery

On macOS, the default profile is `~/Library/Application Support/orca-local`.
It is outside the checkout, so restarting, pulling source changes, rebuilding, and
refreshing the Dock launcher keep the same saved settings and conversations. The
profile location remains stable across versions. A different profile override selects
a separate set of data. Existing upstream Orca data is not imported automatically.

The launcher also starts the automatic recovery helper used by this local fork. It
takes verified snapshots of settings, workspace state, conversation journals, and
supported local provider transcripts every five minutes while Orca runs, plus a final
snapshot after it exits. The helper retries an early snapshot if startup has not yet
created the profile databases. Backups live outside the profile, by default at
`~/Documents/Codex/Orca Recovery/orca-local` on macOS. It retains the latest
12 snapshots and recovery points for up to seven distinct days.

Before launch, missing or corrupt profile data is restored from the newest verified
snapshot, falling back to an older valid one when needed. It refuses recovery over a
running instance and preserves damaged data when no snapshot verifies. Backups can
contain sensitive local account state and transcripts; keep them private. These local
copies do not protect against loss of the whole disk.

To update the source build, quit Orca and run from the same checkout:

```sh
git pull --ff-only
pnpm install --frozen-lockfile
pnpm run build:cli
pnpm run build:relay
pnpm run build:electron-vite
```

Then reopen it from the Dock launcher or the usual terminal launch command.

## Verification

Type checking, lint on changed files, and the session-history and automation
regression suites pass (1,971 tests, one skipped). Main and relay build outputs
contain no OpenClaw state-directory environment or filesystem lookup literals.
The synthetic merged-root test fixture preserves generic search-index coverage
without restoring OpenClaw discovery in the application.

The launcher and recovery checks run without opening an Orca window:

```sh
ORCA_BACKGROUND_LAUNCH=1 node --test \
  config/scripts/local-fork-dock-launcher.test.mjs \
  config/scripts/local-fork-profile-guard.test.mjs \
  config/scripts/local-fork-recovery-files.test.mjs \
  config/scripts/local-fork-recovery.test.mjs
```
