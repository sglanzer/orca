import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { atomicJson, readJson } from './local-fork-recovery-files.mjs'
import { createRecoverySnapshot, processMayBeAlive } from './local-fork-recovery.mjs'
import { defaultRecoveryRoot } from './local-fork-recovery-providers.mjs'

async function acquireWatchLock(recovery) {
  const lock = path.join(recovery, '.watch-lock')
  await mkdir(recovery, { recursive: true, mode: 0o700 })
  const token = randomUUID()
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await mkdir(lock, { mode: 0o700 })
      await atomicJson(path.join(lock, 'owner.json'), { pid: process.pid, token })
      return async () => {
        const owner = await readJson(path.join(lock, 'owner.json')).catch(() => null)
        if (owner?.token === token) {
          await rm(lock, { recursive: true, force: true })
        }
      }
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error
      }
      const owner = await readJson(path.join(lock, 'owner.json')).catch(() => null)
      if (processMayBeAlive(owner?.pid)) {
        return null
      }
      const info = await stat(lock).catch(() => null)
      if (!owner && info && Date.now() - info.mtimeMs < 10000) {
        return null
      }
      const stale = `${lock}.abandoned-${token}`
      try {
        await rename(lock, stale)
        await rm(stale, { recursive: true })
      } catch (moveError) {
        if (moveError.code !== 'ENOENT') {
          throw moveError
        }
      }
    }
  }
  throw new Error('Could not acquire the recovery watcher lock')
}

export async function runRecoveryWatch({
  profile,
  recovery,
  intervalMs = 300000,
  pollMs = 10000,
  shutdownGraceMs = 30000,
  snapshot = createRecoverySnapshot
}) {
  const release = await acquireWatchLock(recovery)
  if (!release) {
    return { alreadyRunning: true }
  }
  let stopped = false
  const stop = () => {
    stopped = true
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  let lastSnapshot = 0
  let inactiveSince = null
  const save = async () => {
    try {
      await snapshot({ profile, recovery })
      lastSnapshot = Date.now()
      await rm(path.join(recovery, 'backup-error.json'), { force: true })
    } catch (error) {
      await atomicJson(path.join(recovery, 'backup-error.json'), {
        time: Date.now(),
        message: error.message
      })
      console.error('[orca-recovery]', error.message)
    }
  }
  try {
    while (!stopped) {
      const runtime = await readJson(path.join(profile, 'orca-runtime.json')).catch(() => null)
      const live = processMayBeAlive(runtime?.pid)
      inactiveSince = live ? null : (inactiveSince ?? Date.now())
      if (Date.now() - lastSnapshot >= intervalMs) {
        await save()
      }
      if (inactiveSince !== null && Date.now() - inactiveSince >= shutdownGraceMs) {
        break
      }
      await delay(pollMs)
    }
    await save()
    return { alreadyRunning: false }
  } finally {
    process.off('SIGTERM', stop)
    process.off('SIGINT', stop)
    await release()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2)
  const profile = args[args.indexOf('--profile') + 1]
  if (!args.includes('--profile') || !profile) {
    throw new Error('--profile is required')
  }
  const recovery = args.includes('--recovery')
    ? args[args.indexOf('--recovery') + 1]
    : defaultRecoveryRoot(profile)
  process.umask(0o077)
  await mkdir(recovery, { recursive: true, mode: 0o700 })
  const log = await open(path.join(recovery, 'watch.log'), 'a', 0o600)
  try {
    if (args.includes('--once')) {
      const result = await createRecoverySnapshot({ profile, recovery })
      console.log(JSON.stringify({ directory: result.directory, summary: result.manifest.summary }))
    } else {
      const result = await runRecoveryWatch({ profile, recovery })
      await log.appendFile(`${JSON.stringify({ finishedAt: Date.now(), ...result })}\n`)
    }
  } finally {
    await log.close()
  }
}
