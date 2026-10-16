import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import {
  atomicJson,
  fileDigest,
  inspectProfile,
  PROFILE_ENTRIES,
  readJson,
  snapshotFile,
  syncDirectory,
  walkFiles,
  within
} from './without-openclaw-recovery-files.mjs'
import { providerFiles } from './without-openclaw-recovery-providers.mjs'

const exists = (file) =>
  access(file).then(
    () => true,
    () => false
  )

export async function generations(recovery) {
  const entries = await readdir(recovery, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  })
  const result = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('generation-')) {
      continue
    }
    const directory = path.join(recovery, entry.name)
    try {
      result.push({ directory, manifest: await readJson(path.join(directory, 'manifest.json')) })
    } catch {
      /* An interrupted generation is never a recovery candidate. */
    }
  }
  return result.sort((a, b) => b.manifest.createdAt - a.manifest.createdAt)
}

async function profileFiles(profile) {
  const files = []
  for (const entry of PROFILE_ENTRIES) {
    const source = path.join(profile, entry)
    const info = await stat(source).catch(() => null)
    if (!info) {
      continue
    }
    const relatives = info.isDirectory() ? walkFiles(profile, entry) : [entry]
    for await (const relative of relatives) {
      if (/\.db\.backup\.|-(wal|shm|journal)$/.test(relative)) {
        continue
      }
      files.push({ source: path.join(profile, relative), relative: path.join('profile', relative) })
    }
  }
  return files
}

export async function validateGeneration(generation, profile) {
  const { directory, manifest } = generation
  if (
    manifest.schemaVersion !== 1 ||
    path.resolve(manifest.profilePath) !== path.resolve(profile)
  ) {
    throw new Error('Recovery generation belongs to a different profile')
  }
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const file = within(directory, relative)
    if ((await stat(file)).size !== expected.size || (await fileDigest(file)) !== expected.sha256) {
      throw new Error(`Recovery file failed verification: ${relative}`)
    }
  }
  const summary = inspectProfile(path.join(directory, 'profile'))
  if (JSON.stringify(summary) !== JSON.stringify(manifest.summary)) {
    throw new Error('Recovery database counts do not match the manifest')
  }
  return summary
}

export function retainedGenerations(items, recent = 12, daily = 7) {
  const retained = new Set(items.slice(0, recent).map((g) => g.directory))
  const days = new Set()
  for (const item of items) {
    const day = new Date(item.manifest.createdAt).toISOString().slice(0, 10)
    if (!days.has(day) && days.size < daily) {
      days.add(day)
      retained.add(item.directory)
    }
  }
  return retained
}

function assertNotEmptyReplacement(summary, previous) {
  if (previous?.sessions > 0 && summary.sessions === 0) {
    throw new Error('Refusing to replace saved conversations with an empty profile')
  }
  for (const [id, count] of Object.entries(previous?.documents ?? {})) {
    if (count > 0 && summary.documents[id] === 0) {
      throw new Error(`Saved settings were replaced by an empty profile: ${id}`)
    }
  }
}

export async function createRecoverySnapshot({
  profile,
  recovery,
  home = homedir(),
  now = Date.now()
}) {
  if (
    path.resolve(recovery) === path.resolve(profile) ||
    path.resolve(recovery).startsWith(`${path.resolve(profile)}${path.sep}`)
  ) {
    throw new Error('Recovery copies must be outside the live profile')
  }
  const summary = inspectProfile(profile)
  await mkdir(recovery, { recursive: true, mode: 0o700 })
  const previous = (await generations(recovery))[0]
  if (previous && path.resolve(previous.manifest.profilePath) !== path.resolve(profile)) {
    throw new Error('Recovery directory belongs to a different profile')
  }
  assertNotEmptyReplacement(summary, previous?.manifest.summary)
  const id = `${now}-${randomUUID()}`
  const stage = path.join(recovery, `.staging-${id}`)
  const directory = path.join(recovery, `generation-${id}`)
  await mkdir(stage, { mode: 0o700 })
  try {
    const manifest = {
      schemaVersion: 1,
      profilePath: path.resolve(profile),
      createdAt: now,
      files: {},
      providers: []
    }
    const sources = [...(await profileFiles(profile)), ...(await providerFiles(profile, home))]
    for (const source of sources) {
      const old = previous?.manifest.files[source.relative]
      const previousFile = old
        ? { ...old, file: within(previous.directory, source.relative) }
        : undefined
      manifest.files[source.relative] = await snapshotFile(
        source.source,
        within(stage, source.relative),
        previousFile
      )
      if (source.restoreRoot) {
        manifest.providers.push({ relative: source.relative, target: source.source })
      }
    }
    manifest.summary = inspectProfile(path.join(stage, 'profile'))
    assertNotEmptyReplacement(manifest.summary, summary)
    await atomicJson(path.join(stage, 'manifest.json'), manifest)
    await validateGeneration({ directory: stage, manifest }, profile)
    await rename(stage, directory)
    await syncDirectory(recovery)
    const runtime = await readJson(path.join(profile, 'orca-runtime.json')).catch(() => null)
    await atomicJson(path.join(recovery, 'status.json'), {
      profilePath: path.resolve(profile),
      lastSuccessfulSnapshot: directory,
      lastSuccessfulAt: now,
      sessions: manifest.summary.sessions,
      lastRuntimePid: runtime?.pid ?? null,
      lastRuntimeId: runtime?.runtimeId ?? null
    })
    const items = await generations(recovery)
    const retained = retainedGenerations(items)
    for (const item of items) {
      if (!retained.has(item.directory)) {
        await rm(item.directory, { recursive: true })
      }
    }
    return { directory, manifest }
  } catch (error) {
    await rm(stage, { recursive: true, force: true })
    throw error
  }
}

