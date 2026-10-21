import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { createDockLaunchPlan } from './local-fork-dock-launcher.mjs'
import { installLocalDockLauncher } from './install-local-dock-launcher.mjs'
import { defaultForkProfile, defaultRecoveryRoot } from './local-fork-recovery-providers.mjs'

const run = promisify(execFile)

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'orca-dock-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const repoRoot = path.join(root, 'code \' " $HOME `whoami` orca')
  const profile = path.join(root, "saved ' $HOME profile")
  const recovery = path.join(root, "backup ' $HOME recovery")
  return { root, repoRoot, profile, recovery }
}

test('Dock starts the source supervisor with the saved profile even with shell metacharacters', async (t) => {
  const f = await fixture(t)
  const scripts = path.join(f.repoRoot, 'config', 'scripts')
  await mkdir(scripts, { recursive: true })
  await writeFile(
    path.join(scripts, 'launch-orca-local.mjs'),
    `
    import { writeFileSync } from 'node:fs'
    writeFileSync(process.env.ORCA_DEV_USER_DATA_PATH + '/launched.json', JSON.stringify({
      profile: process.env.ORCA_DEV_USER_DATA_PATH,
      recovery: process.env.ORCA_FORK_RECOVERY_ROOT,
      electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE,
      entry: process.argv[1]
    }))
  `
  )
  const plan = createDockLaunchPlan({ ...f, nodeExecutable: process.execPath })
  const executable = process.platform === 'darwin' ? '/usr/bin/osascript' : '/bin/sh'
  const args = process.platform === 'darwin' ? ['-e', plan.appleScript] : ['-c', plan.command]
  await run(executable, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  let launched
  for (let i = 0; i < 100; i++) {
    launched = await readFile(path.join(f.profile, 'launched.json'), 'utf8').catch(() => null)
    if (launched) {
      break
    }
    await delay(20)
  }
  assert.deepEqual(JSON.parse(launched), {
    profile: f.profile,
    recovery: f.recovery,
    entry: path.join(scripts, 'launch-orca-local.mjs')
  })
})

test('the stable default profile is independent of checkout location and supports explicit overrides', () => {
  const home = path.join(tmpdir(), 'colleague')
  const expected = path.join(home, 'Library', 'Application Support', 'orca-local')
  assert.equal(defaultForkProfile({}, home, 'darwin'), expected)
  assert.equal(defaultForkProfile({ ORCA_DEV_USER_DATA_PATH: expected }, home, 'darwin'), expected)
  assert.equal(
    defaultRecoveryRoot(expected).endsWith(path.join('Orca Recovery', 'orca-local')),
    true
  )
  assert.equal(defaultForkProfile({ APPDATA: home }, home, 'win32'), path.join(home, 'orca-local'))
  assert.equal(
    defaultForkProfile({ XDG_CONFIG_HOME: home }, home, 'linux'),
    path.join(home, 'orca-local')
  )
})

test(
  'a generated Dock app compiles, verifies, and can be refreshed without touching saved data',
  {
    skip: process.platform !== 'darwin'
  },
  async (t) => {
    const f = await fixture(t)
    for (const entry of ['out/main/index.js', 'out/renderer/index.html', 'out/cli/index.js']) {
      const file = path.join(f.repoRoot, entry)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, '')
    }
    const icon = path.join(f.repoRoot, 'resources', 'build', 'icon.icns')
    await mkdir(path.dirname(icon), { recursive: true })
    await copyFile(path.resolve('resources/build/icon.icns'), icon)
    await mkdir(f.profile, { recursive: true })
    const saved = path.join(f.profile, 'settings.json')
    await writeFile(saved, '{"theme":"dark"}')
    const outputPath = path.join(f.root, 'Orca Local Launcher.app')
    const options = { ...f, outputPath, nodeExecutable: process.execPath }
    installLocalDockLauncher(options)
    const source = await run('/usr/bin/osadecompile', [outputPath])
    assert.equal(source.stdout.trim(), createDockLaunchPlan(options).appleScript.trim())
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', outputPath])
    installLocalDockLauncher(options)
    assert.equal(await readFile(saved, 'utf8'), '{"theme":"dark"}')
    assert.throws(
      () => installLocalDockLauncher({ ...options, profile: path.join(f.root, 'other') }),
      /another repository or profile/
    )
  }
)

test('the installer refuses an unfinished build before creating the app', async (t) => {
  const f = await fixture(t)
  if (process.platform === 'darwin') {
    assert.throws(
      () => installLocalDockLauncher({ ...f, outputPath: path.join(f.root, 'Orca.app') }),
      /Build the local fork first/
    )
  } else {
    assert.throws(() => installLocalDockLauncher(f), /only on macOS/)
  }
})
