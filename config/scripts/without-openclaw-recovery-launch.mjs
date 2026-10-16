import { appendFileSync, closeSync, mkdirSync, openSync } from 'node:fs'
import path from 'node:path'

export function startRecoveryWatcher({ profile, recovery, repoRoot, spawnProcess }) {
  mkdirSync(recovery, { recursive: true, mode: 0o700 })
  const logPath = path.join(recovery, 'watch.log')
  const log = openSync(logPath, 'a', 0o600)
  try {
    const watcher = spawnProcess({
      program: process.execPath,
      args: [
        path.join(repoRoot, 'config', 'scripts', 'without-openclaw-recovery-watch.mjs'),
        '--profile',
        profile,
        '--recovery',
        recovery
      ],
      cwd: repoRoot,
      env: { ...process.env },
      detached: true,
      stdio: ['ignore', log, log]
    })
    watcher.on('error', (error) => appendFileSync(logPath, `[orca-recovery] ${error.message}\n`))
    watcher.unref()
    return watcher.pid
  } finally {
    closeSync(log)
  }
}
