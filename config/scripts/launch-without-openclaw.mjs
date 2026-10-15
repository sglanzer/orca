import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import { prepareDevCliTerminalWrappers } from './dev-cli-terminal-wrapper.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const electron = require('electron')
for (const entry of ['out/main/index.js', 'out/renderer/index.html', 'out/cli/index.js']) {
  if (!existsSync(path.join(root, entry))) {
    throw new Error(`Build the local fork before launching: missing ${entry}`)
  }
}

const profile =
  process.env.ORCA_DEV_USER_DATA_PATH ??
  (process.platform === 'darwin'
    ? path.join(homedir(), 'Library', 'Application Support', 'orca-without-openclaw')
    : process.platform === 'win32'
      ? path.join(
          process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'),
          'orca-without-openclaw'
        )
      : path.join(
          process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'),
          'orca-without-openclaw'
        ))
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
  ORCA_DEV_INSTANCE_LABEL: 'Without OpenClaw',
  ORCA_DEV_DOCK_TITLE: 'Orca without OpenClaw',
  PATH: [wrappers.binDir, path.dirname(process.execPath), process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter)
}
delete env.ELECTRON_RUN_AS_NODE

// Keep the parent alive: Orca's development watchdog exits when its launcher disappears.
const child = spawn(electron, [root, ...process.argv.slice(2)], {
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
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
