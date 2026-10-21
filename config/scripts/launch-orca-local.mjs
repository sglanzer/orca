import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { prepareDevCliTerminalWrappers } from './dev-cli-terminal-wrapper.mjs'
import { assertPreservedProfile } from './local-fork-profile-guard.mjs'
import { recoverProfileIfNeeded } from './local-fork-recovery.mjs'
import { defaultForkProfile, defaultRecoveryRoot } from './local-fork-recovery-providers.mjs'
import { startRecoveryWatcher } from './local-fork-recovery-launch.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const electron = require('electron')
const { spawnProcess } = require(
  path.join(root, 'out', 'shared', 'child-process', 'run-process.js')
)
for (const entry of ['out/main/index.js', 'out/renderer/index.html', 'out/cli/index.js']) {
  if (!existsSync(path.join(root, entry))) {
    throw new Error(`Build the local fork before launching: missing ${entry}`)
  }
}

const profile = defaultForkProfile()
const recovery = process.env.ORCA_FORK_RECOVERY_ROOT ?? defaultRecoveryRoot(profile)
const restored = await recoverProfileIfNeeded({ profile, recovery })
if (restored.recovered) {
  console.log(
    `[orca-recovery] Restored ${restored.summary.sessions} conversations from ${restored.from}`
  )
}
assertPreservedProfile(profile, path.join(root, '.tmp', 'orca-local-profile.json'))
mkdirSync(profile, { recursive: true })
const wrappers = prepareDevCliTerminalWrappers({
  repoRoot: root,
  userDataPath: profile,
  electronExecutable: electron
})
const env = {
  ...process.env,
  ORCA_DEV_USER_DATA_PATH: profile,
  ORCA_USER_DATA_PATH: profile,
  ORCA_DEV_REPO_ROOT: root,
  ORCA_DEV_INSTANCE_LABEL: 'Local',
  ORCA_DEV_DOCK_TITLE: 'Orca Local',
  PATH: [wrappers.binDir, path.dirname(process.execPath), process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter)
}
delete env.ELECTRON_RUN_AS_NODE

// Keep the parent alive: Orca's development watchdog exits when its launcher disappears.
const child = spawnProcess({
  program: electron,
  args: [root, ...process.argv.slice(2)],
  cwd: root,
  env,
  stdio: 'inherit'
})
child.on('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
try {
  startRecoveryWatcher({ profile, recovery, repoRoot: root, spawnProcess })
} catch (error) {
  console.error(`[orca-recovery] Could not start automatic backups: ${error.message}`)
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