export function processMayBeAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code !== 'ESRCH'
  }
}

export async function recoverProfileIfNeeded({ profile, recovery, home = homedir() }) {
  const items = await generations(recovery)
  let problem
  try {
    const summary = inspectProfile(profile)
    assertNotEmptyReplacement(summary, items[0]?.manifest.summary)
    return { recovered: false }
  } catch (error) {
    problem = error
  }
  if (!items.length) {
    if (
      !(await exists(path.join(profile, 'orca-profile-index.json'))) &&
      !(await exists(path.join(profile, 'agent-session-journal.db')))
    ) {
      return { recovered: false }
    }
    throw new Error(
      `Saved profile needs recovery, but no verified backup is available: ${problem.message}`
    )
  }
  const runtime = await readJson(path.join(profile, 'orca-runtime.json')).catch(() => null)
  const status = await readJson(path.join(recovery, 'status.json')).catch(() => null)
  if ([runtime?.pid, status?.lastRuntimePid].some(processMayBeAlive)) {
    throw new Error('Quit the existing Orca process before recovering its profile')
  }
  let selected
  for (const item of items) {
    try {
      await validateGeneration(item, profile)
      selected = item
      break
    } catch {
      /* Keep searching for the newest complete, verified copy. */
    }
  }
  if (!selected) {
    throw new Error('No recovery copy passed verification; all copies were preserved')
  }
  for (const provider of selected.manifest.providers) {
    within(home, path.relative(home, provider.target))
    within(selected.directory, provider.relative)
    if (!(await exists(provider.target)) && /\.(db|sqlite)$/.test(provider.target)) {
      for (const suffix of ['-wal', '-shm', '-journal']) {
        if (await exists(provider.target + suffix)) {
          throw new Error(
            'Provider database sidecars remain; preserve them before restoring the database'
          )
        }
      }
    }
  }
  const stage = `${profile}.recovering-${randomUUID()}`
  const quarantine = `${profile}.before-recovery-${Date.now()}`
  await mkdir(stage, { recursive: true, mode: 0o700 })
  try {
    for (const relative of Object.keys(selected.manifest.files)) {
      if (!relative.startsWith(`profile${path.sep}`)) {
        continue
      }
      const target = within(stage, path.relative('profile', relative))
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
      await copyFile(within(selected.directory, relative), target)
    }
    inspectProfile(stage)
    const hadProfile = await exists(profile)
    if (hadProfile) {
      await rename(profile, quarantine)
    }
    try {
      await rename(stage, profile)
    } catch (error) {
      if (hadProfile) {
        await rename(quarantine, profile)
      }
      throw error
    }
    let restoredProviderFiles = 0
    await syncDirectory(path.dirname(profile))
    for (const provider of selected.manifest.providers) {
      within(home, path.relative(home, provider.target))
      if (await exists(provider.target)) {
        continue
      }
      await mkdir(path.dirname(provider.target), { recursive: true, mode: 0o700 })
      await copyFile(
        within(selected.directory, provider.relative),
        provider.target,
        constants.COPYFILE_EXCL
      )
      restoredProviderFiles++
    }
    const receipt = {
      recovered: true,
      from: selected.directory,
      recoveredAt: Date.now(),
      previousProfile: hadProfile ? quarantine : null,
      restoredProviderFiles,
      summary: selected.manifest.summary
    }
    await atomicJson(path.join(recovery, 'last-recovery.json'), receipt)
    return receipt
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}
