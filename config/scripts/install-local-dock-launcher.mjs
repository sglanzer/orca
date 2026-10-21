import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { createDockLaunchPlan } from './local-fork-dock-launcher.mjs'
import { defaultForkProfile, defaultRecoveryRoot } from './without-openclaw-recovery-providers.mjs'

const marker = 'orca-source-launcher.json'

export function installLocalDockLauncher({
  repoRoot = path.resolve(import.meta.dirname, '../..'),
  nodeExecutable = process.execPath,
  profile = defaultForkProfile(),
  recovery = process.env.ORCA_FORK_RECOVERY_ROOT || defaultRecoveryRoot(profile),
  outputPath = path.join(homedir(), 'Applications', 'Orca Local Launcher.app')
} = {}) {
  if (process.platform !== 'darwin') {
    throw new Error('The Dock launcher is available only on macOS.')
  }
  if (path.extname(outputPath) !== '.app') {
    throw new Error('The Dock launcher destination must end in .app.')
  }
  for (const entry of ['out/main/index.js', 'out/renderer/index.html', 'out/cli/index.js']) {
    if (!existsSync(path.join(repoRoot, entry))) {
      throw new Error(`Build the local fork first: missing ${entry}`)
    }
  }
  if (existsSync(outputPath)) {
    const saved = JSON.parse(
      readFileSync(path.join(outputPath, 'Contents', 'Resources', marker), 'utf8')
    )
    if (
      saved.kind !== 'orca-source-launcher' ||
      saved.repoRoot !== repoRoot ||
      saved.profile !== profile
    ) {
      throw new Error('Refusing to replace a launcher for another repository or profile.')
    }
  }
  const plan = createDockLaunchPlan({ repoRoot, nodeExecutable, profile, recovery })
  const stage = `${outputPath}.installing-${randomUUID()}.app`
  const previous = `${outputPath}.previous-${randomUUID()}`
  mkdirSync(path.dirname(outputPath), { recursive: true })
  try {
    execFileSync('/usr/bin/osacompile', ['-o', stage, '-'], { input: plan.appleScript })
    const resources = path.join(stage, 'Contents', 'Resources')
    copyFileSync(
      path.join(repoRoot, 'resources', 'build', 'icon.icns'),
      path.join(resources, 'applet.icns')
    )
    const plist = path.join(stage, 'Contents', 'Info.plist')
    for (const [key, value] of [
      ['CFBundleIdentifier', 'com.sglanzer.orca.source-launcher'],
      ['CFBundleName', 'Orca Local Launcher'],
      ['CFBundleDisplayName', 'Orca Local Launcher']
    ]) {
      execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, plist])
    }
    writeFileSync(
      path.join(resources, marker),
      `${JSON.stringify(
        {
          kind: 'orca-source-launcher',
          repoRoot,
          nodeExecutable,
          profile,
          recovery
        },
        null,
        2
      )}\n`,
      { mode: 0o600 }
    )
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', stage])
    const hadPrevious = existsSync(outputPath)
    if (hadPrevious) {
      renameSync(outputPath, previous)
    }
    try {
      renameSync(stage, outputPath)
    } catch (error) {
      if (hadPrevious) {
        renameSync(previous, outputPath)
      }
      throw error
    }
    rmSync(previous, { recursive: true, force: true })
    return { outputPath, profile, recovery, logPath: plan.logPath }
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const result = installLocalDockLauncher()
  console.log(`Created ${result.outputPath}`)
  console.log('Drag this launcher from Finder into the Dock. Click it to start the local fork.')
  console.log(
    `Profile: ${result.profile}\nBackups: ${result.recovery}\nLaunch log: ${result.logPath}`
  )
}
